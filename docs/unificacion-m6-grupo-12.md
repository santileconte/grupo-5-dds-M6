# Unificación del contrato de M6: Grupo 5 → Grupo 12

Hola Grupo 12:

Somos el Grupo 5, la otra implementación de **M6 – Viajes y Ciclo de Vida**. Como el equipo
integrador tiene que poder usar cualquiera de las dos implementaciones sin cambiar nada en los
demás módulos, las dos tienen que respetar **el mismo contrato**: rutas, campos, estados, errores
y eventos.

Tomamos el `openapi.yaml` de ustedes, lo comparamos con el nuestro y les contamos en este
documento:

1. qué encontramos al comparar;
2. qué cambiamos nosotros para parecernos a ustedes (ya está hecho y probado);
3. un paso a paso con lo que les proponemos cambiar a ustedes para adecuarse al nuestro;
4. cuatro puntos que preferimos decidir juntos.

Todo lo que mencionamos está en nuestro repositorio,
<https://github.com/santileconte/grupo-5-dds-M6>:

| Archivo | Qué tiene |
|---|---|
| `contratos/m6-viajes.openapi.yaml` | La API completa (OpenAPI 3.1) |
| `contratos/eventos/m6-viajes.asyncapi.yaml` | Los eventos (AsyncAPI 3.0) |
| `docs/m6/maquina-de-estados.md` | Estados, transiciones, quién puede ejecutar cada una y reglas |
| `docs/catalogo-eventos.md` | Versión legible de los eventos, con ejemplos |

---

## 1. Qué encontramos al comparar

Los dos contratos cubren las mismas funciones (RF-6.1 a RF-6.8) y coinciden en lo esencial:
crear el viaje desde M5, arribo, inicio validando el QR contra M8 (`422` si es inválido, `503` si
M8 no responde), finalización, cancelación antes del inicio, historial, listado paginado sin
coordenadas y JWT de M1 con el rol.

Pero **no coincidía ninguna ruta, ningún campo ni ningún evento**: nosotros teníamos todo en
español y con otro modelo de datos. Separamos las diferencias en dos grupos:

- **Diferencias de nombres o de formato.** No cambian cómo funciona M6, solo cómo se llaman las
  cosas. En estas **nos adaptamos nosotros a ustedes** (sección 2).
- **Diferencias de diseño.** Cambian el comportamiento o agregan garantías. En estas les
  proponemos que se adecúen ustedes al nuestro (sección 3), salvo cuatro que conviene hablar
  (sección 4).

---

## 2. Lo que cambiamos nosotros para parecernos a ustedes

Ya está implementado, con los tests en verde y los contratos validados.

| # | Tema | Cómo lo teníamos | Cómo quedó (igual que ustedes) |
|---|---|---|---|
| 1 | Idioma | Todo en español | Todo el contrato en inglés |
| 2 | Rutas | `/viajes`, `/arribo`, `/inicio`, `/finalizacion`, `/cancelacion`, `/historial` | `/trips`, `/trips/{id}/arrived`, `/start`, `/complete`, `/cancel`, `/history` |
| 3 | Health | `GET /salud` → `{ "estado": "OK" }` | `GET /health` → `{ "status": "UP", "timestamp": "…" }` |
| 4 | Estados | `ASIGNADO`, `CONDUCTOR_ARRIBADO`, `EN_CURSO`, `FINALIZADO` | `PENDING_ARRIVAL`, `DRIVER_ARRIVED`, `IN_PROGRESS`, `COMPLETED` |
| 5 | Roles | `CLIENTE`, `CONDUCTOR`, `OPERADOR`, `SERVICIO`, claim `rol` | `CLIENT`, `DRIVER`, `OPERATOR`, `SYSTEM`, claim `role` |
| 6 | Campos | `clienteId`, `conductorId`, `vehiculoId`, `solicitudId`, `estado`, `creadoEn`, `pagina`, `tamanio`, `codigoVerificacion` | `clientId`, `driverId`, `vehicleId`, `requestId`, `state`, `createdAt`, `page`, `pageSize`, `verificationToken` |
| 7 | Ubicaciones | `origen` y `destino` como objetos `{ latitud, longitud }` | `originLatitude`, `originLongitude`, `destinationLatitude`, `destinationLongitude`, tipo `double` |
| 8 | Distancia | `distanciaRecorridaMetros`, entero en metros | `distanceKm`, decimal en kilómetros, mínimo `0.1` |
| 9 | Viaje (`Trip`) | Sin `distanceKm`, `durationMinutes` ni `updatedAt` en la raíz | Con `distanceKm`, `durationMinutes` y `updatedAt`. El resumen del listado también trae `durationMinutes` |
| 10 | Crear el viaje | Idempotente por un `assignmentId` aparte; `409` si la solicitud tenía otro viaje activo | Idempotente por `requestId`: `201` la primera vez, `200` con el mismo viaje si repiten con los mismos datos, `409` si el `requestId` existe con datos distintos. Eliminamos `assignmentId` |
| 11 | Errores | `{ "codigo": …, "detail": … }`, códigos en español | Incluyen `code`, `message`, `timestamp` y `correlationId`; códigos en inglés como `INVALID_STATE_TRANSITION` |
| 12 | Eventos | `ViajeCreado`, `ConductorArribado`, `ViajeIniciado`, `ViajeFinalizado` | `TripCreated`, `DriverArrived`, `TripStarted`, `TripCompleted`, con los campos del sobre en inglés (`eventId`, `occurredAt`, `correlationId`, `payload`) |

