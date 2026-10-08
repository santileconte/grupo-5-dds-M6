# Acuerdos de integración con otros grupos

M6 sólo funciona si los demás módulos lo llaman y escuchan sus eventos de la forma que definimos.
Este documento junta, para cada grupo:
- qué necesitamos acordar;
- nuestra propuesta concreta;
- las preguntas abiertas;
- un **mensaje listo para mandar** (WhatsApp, Discord o mail).

Cada módulo tiene **dos implementaciones**, así que el mismo mensaje va a los dos grupos de ese
módulo (tabla de "Grupos y Módulos" de la consigna). Para M1 la consigna no asigna grupo, así que
la consulta va a la cátedra.

Cuando un acuerdo se cierre:
1. marcarlo en la tabla de seguimiento;
2. anotar lo decidido en la sección del módulo;
3. si cambia algo del contrato, actualizar `contratos/` y registrar el cambio en la bitácora.

## Seguimiento

| Módulo | Grupos | Tema principal | Prioridad | Estado |
|---|---|---|---|---|
| M5 Despacho | 4 y 13 | Cómo se crea el viaje y cómo vuelve una solicitud al despacho | 🔴 Alta | ⬜ Sin enviar |
| M8 Notificaciones | 7 y 10 | Generación y validación del QR | 🔴 Alta | ⬜ Sin enviar |
| M1 Identidad | Cátedra | Formato del token (claims y firma) | 🔴 Alta | ⬜ Sin enviar |
| M6 (otra impl.) | 12 | Unificar el contrato de M6 | 🔴 Alta | ⬜ Sin enviar |
| M7 Pagos | 6 y 11 | Datos para cobro y cargo de cancelación | 🟡 Media | ⬜ Sin enviar |
| M4 Ubicación | 3 y 14 | Liberar al conductor al terminar o cancelar | 🟡 Media | ⬜ Sin enviar |
| M2 Clientes | 1 y 17 | Historial de viajes y calificación | 🟢 Baja | ⬜ Sin enviar |
| M3 Conductores | 2 y 15 | Calificación del cliente | 🟢 Baja | ⬜ Sin enviar |
| M9 Reservas | 8 y 9 | Viajes originados en reservas | 🟢 Baja | ⬜ Sin enviar |
| Todos | — | Convenciones comunes (errores, eventos, correlación) | 🔴 Alta | ⬜ Sin enviar |

Estados: ⬜ Sin enviar · 📤 Enviado · 💬 En discusión · ✅ Acordado

Los contratos completos están en el repositorio:
- `contratos/m6-viajes.openapi.yaml`: la API.
- `contratos/eventos/m6-viajes.asyncapi.yaml`: los eventos.
- `docs/catalogo-eventos.md`: versión legible de los eventos.

Conviene adjuntar los archivos o compartir el link al repo junto con cada mensaje.

---

## Para todos: convenciones comunes

**Por qué:** si cada grupo usa un formato de error, de evento o de token distinto, la integración
del TP2 se vuelve muy difícil. Lo ideal es acordarlo una sola vez para todos.

**Propuesta:**

| Tema | Propuesta |
|---|---|
| Errores HTTP | `application/problem+json` (RFC 9457) con un campo `codigo` estable en MAYÚSCULAS. Ej.: `{ "status": 409, "codigo": "TRANSICION_INVALIDA", "detail": "..." }` |
| Correlación | Header `X-Correlation-Id`: si llega se propaga a las llamadas y eventos siguientes; si no, se genera. |
| Broker | RabbitMQ, un exchange `movilidad.eventos` de tipo `topic`. |
| Routing key | `<modulo>.<entidad>.<hecho-en-pasado>`. Ej.: `viajes.viaje.finalizado`, `despacho.asignacion.confirmada`. |
| Sobre de eventos | `{ idEvento, tipo, version, ocurridoEn, productor, idCorrelacion, datos }` |
| Entrega | Al menos una vez: cada consumidor descarta duplicados por `idEvento`. |
| Privacidad | Los eventos no llevan coordenadas, datos personales ni secretos. |
| Ids y fechas | UUID para ids; fechas ISO 8601 en UTC. |

