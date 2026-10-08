# ADR-003: Publicación de eventos con RabbitMQ y bandeja de salida (outbox)

- **Estado:** aceptada
- **Fecha:** 2026-10-08

## Contexto

M6 avisa a otros módulos mediante eventos (RNF-03, RNF-10). El problema clásico es que guardar el
cambio en la base y publicar en el broker son **dos operaciones separadas**. Si una funciona y la
otra no:
- se guardó el viaje pero el evento se perdió (M7 nunca cobra), o
- se publicó un evento de un cambio que después falló (M8 notifica algo que no pasó).

Además, el broker puede estar caído, y eso no debe bloquear los viajes (RNF-13).

## Decisión

- **Broker:** RabbitMQ 3.13, con un exchange `movilidad.eventos` de tipo `topic`. Las routing keys
  son las del contrato AsyncAPI.
- **Patrón transactional outbox:**
  - el evento se inserta en la tabla `eventos_salientes` **dentro de la misma transacción** que el
    cambio del viaje;
  - el `RelevadorDeEventos` corre cada `OUTBOX_INTERVALO_MS`, toma los pendientes en orden
    (`FOR UPDATE SKIP LOCKED`), los publica y los marca;
  - ante el primer fallo se detiene, para no desordenar, y reintenta en la próxima vuelta.
- **Publicación con confirmación** (canal "confirm" de RabbitMQ) y mensajes persistentes. El
  relevador sólo marca un evento como publicado cuando RabbitMQ confirma que lo recibió.
- **Configurable:** `PUBLICADOR_EVENTOS=rabbitmq|log`. Con `log` los eventos se muestran en la
  terminal y no hace falta broker.

## Consecuencias

- **Entrega "al menos una vez":** un evento puede publicarse dos veces si el servicio se cae entre
  publicar y marcar. Los consumidores deben ser idempotentes por `idEvento` (RNF-09).
- **Pequeña demora:** los eventos salen hasta `OUTBOX_INTERVALO_MS` (1 s) después del cambio.
- **Orden:** se respeta con una sola instancia del servicio. Con varias instancias, cada una toma
  eventos distintos y el orden entre ellas no está garantizado. Por eso cada evento lleva
  `versionViaje`, para que el consumidor pueda ignorar uno viejo.
- La tabla `eventos_salientes` crece. Más adelante se puede agregar una limpieza de los eventos
  publicados hace más de N días.
