# Catálogo de eventos

Índice legible del catálogo común de eventos (RNF-03). La definición formal de cada módulo
está en `contratos/eventos/<modulo>.asyncapi.yaml`. Este documento cubre lo que publica **M6**
y sirve de plantilla para que los demás grupos agreguen sus eventos.

## Convenciones comunes (propuesta para el consorcio)

| Tema         | Convención                                                                                      |
|--------------|-------------------------------------------------------------------------------------------------|
| Broker       | RabbitMQ (RNF-10). Un único exchange `movilidad.eventos`, de tipo `topic` y durable.           |
| Routing key  | `<modulo>.<entidad>.<hecho-en-pasado>`, en minúsculas. Ej: `viajes.viaje.finalizado`.           |
| Nombre       | `tipo` en PascalCase y en pasado. Ej: `ViajeFinalizado`.                                       |
| Sobre        | `{ idEvento, tipo, version, ocurridoEn, productor, idCorrelacion, datos }`                      |
| Entrega      | Al menos una vez. El consumidor descarta duplicados por `idEvento` (RNF-09).                    |
| Correlación  | `idCorrelacion` viene del header `X-Correlation-Id` y se propaga (RNF-14).                       |
| Privacidad   | Sin coordenadas, direcciones, datos personales ni secretos (RNF-19).                             |
| Versionado   | Un cambio incompatible incrementa `version` y convive con la versión anterior durante la transición. |

### Ejemplo de sobre

```json
{
  "idEvento": "6f7a8b9c-0d1e-4f2a-8b3c-4d5e6f7a8b9c",
  "tipo": "ViajeFinalizado",
  "version": 1,
  "ocurridoEn": "2026-10-08T12:22:00Z",
  "productor": "m6-viajes",
  "idCorrelacion": "0c6a4f0e-8f43-4d3b-a3b7-6a1f2c8e9d10",
  "datos": { "viajeId": "7b0e3a8e-…", "versionViaje": 4, "distanciaRecorridaMetros": 4200, "duracionSegundos": 900 }
}
```

## Eventos publicados por M6 (Viajes y Ciclo de Vida)

Todos los `datos` incluyen `viajeId`, `versionViaje`, `solicitudId`, `reservaId` (puede ser `null`),
`clienteId` y `conductorId`.

| Evento              | Routing key                  | Cuándo                         | Datos adicionales                                                                                       | Consumidores sugeridos |
|---------------------|------------------------------|--------------------------------|---------------------------------------------------------------------------------------------------------|------------------------|
| `ViajeCreado`       | `viajes.viaje.creado`        | M5 creó el viaje (`ASIGNADO`)  | `vehiculoId`, `tipoVehiculo`, `creadoEn`                                                                | M8 (aviso y QR), M9    |
| `ConductorArribado` | `viajes.conductor.arribado`  | → `CONDUCTOR_ARRIBADO`         | `arriboEn`                                                                                              | M8                     |
| `ViajeIniciado`     | `viajes.viaje.iniciado`      | → `EN_CURSO`                   | `tipoVehiculo`, `iniciadoEn`                                                                            | M8, M7                 |
| `ViajeFinalizado`   | `viajes.viaje.finalizado`    | → `FINALIZADO`                 | `tipoVehiculo`, `iniciadoEn`, `finalizadoEn`, `distanciaRecorridaMetros`, `duracionSegundos`             | M7, M8, M2, M3, M4, M9 |
| `ViajeCancelado`    | `viajes.viaje.cancelado`     | → `CANCELADO`                  | `tipoVehiculo`, `canceladoPor`, `motivo`, `estadoAlCancelar`, `requiereRedespacho`, `creadoEn`, `arriboEn`, `iniciadoEn`, `canceladoEn` | M5, M7, M8, M4, M9 |

### Para qué le sirve cada evento a cada módulo

- **M5 (Despacho):** con `ViajeCancelado` y `requiereRedespacho = true`, vuelve a buscar conductor
  para la misma `solicitudId` (RF-6.7).
- **M7 (Pagos):** con `ViajeFinalizado` calcula el importe final, captura el pago y liquida al
  conductor. Con `ViajeCancelado` decide si cobra un cargo de cancelación usando quién canceló, el
  motivo, el estado y los instantes. M6 no calcula importes.
- **M8 (Notificaciones):** avisa cada hito (RF-8.1). Con `ViajeCreado` genera el QR de un solo uso
  (RF-8.3) y con `ViajeFinalizado` emite el comprobante (RF-8.4).
- **M2 / M3:** con `ViajeFinalizado` habilitan la calificación del conductor y del cliente
  (RF-2.5, RF-3.7).
- **M4 (Disponibilidad):** con `ViajeFinalizado` o `ViajeCancelado` libera al conductor (RF-4.4).
- **M9 (Reservas):** si `reservaId` no es `null`, actualiza la reserva vinculada.

## Eventos que consume M6

Ninguno por ahora: el viaje se crea por API (`POST /viajes`, invocado por M5). Si el consorcio
decide que la asignación se comunique por evento (por ejemplo `despacho.asignacion.confirmada`),
M6 lo consumiría con la misma lógica idempotente por `asignacionId`.

## Garantía de publicación (TP2)

Para que un cambio de estado y su evento no queden desalineados, se usará el patrón
**transactional outbox**: la transición y el evento se guardan en la misma transacción de base de
datos, y un proceso aparte publica los eventos pendientes en RabbitMQ. Si el broker no está
disponible, el viaje igual avanza y el evento se publica cuando el broker vuelve (RNF-13).