**Resultado:** un cliente escrito para el contrato de ustedes ya puede, contra nuestro servicio y
cambiando solo el host, **consultar un viaje, marcar el arribo, iniciar con el QR y listar
viajes**. Para **crear, finalizar y cancelar** todavía hacen falta los pasos 2, 3 y 4 de la
sección siguiente.

---

## 3. Paso a paso: qué les proponemos cambiar a ustedes

Están ordenados de lo que más afecta a la integración a lo que menos. Cada paso dice cómo está hoy
en el contrato de ustedes y cómo quedaría.

### Paso 1 – Cancelación: un solo estado y un solo evento

- **Hoy:** dos estados (`CANCELLED_BY_CLIENT`, `CANCELLED_BY_DRIVER`) y dos eventos
  (`TripCancelledByClient`, `TripCancelledByDriver`).
- **Propuesta:** un solo estado `CANCELLED` y un solo evento `TripCancelled`. Quién canceló va en
  el campo `cancellation.cancelledBy` del viaje y en `cancelledBy` del evento, con los valores
  `CLIENT`, `DRIVER` u `OPERATOR`.
- **Por qué:** los consumidores (M5, M7, M8, M4) escuchan un solo evento en vez de dos, y queda
  lugar para la cancelación del operador. Es un punto para hablar (sección 4, punto A).

### Paso 2 – Cancelación: motivos fijos según el rol

- **Hoy:** `reason` es texto libre de 3 a 255 caracteres.
- **Propuesta:** `reason` es un valor fijo, y el texto libre pasa a un campo `detail` opcional
  (hasta 500 caracteres). Cada rol puede usar estos motivos:

  | Rol | Puede cancelar desde | Motivos permitidos |
  |---|---|---|
  | `CLIENT` (el del viaje) | `PENDING_ARRIVAL`, `DRIVER_ARRIVED` | `CHANGE_OF_PLANS`, `EXCESSIVE_DELAY`, `DRIVER_NO_SHOW`, `OTHER` |
  | `DRIVER` (el asignado) | `PENDING_ARRIVAL`, `DRIVER_ARRIVED` | `CLIENT_NO_SHOW`, `VEHICLE_PROBLEM`, `ORIGIN_UNREACHABLE`, `OTHER` |
  | `OPERATOR` | `PENDING_ARRIVAL`, `DRIVER_ARRIVED`, `IN_PROGRESS` | `SECURITY_INCIDENT`, `ADMINISTRATIVE_BLOCK`, `OTHER` |

- **Reglas:**
  - Un motivo que no corresponde al rol responde `422` con `code: REASON_NOT_ALLOWED`.
  - Un motivo que no existe responde `400` con `code: VALIDATION`.
  - `CLIENT_NO_SHOW` solo se acepta si pasaron 5 minutos (configurable) desde el arribo.
  - Si cancela el conductor antes del inicio, salvo por `CLIENT_NO_SHOW`, el viaje y el evento
    llevan `requiresRedispatch: true`, para que M5 busque otro conductor.
