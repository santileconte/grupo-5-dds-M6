# Catálogo de eventos

Versión legible del catálogo común de eventos (RNF-03). La definición formal de cada módulo
está en `contratos/eventos/<modulo>.asyncapi.yaml`. Este documento describe los eventos que
publica **M6** y sirve como plantilla para que los demás grupos incorporen los suyos.

## Convenciones comunes (propuesta para el consorcio)

| Tema         | Convención                                                                                      |
|--------------|-------------------------------------------------------------------------------------------------|
| Broker       | RabbitMQ (RNF-10). Un único exchange `movilidad.eventos`, de tipo `topic` y durable.           |
| Routing key  | `<modulo>.<entidad>.<hecho-en-pasado>`, en minúsculas. Ej: `trips.trip.completed`.           |
| Nombre       | `eventType` en PascalCase y en pasado. Ej: `TripCompleted`.                                       |
| Sobre        | `{ eventId, eventType, eventVersion, occurredAt, producer, correlationId, payload }`                  |
| Entrega      | Al menos una vez. El consumidor descarta duplicados por `eventId` (RNF-09).                    |
| Correlación  | `correlationId` viene del header `X-Correlation-Id` y se propaga (RNF-14).                       |
| Privacidad   | Sin coordenadas, direcciones, datos personales ni secretos (RNF-19).                             |
| Versionado   | Un cambio incompatible incrementa `eventVersion` y convive con la versión anterior durante la transición. |

### Ejemplo de sobre

```json
{
  "eventId": "6f7a8b9c-0d1e-4f2a-8b3c-4d5e6f7a8b9c",
  "eventType": "TripCompleted",
  "eventVersion": 1,
  "occurredAt": "2026-10-08T12:22:00Z",
  "producer": "m6-viajes",
  "correlationId": "0c6a4f0e-8f43-4d3b-a3b7-6a1f2c8e9d10",
  "payload": { "tripId": "7b0e3a8e-…", "tripVersion": 4, "distanceKm": 4.2, "durationSeconds": 900 }
}
```

## Eventos publicados por M6 (Viajes y Ciclo de Vida)

Todos los `payload` incluyen `tripId`, `tripVersion`, `requestId`, `reservationId` (puede ser `null`),
`clientId` y `driverId`.

| Evento              | Routing key                  | Cuándo                         | Datos adicionales                                                                                       | Consumidores sugeridos |
|---------------------|------------------------------|--------------------------------|---------------------------------------------------------------------------------------------------------|------------------------|
| `TripCreated`       | `trips.trip.created`        | M5 creó el viaje (`PENDING_ARRIVAL`)  | `vehicleId`, `vehicleType`, `createdAt`                                                                | M8 (aviso y QR), M9    |
| `DriverArrived` | `trips.driver.arrived`  | → `DRIVER_ARRIVED`         | `arrivedAt`                                                                                              | M8                     |
| `TripStarted`     | `trips.trip.started`      | → `IN_PROGRESS`                   | `vehicleType`, `startedAt`                                                                            | M8, M7                 |
| `TripCompleted`   | `trips.trip.completed`    | → `COMPLETED`                 | `vehicleType`, `startedAt`, `completedAt`, `distanceKm`, `durationSeconds`             | M7, M8, M2, M3, M4, M9 |
| `TripCancelled`    | `trips.trip.cancelled`     | → `CANCELLED`                  | `vehicleType`, `cancelledBy`, `reason`, `previousState`, `requiresRedispatch`, `createdAt`, `arrivedAt`, `startedAt`, `cancelledAt` | M5, M7, M8, M4, M9 |

### Para qué le sirve cada evento a cada módulo

- **M5 (Despacho):** con `TripCancelled` y `requiresRedispatch = true`, vuelve a buscar conductor
  para la misma `requestId` (RF-6.7).
- **M7 (Pagos):** con `TripCompleted` calcula el importe final, captura el pago y liquida al
  conductor. Con `TripCancelled` decide si cobra un cargo de cancelación usando quién canceló, el
  motivo, el estado y los instantes. M6 no calcula importes.
- **M8 (Notificaciones):** avisa cada hito (RF-8.1). Con `TripCreated` genera el QR de un solo uso
  (RF-8.3) y con `TripCompleted` emite el comprobante (RF-8.4).
- **M2 / M3:** con `TripCompleted` habilitan la calificación del conductor y del cliente
  (RF-2.5, RF-3.7).
- **M4 (Disponibilidad):** con `TripCompleted` o `TripCancelled` libera al conductor (RF-4.4).
- **M9 (Reservas):** si `reservationId` no es `null`, actualiza la reserva vinculada.

## Eventos que consume M6

Por ahora ninguno, porque el viaje se crea por API (`POST /trips`, invocado por M5). Si el
consorcio decide comunicar la asignación mediante un evento (por ejemplo
`despacho.asignacion.confirmada`), M6 lo consumiría con la misma lógica idempotente por
`requestId`.

## Garantía de publicación: bandeja de salida (outbox)

Este mecanismo ya está implementado. Cada evento se guarda en la tabla `eventos_salientes`
**en la misma transacción** que el cambio del viaje que lo origina. Un proceso independiente, el
`RelevadorDeEventos`, revisa esa tabla cada segundo, publica en orden los pending en RabbitMQ
y los marca como publicados.

- Si RabbitMQ está caído, el viaje sigue funcionando y los eventos quedan pending hasta que el
  broker vuelve (RNF-13).
- Nunca se publica un evento de un cambio que no se guardó.
- Un evento puede llegar **más de una vez**, por ejemplo si el servicio se cae justo después de
  publicar. Por eso los consumidores deben descartar duplicados por `eventId` (RNF-09).

## Cómo consumir los eventos de M6 (para otros grupos)

1. Conectarse al RabbitMQ del entorno y declarar el exchange `movilidad.eventos`, de tipo
   `topic` y durable. Declararlo es idempotente: si ya existe, no pasa nada.
2. Crear una cola **durable propia**, por ejemplo `m7-pagos.viajes`, y enlazarla con las routing
   keys que interesen: `trips.trip.completed`, o `viajes.#` para todas.
3. Procesar cada mensaje y hacer `ack` recién cuando se guardó el resultado. Descartar los
   `eventId` ya procesados.

Si la cola no existe en el momento en que M6 publica, RabbitMQ descarta el mensaje. Por eso cada
consumidor debe crear su cola antes de empezar a recibir eventos.