**Mensaje para el grupo general:**

> Hola a todos, somos el Grupo 5 (M6 – Viajes). Para que la integración del TP2 sea más simple,
> proponemos usar las mismas convenciones en todos los módulos:
> - Errores HTTP en formato `application/problem+json` con un campo `codigo` fijo (ej. `"codigo": "TRANSICION_INVALIDA"`).
> - Header `X-Correlation-Id` para seguir un pedido entre módulos.
> - RabbitMQ con un único exchange `movilidad.eventos` (topic) y routing keys `<modulo>.<entidad>.<hecho>` (ej. `viajes.viaje.finalizado`).
> - Todos los eventos con el mismo sobre: `idEvento, tipo, version, ocurridoEn, productor, idCorrelacion, datos`.
> - Ids UUID y fechas ISO 8601 en UTC.
>
> Lo tenemos documentado en `docs/catalogo-eventos.md` de nuestro repo. ¿Les sirve? ¿Alguien
> prefiere otra cosa? Si les parece, armamos un catálogo común donde cada grupo agregue sus eventos.

---

## M5 – Solicitud y Despacho (Grupos 4 y 13) 🔴

**Qué necesitamos:** M5 es quien **crea** el viaje en M6. Además, cuando un conductor cancela antes
de empezar, la solicitud tiene que **volver** a M5 para buscar otro conductor.

**Propuesta:**

1. **Creación síncrona.** Cuando M5 confirma la asignación única, llama a `POST /viajes` con un
   token de servicio:
   ```json
   {
     "solicitudId": "uuid",
     "asignacionId": "uuid",
     "reservaId": "uuid o null",
     "clienteId": "uuid",
     "conductorId": "uuid",
     "vehiculoId": "uuid",
     "tipoVehiculo": "AUTO | MOTO",
     "origen":  { "latitud": -34.60, "longitud": -58.38, "direccion": "opcional" },
     "destino": { "latitud": -34.58, "longitud": -58.39, "direccion": "opcional" }
   }
   ```
   Respuestas posibles:
   - `201`: viaje creado.
   - `200`: ya existía para ese `asignacionId`; M5 puede reintentar sin duplicar.
   - `409 VIAJE_ACTIVO_EXISTENTE`: la solicitud ya tiene un viaje activo.
2. **Vuelta al despacho por evento.** M5 escucha `viajes.viaje.cancelado`. Si
   `datos.requiereRedespacho` es `true`, vuelve a buscar conductor para `datos.solicitudId`.
   Después crea un viaje nuevo con un `asignacionId` **nuevo**.

**Preguntas abiertas:**
- ¿Tienen un id de asignación (`asignacionId`) distinto del de la solicitud? Lo usamos para que la
  creación sea idempotente.
- ¿Prefieren avisar la asignación por evento (`despacho.asignacion.confirmada`) en lugar de llamar
  a `POST /viajes`? Podemos adaptarnos.
- ¿Quién le avisa a M4 que el conductor quedó ocupado: M5 al asignar, o M4 escuchando eventos?

**Mensaje:**

> Hola, somos el Grupo 5 (M6 – Viajes y Ciclo de Vida). Queremos cerrar con ustedes cómo se
> conectan M5 y M6:
>
> **1) Creación del viaje:** cuando confirman la asignación de un conductor, nos llaman a
> `POST /viajes` (con token de servicio) con `solicitudId, asignacionId, reservaId (o null),
> clienteId, conductorId, vehiculoId, tipoVehiculo (AUTO|MOTO), origen y destino`. Respondemos
> 201 con el viaje, o 200 si ya existía para ese `asignacionId` (así pueden reintentar sin
> duplicar), o 409 si la solicitud ya tiene un viaje activo.
>
> **2) Devolución al despacho:** si el conductor cancela antes de iniciar, publicamos
> `ViajeCancelado` (routing key `viajes.viaje.cancelado`) con `requiereRedespacho: true` y el
> `solicitudId`. Ustedes lo escuchan y vuelven a buscar conductor.
>
> Preguntas: ¿tienen un `asignacionId` propio? ¿Prefieren avisarnos por evento en vez de llamar a
> la API? ¿Quién marca al conductor como ocupado en M4?
>
> Les pasamos el contrato (`contratos/m6-viajes.openapi.yaml`). ¡Gracias!