- **Diferencia con ustedes:** en el nuestro el operador puede cancelar un viaje en curso, para
  incidentes. En el de ustedes eso quedaba fuera de alcance.

Ejemplo:

```http
POST /trips/{id}/cancel
Authorization: Bearer <token del conductor>

{ "reason": "VEHICLE_PROBLEM", "detail": "Pinché una goma" }
```

### Paso 3 – Finalizar: la duración la calcula M6

- **Hoy:** el conductor manda `distanceKm` y `durationMinutes`.
- **Propuesta:** el conductor manda solo `distanceKm`, y opcionalmente `finalLatitude` y
  `finalLongitude`. M6 calcula la duración como `completedAt − startedAt`, porque el reloj del
  servidor es más confiable que el valor que informa el conductor.
- **Ojo:** nuestro servicio rechaza con `400` cualquier campo que no esté en el contrato, así que
  un cliente que mande `durationMinutes` hoy recibe un error. Si prefieren que lo aceptemos y lo
  ignoremos, lo hacemos (sección 4, punto D).

```http
POST /trips/{id}/complete

{ "distanceKm": 6.4 }
```

### Paso 4 – Crear el viaje: campos que les faltan

Agregar a `CreateTripRequest`:

| Campo | Tipo | Obligatorio | Para qué |
|---|---|---|---|
| `vehicleType` | `CAR` o `MOTORCYCLE` | Sí | M7 lo necesita para la tarifa |
| `reservationId` | `uuid` o `null` | No | Viajes que vienen de una reserva (M9) |
| `originAddress` | texto, hasta 300 | No | Mostrar la dirección en el historial |
| `destinationAddress` | texto, hasta 300 | No | Ídem |

El `409` se decide comparando **todos** los datos de creación, incluidos estos campos. El código del
error es `REQUEST_ID_CONFLICT`.

```json
{
  "requestId": "0c6a4f0e-8f43-4d3b-a3b7-6a1f2c8e9d10",
  "reservationId": null,
  "clientId": "3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  "driverId": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  "vehicleId": "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5e",
  "vehicleType": "CAR",
  "originLatitude": -34.6037,
  "originLongitude": -58.3816,
  "destinationLatitude": -34.5889,
  "destinationLongitude": -58.3974,
  "originAddress": "Av. Corrientes 1000",
  "destinationAddress": "Av. Santa Fe 3000"
}
```

### Paso 5 – Respuesta del viaje (`Trip`): campos que les faltan

- **Ya coinciden:** `id`, `requestId`, `clientId`, `driverId`, `vehicleId`, las cuatro
  coordenadas, `state`, `distanceKm`, `durationMinutes`, `createdAt` y `updatedAt`.
- **Agregar:**
  - `version`: entero que aumenta en 1 con cada transición; también va en el header `ETag`.
  - `vehicleType`, `reservationId`, `originAddress`, `destinationAddress`.
  - `arrivedAt`, `startedAt`, `completedAt`, `cancelledAt`: fecha de cada hito, o `null`.
  - `closure`: detalle del cierre (`distanceKm`, `durationSeconds`, `finalLatitude`,
    `finalLongitude`), o `null`.
  - `cancellation`: detalle de la cancelación (`cancelledBy`, `reason`, `detail`,
    `previousState`, `requiresRedispatch`), o `null`.

```json
{
  "id": "7b0e3a8e-4f7c-4d1a-9a52-1f0c2f9d6b11",
  "requestId": "0c6a4f0e-8f43-4d3b-a3b7-6a1f2c8e9d10",
  "reservationId": null,
  "clientId": "3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  "driverId": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  "vehicleId": "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5e",
  "vehicleType": "CAR",
  "originLatitude": -34.6037,
  "originLongitude": -58.3816,
  "destinationLatitude": -34.5889,
  "destinationLongitude": -58.3974,
  "originAddress": "Av. Corrientes 1000",
  "destinationAddress": "Av. Santa Fe 3000",
  "state": "COMPLETED",
  "version": 4,
  "createdAt": "2026-10-08T12:00:00.000Z",
  "updatedAt": "2026-10-08T12:22:00.000Z",
  "arrivedAt": "2026-10-08T12:05:00.000Z",
  "startedAt": "2026-10-08T12:07:00.000Z",
  "completedAt": "2026-10-08T12:22:00.000Z",
  "cancelledAt": null,
  "distanceKm": 4.2,
  "durationMinutes": 15,
  "closure": { "distanceKm": 4.2, "durationSeconds": 900 },
  "cancellation": null
}
```

### Paso 6 – Historial

- **Hoy:** `GET /trips/{id}/history` devuelve un array de
  `{ id, tripId, state, actorId, actorRole, reason, metadata, createdAt }`.
- **Propuesta:** un objeto con la lista de transiciones, en orden. Cada transición dice de qué
  estado a qué estado pasó, con qué acción y quién la hizo:

```json
{
  "tripId": "7b0e3a8e-4f7c-4d1a-9a52-1f0c2f9d6b11",
  "transitions": [
    { "sequence": 1, "from": null, "to": "PENDING_ARRIVAL", "action": "CREATE",
      "actor": { "role": "SYSTEM", "id": "m5-despacho" }, "occurredAt": "2026-10-08T12:00:00.000Z" },
    { "sequence": 2, "from": "PENDING_ARRIVAL", "to": "CANCELLED", "action": "CANCEL",
      "actor": { "role": "DRIVER", "id": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d" },
      "occurredAt": "2026-10-08T12:03:00.000Z", "reason": "VEHICLE_PROBLEM", "detail": "Pinché una goma" }
  ]
}
```

- `action` puede ser `CREATE`, `REGISTER_ARRIVAL`, `START`, `COMPLETE` o `CANCEL`.
- Lo pueden ver el cliente y el conductor del viaje y un operador. Un servicio (`SYSTEM`) recibe
  `403`.
- El historial no se puede modificar: en la base lo protege un trigger.

### Paso 7 – Eventos: broker, sobre y contenido

- **Hoy:** los eventos están como esquemas dentro del OpenAPI, sin broker, exchange ni routing
  keys.
- **Propuesta:**
  - **Broker:** RabbitMQ, exchange `movilidad.eventos`, de tipo `topic` y durable. Es la
    convención que les propusimos a todos los grupos.
  - **Routing keys:**

    | Evento | Routing key |
    |---|---|
    | `TripCreated` | `trips.trip.created` |
    | `DriverArrived` | `trips.driver.arrived` |
    | `TripStarted` | `trips.trip.started` |
    | `TripCompleted` | `trips.trip.completed` |
    | `TripCancelled` | `trips.trip.cancelled` |

  - **Sobre:** `{ eventId, eventType, eventVersion, occurredAt, producer, correlationId, payload }`.
    Respecto del de ustedes, cambian dos cosas: se agrega `producer` (`m6-viajes`) y el `tripId` va
    dentro de `payload`, no en el sobre.
  - **Propiedades AMQP:** `message_id` = `eventId`, `correlation_id` = `correlationId`,
    `type` = `eventType`, `content_type` = `application/json`, mensaje persistente.
  - **Contenido:** todos los `payload` traen `tripId`, `tripVersion`, `requestId`,
    `reservationId`, `clientId` y `driverId`. `tripVersion` sirve para ignorar eventos que llegan
    fuera de orden. Cada evento agrega lo suyo:

    | Evento | Campos propios |
    |---|---|
    | `TripCreated` | `vehicleId`, `vehicleType`, `createdAt` |
    | `DriverArrived` | `arrivedAt` |
    | `TripStarted` | `vehicleType`, `startedAt` |
    | `TripCompleted` | `vehicleType`, `startedAt`, `completedAt`, `distanceKm`, `durationSeconds` |
    | `TripCancelled` | `vehicleType`, `cancelledBy`, `reason`, `previousState`, `requiresRedispatch`, `createdAt`, `arrivedAt`, `startedAt`, `cancelledAt` |

    En `TripCancelled` no mandamos `secondsSinceCreation`: M7 lo calcula con `createdAt` y
    `cancelledAt`, y también tiene `arrivedAt` por si el cargo depende del arribo.
  - **Entrega al menos una vez:** el evento se guarda en la misma transacción que el cambio del
    viaje (bandeja de salida, o *outbox*) y se publica después. Nunca se pierde, pero puede llegar
    repetido: los consumidores descartan duplicados por `eventId`.
  - **Privacidad:** los eventos no llevan coordenadas, direcciones, datos personales ni el QR.