**Acordado:** _(completar)_

---

## M8 – Notificaciones, Documentos y Soporte (Grupos 7 y 10) 🔴

**Qué necesitamos:** según RF-8.3, el QR de un solo uso lo **genera M8**, y M6 tiene que
**validarlo** para iniciar el viaje (RF-6.4). Además, M8 notifica los hitos y genera el
comprobante a partir de nuestros eventos.

**Propuesta:**

1. **Generación:** M8 escucha `viajes.viaje.creado`, genera un QR temporal de un solo uso para ese
   `viajeId` y se lo muestra al cliente.
2. **Validación:** cuando el conductor escanea el QR, M6 llama a M8:
   ```
   POST {M8}/qr/validaciones
   { "viajeId": "uuid", "codigo": "<texto leído del QR>" }
   → 200 { "valido": true | false }
   ```
   - M8 marca el código como **usado** en esa misma llamada, de forma atómica para que dos
     validaciones simultáneas no den las dos `true`.
   - Si M8 no responde en **2 segundos**, M6 devuelve 503 al conductor y el viaje no cambia de
     estado.
3. **Notificaciones (RF-8.1):** M8 escucha `ViajeCreado`, `ConductorArribado`, `ViajeIniciado`,
   `ViajeFinalizado` y `ViajeCancelado`.
4. **Comprobante (RF-8.4):** a partir de `ViajeFinalizado`, o del evento de cobro de M7 si
   prefieren esperar el importe.

**Preguntas abiertas:**
- ¿El QR contiene un código opaco, o algo firmado (por ejemplo, un JWT)? Para nosotros sólo es un
  texto que les reenviamos.
- ¿Cuánto dura el QR? ¿Se regenera si vence antes de que llegue el conductor?
- ¿Les sirve el endpoint propuesto, o ya definieron otro?

**Mensaje:**

> Hola, somos el Grupo 5 (M6 – Viajes). Necesitamos acordar con ustedes el QR de inicio del viaje
> (RF-8.3 y RF-6.4):
>
> **Generación:** ustedes escuchan nuestro evento `ViajeCreado` (`viajes.viaje.creado`) y generan
> el QR de un solo uso para ese `viajeId`.
>
> **Validación:** cuando el conductor lo escanea, nosotros los llamamos a
> `POST /qr/validaciones` con `{ "viajeId": "...", "codigo": "..." }` y esperamos
> `{ "valido": true/false }`. En esa misma llamada ustedes lo marcan como usado. Si no responden
> en 2 segundos, le devolvemos 503 al conductor y el viaje queda como estaba.
>
> También publicamos `ConductorArribado`, `ViajeIniciado`, `ViajeFinalizado` y `ViajeCancelado`
> para las notificaciones y el comprobante (los campos están en nuestro `docs/catalogo-eventos.md`).
>
> Preguntas: ¿el QR es un código opaco o algo firmado? ¿Cuánto dura? ¿Les sirve ese endpoint o
> ya tienen otro definido? ¡Gracias!

**Acordado:** _(completar)_

---

## M1 – Identidad y Acceso (cátedra) 🔴

**Qué necesitamos:** todos los módulos validan el token que emite M1. Hoy M6 acepta un JWT
firmado con un secreto compartido (HS256) con los claims `sub` y `rol`. Tenemos que confirmar el
formato real.

**Propuesta:**
- JWT con claims:
  - `sub`: id del usuario (UUID), o nombre del módulo para servicios;
  - `rol`: `CLIENTE | CONDUCTOR | OPERADOR | SERVICIO`;
  - `exp`: vencimiento.
- Firma **RS256** con clave pública expuesta en un endpoint JWKS, para que los módulos validen sin
  compartir secretos (RF-1.4). Mientras tanto, HS256 con secreto compartido para desarrollo.