Ejemplo de `TripCompleted`:

```json
{
  "eventId": "6f7a8b9c-0d1e-4f2a-8b3c-4d5e6f7a8b9c",
  "eventType": "TripCompleted",
  "eventVersion": 1,
  "occurredAt": "2026-10-08T12:22:00.000Z",
  "producer": "m6-viajes",
  "correlationId": "0c6a4f0e-8f43-4d3b-a3b7-6a1f2c8e9d10",
  "payload": {
    "tripId": "7b0e3a8e-4f7c-4d1a-9a52-1f0c2f9d6b11",
    "tripVersion": 4,
    "requestId": "0c6a4f0e-8f43-4d3b-a3b7-6a1f2c8e9d10",
    "reservationId": null,
    "clientId": "3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    "driverId": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
    "vehicleType": "CAR",
    "startedAt": "2026-10-08T12:07:00.000Z",
    "completedAt": "2026-10-08T12:22:00.000Z",
    "distanceKm": 4.2,
    "durationSeconds": 900
  }
}
```

### Paso 8 – Formato de error

- **Hoy:** `{ code, message, correlationId, timestamp }`.
- **Propuesta:** mantener esos cuatro campos y sumar los de RFC 9457 (`type`, `title`, `status`,
  `detail`, `instance`), con `Content-Type: application/problem+json`. En una validación (`400`)
  se agrega `errors: [ { field, message } ]`, y en una transición inválida (`409`),
  `currentState`. Un cliente que solo lea `code` y `message` funciona igual con los dos.

```json
{
  "type": "https://movilidad.example/errors/invalid-state-transition",
  "title": "Transición inválida",
  "status": 409,
  "code": "INVALID_STATE_TRANSITION",
  "detail": "No se puede ejecutar COMPLETE sobre un viaje en estado COMPLETED",
  "message": "No se puede ejecutar COMPLETE sobre un viaje en estado COMPLETED",
  "timestamp": "2026-10-08T12:23:00.000Z",
  "instance": "/trips/7b0e3a8e-4f7c-4d1a-9a52-1f0c2f9d6b11/complete",
  "correlationId": "0c6a4f0e-8f43-4d3b-a3b7-6a1f2c8e9d10",
  "currentState": "COMPLETED"
}
```

Los códigos que usamos son:

| HTTP | `code` |
|---|---|
| 400 | `VALIDATION` |
| 401 | `UNAUTHENTICATED` |
| 403 | `FORBIDDEN` |
| 404 | `TRIP_NOT_FOUND`, `ROUTE_NOT_FOUND` |
| 409 | `INVALID_STATE_TRANSITION`, `CONCURRENCY_CONFLICT`, `REQUEST_ID_CONFLICT`, `REQUEST_IN_PROGRESS` |
| 412 | `PRECONDITION_FAILED` |
| 413 | `PAYLOAD_TOO_LARGE` |
| 422 | `INVALID_VERIFICATION_CODE`, `REASON_NOT_ALLOWED`, `IDEMPOTENCY_KEY_REUSED` |
| 429 | `TOO_MANY_REQUESTS` |
| 500 | `INTERNAL_ERROR` |
| 503 | `DEPENDENCY_UNAVAILABLE` |

### Paso 9 – Cabeceras que ustedes todavía no definen

| Cabecera | Para qué |
|---|---|
| `X-Correlation-Id` | Seguir un pedido entre módulos. Se propaga a los logs y a los eventos; si no viene, M6 genera uno |
| `ETag` / `If-Match` | Cada respuesta de un viaje trae su versión en `ETag`. Si una acción manda `If-Match` y la versión cambió, responde `412` |
| `Idempotency-Key` | Opcional en las acciones. Repetir la misma clave devuelve la misma respuesta, con `Idempotent-Replayed: true`, sin volver a aplicar la acción. Si se reusa con otro cuerpo, `422 IDEMPOTENCY_KEY_REUSED` |
| `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` | Límite de pedidos por minuto: 120 por usuario y 1200 por servicio. Al superarlo, `429` con `Retry-After` |
| `Retry-After` | También en el `503` cuando M8 no responde |

Además limitamos el cuerpo de los pedidos a 16 KB (`413`).

### Paso 10 – Token

- El JWT debe traer `exp`: sin vencimiento, o vencido, responde `401`. Un token sin vencimiento
  serviría para siempre si alguien lo roba.
- El claim del rol se llama `role`, como en el de ustedes.

### Paso 11 – Consultas y visibilidad

- `GET /trips` acepta, además de `clientId`, `driverId`, `state`, `page` y `pageSize`:
  - `from` y `to`: rango de fechas de creación;
  - varios estados separados por coma, por ejemplo `state=PENDING_ARRIVAL,IN_PROGRESS`.
- Quién ve qué:
  - `CLIENT` y `DRIVER` ven solo sus viajes: se usa el id del token y se ignora el filtro que manden;
  - `OPERATOR` ve todos;
  - `SYSTEM` tiene que indicar `clientId` o `driverId`.
- El resumen (`TripSummary`) agrega `vehicleType`, `originAddress`, `destinationAddress` y
  `completedAt` a los campos de ustedes.
- Si un cliente o conductor pide `GET /trips/{id}` de un viaje ajeno, responde `404`, no `403`,
  para no revelar que el viaje existe.

### Paso 12 – Health detallado

Además de `GET /health`, exponemos `GET /health/details`, que informa el estado de PostgreSQL,
RabbitMQ, Redis y la bandeja de eventos:

- `status: OK`: todo responde.
- `status: DEGRADED` (`200`): falla RabbitMQ o Redis, o hay eventos esperando hace más de 60
  segundos. El servicio sigue atendiendo.
- `status: ERROR` (`503`): no responde la base.

### Lo que ya coincide y no hay que tocar

- Los estados `PENDING_ARRIVAL`, `DRIVER_ARRIVED`, `IN_PROGRESS` y `COMPLETED`, y las
  transiciones entre ellos.
- Quién ejecuta cada acción: `SYSTEM` crea, el `DRIVER` asignado marca el arribo, inicia y
  finaliza.
- El inicio con `verificationToken`, con `422` si el QR es inválido y `503` si M8 no responde.
- `GET /health` con `{ status: "UP", timestamp }`.
- El JWT con `sub` y `role`.

---

## 4. Para decidir juntos

**A. Cancelación: ¿uno o dos estados?**
Proponemos un solo `CANCELLED` con `cancelledBy` (paso 1). Si ustedes prefieren dos estados, lo
adoptamos nosotros, pero hace falta un tercero, `CANCELLED_BY_OPERATOR`, porque en el nuestro el
operador también cancela.

**B. Dirección base y puerto.**
Ustedes publican en `http://localhost:3006/api/v1`. Nosotros no usamos prefijo de versión y el
puerto es configurable (3000 por defecto). Proponemos sin prefijo y puerto 3006 en el entorno
integrado. Si prefieren mantener `/api/v1`, nos adaptamos.

**C. Volver a despachar con un `requestId` nuevo.**
Como una solicitud tiene un único viaje (así lo definen ustedes y ahora también nosotros), si un
conductor cancela y M5 vuelve a buscar conductor, M5 tiene que crear el viaje nuevo con un
`requestId` nuevo. Si usa el mismo, recibe el viaje cancelado. Lo vamos a confirmar con M5
(grupos 4 y 13); si les preguntan a ustedes, conviene que digamos lo mismo.

**D. `durationMinutes` al finalizar.**
Podemos aceptarlo e ignorarlo, porque igual calculamos la duración nosotros. Así un cliente de
ustedes funcionaría sin cambios. Lo mismo para `vehicleType` al crear: podríamos hacerlo opcional,
aunque preferimos que M5 lo mande porque M7 lo necesita.

---

## Próximos pasos

1. Ustedes revisan este documento y nuestros contratos.
2. Hacemos una llamada corta, o lo charlamos por mensaje, para cerrar los cuatro puntos de la
   sección 4.
3. Cada grupo adapta su implementación. Nosotros ya hicimos lo de la sección 2.
4. Dejamos el contrato acordado en los dos repositorios, idéntico, y se lo pasamos al equipo
   integrador.

Cualquier duda o desacuerdo con algún paso, avísennos: la idea es llegar a un contrato que les
sirva a los dos.

¡Gracias!
**Grupo 5 – Desarrollo de Software 2026**