- Tokens de servicio (client credentials) con `rol: SERVICIO` para llamadas entre módulos (M5 → M6,
  M2 → M6).

**Mensaje (consulta a la cátedra):**

> Hola, somos el Grupo 5 (M6). En la tabla de grupos no figura quién implementa M1 (Identidad y
> Acceso). ¿Lo provee la cátedra, o lo simulamos cada grupo? Nosotros estamos validando un JWT
> con los claims `sub` (id del usuario) y `rol` (`CLIENTE`, `CONDUCTOR`, `OPERADOR` o `SERVICIO`
> para llamadas entre módulos). ¿Hay un formato de token definido, o algún proveedor (por ejemplo
> Keycloak) que debamos usar? ¡Gracias!

**Acordado:** _(completar)_

---

## M6 – Otra implementación (Grupo 12) 🔴

**Qué necesitamos:** M6 tiene dos implementaciones. Para que el equipo integrador pueda usar
cualquiera de las dos, **el contrato tiene que ser el mismo**: rutas, campos, estados, errores y
eventos.

**Propuesta:** usar nuestro contrato como base de discusión, revisarlo juntos y unificar las
diferencias. Puntos donde es más probable que hayamos decidido distinto:
- nombres de estados (`ASIGNADO`, `CONDUCTOR_ARRIBADO`, `EN_CURSO`, `FINALIZADO`, `CANCELADO`);
- lista de motivos de cancelación por rol;
- inicio con QR validado contra M8;
- formato de errores y de eventos.

**Mensaje:**

> Hola Grupo 12, somos el Grupo 5, la otra implementación de M6 (Viajes). Como el equipo
> integrador tiene que poder usar cualquiera de las dos, nos parece importante que tengamos el
> mismo contrato. Nosotros ya tenemos:
> - el OpenAPI (`contratos/m6-viajes.openapi.yaml`),
> - los eventos (`contratos/eventos/m6-viajes.asyncapi.yaml`),
> - la máquina de estados (`docs/m6/maquina-de-estados.md`).
>
> ¿Les parece si los comparamos con lo de ustedes y unificamos? Podemos hacer una llamada corta
> o ir comentando por acá. ¡Gracias!

**Acordado:** _(completar)_

---

## M7 – Tarifas, Pagos y Liquidaciones (Grupos 6 y 11) 🟡

**Qué necesitamos:** M7 cobra cuando el viaje termina y decide el cargo si se cancela. M6 **no
calcula importes**: sólo publica los datos.

**Propuesta:**
- **`ViajeFinalizado`** trae `viajeId, solicitudId, reservaId, clienteId, conductorId,
  tipoVehiculo, iniciadoEn, finalizadoEn, distanciaRecorridaMetros, duracionSegundos`. Con eso M7
  calcula el importe final, captura el pago y liquida al conductor.
- **`ViajeCancelado`** trae `canceladoPor, motivo, estadoAlCancelar, creadoEn, arriboEn,
  iniciadoEn, canceladoEn`. Con eso M7 decide si corresponde cargo (RF-7.4), por ejemplo "si
  canceló el cliente después del arribo".
- **`ViajeIniciado`**, si quieren autorizar el pago al inicio.

**Preguntas abiertas:**
- ¿Les alcanzan esos campos? ¿Necesitan el id de la estimación de tarifa que hizo M5?
- ¿Autorizan el pago al crear el viaje, al iniciarlo o recién al finalizar?

**Mensaje:**

> Hola, somos el Grupo 5 (M6 – Viajes). Para el cobro y los cargos de cancelación, nosotros no
> calculamos importes: publicamos eventos con los datos y ustedes deciden.
> - `ViajeFinalizado` (`viajes.viaje.finalizado`): `viajeId, clienteId, conductorId, tipoVehiculo,
>   iniciadoEn, finalizadoEn, distanciaRecorridaMetros, duracionSegundos`.
> - `ViajeCancelado` (`viajes.viaje.cancelado`): `canceladoPor (CLIENTE|CONDUCTOR|OPERADOR),
>   motivo, estadoAlCancelar, creadoEn, arriboEn, iniciadoEn, canceladoEn`.
> - `ViajeIniciado`, por si autorizan el pago al inicio.
>
> ¿Les alcanza con eso? ¿Necesitan algún dato más, como el id de la estimación de tarifa?
> ¡Gracias!

**Acordado:** _(completar)_

---

## M4 – Ubicación y Disponibilidad (Grupos 3 y 14) 🟡

**Qué necesitamos:** cuando un viaje termina o se cancela, el conductor vuelve a estar disponible
(RF-4.4).

**Propuesta:** M4 escucha `ViajeFinalizado` y `ViajeCancelado` y libera al `conductorId`. M6 no
llama a M4.

**Mensaje:**

> Hola, somos el Grupo 5 (M6 – Viajes). Para liberar al conductor cuando termina o se cancela un
> viaje, proponemos que ustedes escuchen nuestros eventos `ViajeFinalizado` y `ViajeCancelado`
> (traen `conductorId`) en vez de que los llamemos. ¿Les sirve así? ¿Quién lo marca como ocupado
> al asignarlo: M5 o ustedes escuchando un evento de M5? ¡Gracias!

**Acordado:** _(completar)_

---

## M2 – Clientes (Grupos 1 y 17) 🟢

**Qué necesitamos:**
- RF-2.4: M2 muestra el historial del cliente **consultando nuestra API**, no nuestra base.
- RF-2.5: la calificación sólo se permite tras un viaje completado.

**Propuesta:**
- **Historial:** `GET /viajes?clienteId=<uuid>&pagina=1&tamanio=20` con token de servicio, o
  reenviando el token del cliente. Devuelve un resumen paginado.
- **Calificación:** M2 escucha `ViajeFinalizado` para habilitar la calificación, o consulta
  `GET /viajes/{id}` y verifica `estado = FINALIZADO`.

**Mensaje:**

> Hola, somos el Grupo 5 (M6 – Viajes). Para el historial del cliente (RF-2.4) tienen
> `GET /viajes?clienteId=...&pagina=1&tamanio=20`, que devuelve un resumen paginado. Pueden
> llamarlo con un token de servicio o con el token del propio cliente. Para habilitar la
> calificación (RF-2.5) pueden escuchar nuestro evento `ViajeFinalizado`, o consultar
> `GET /viajes/{id}` y verificar que `estado` sea `FINALIZADO`. ¿Les sirve? ¡Gracias!

**Acordado:** _(completar)_

---

## M3 – Conductores y Vehículos (Grupos 2 y 15) 🟢

**Qué necesitamos:** RF-3.7, la calificación del cliente por parte del conductor tras un viaje
completado. Es el mismo mecanismo que con M2.

**Mensaje:**

> Hola, somos el Grupo 5 (M6 – Viajes). Para que el conductor califique al cliente (RF-3.7)
> pueden escuchar nuestro evento `ViajeFinalizado` (trae `viajeId, clienteId, conductorId`), o
> consultar `GET /viajes/{id}` y verificar que el estado sea `FINALIZADO`. ¿Les sirve así? ¡Gracias!

**Acordado:** _(completar)_

---

## M9 – Reservas de Viajes (Grupos 8 y 9) 🟢

**Qué necesitamos:** una reserva activada termina en una solicitud de M5, que crea un viaje en M6
con `reservaId`. M9 puede querer saber cómo sigue ese viaje.

**Propuesta:** todos nuestros eventos incluyen `reservaId` (o `null`). M9 los escucha y actualiza
la reserva vinculada, por ejemplo marcándola cumplida con `ViajeFinalizado`.

**Mensaje:**

> Hola, somos el Grupo 5 (M6 – Viajes). Cuando una reserva termina generando un viaje, nos llega
> el `reservaId` desde M5, y todos nuestros eventos (`ViajeCreado`, `ViajeFinalizado`,
> `ViajeCancelado`, etc.) lo incluyen. Si les sirve, pueden escucharlos para actualizar la reserva.
> ¿Necesitan algo más de nuestro lado? ¡Gracias!

**Acordado:** _(completar)_
