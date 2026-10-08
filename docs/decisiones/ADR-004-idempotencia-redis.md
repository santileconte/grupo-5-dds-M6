# ADR-004: Claves de `Idempotency-Key` en Redis

- **Estado:** aceptada
- **Fecha:** 2026-10-08

## Contexto

Las acciones de M6 (arribo, inicio, finalización y cancelación) aceptan el header
`Idempotency-Key`. Si un cliente reintenta, por ejemplo porque se le cortó la conexión, recibe la
misma respuesta sin que la acción se ejecute dos veces (RNF-09). Hasta ahora esas respuestas se
guardaban en memoria, lo que trae tres problemas:
- se perdían al reiniciar el servicio;
- no servían con más de una instancia;
- dos pedidos simultáneos con la misma clave podían ejecutarse los dos.

RNF-11 pide Redis para el estado efímero con vencimiento.

## Decisión

- **Dónde se guardan:** Redis 7.4 (cliente `ioredis`), configurable con
  `IDEMPOTENCIA=redis|memoria`.
- **Reserva atómica:** cada clave se reserva con `SET clave valor NX PX`. Sólo un pedido puede
  reservarla, aunque lleguen a la vez a instancias distintas. Mientras se procesa, otro pedido con
  la misma clave recibe `409 PEDIDO_EN_CURSO`.
- **Vencimiento:**
  - una respuesta exitosa se guarda **24 horas**;
  - una reserva "en curso" vence a los **30 segundos**, por si el proceso se cae a mitad de un
    pedido.
- **Los errores no se guardan:** la clave se libera y el cliente puede reintentar.
- **Huella del cuerpo:** si la misma clave se reutiliza con un cuerpo distinto, se responde
  `422 CLAVE_IDEMPOTENCIA_REUTILIZADA`.
- **Formato de la clave:** `m6:idempotencia:<usuario>:<método>:<ruta>:<Idempotency-Key>`.

## Si Redis no está disponible (RNF-13)

Los comandos tienen timeout de 1 segundo y no se encolan. Si Redis no responde, el pedido **se
procesa igual, sin idempotencia**, y se registra un aviso en el log. Se eligió así porque las
reglas del dominio siguen impidiendo efectos duplicados aunque no haya Redis: la versión del viaje
y la máquina de estados hacen que un reintento de "finalizar" responda `409 TRANSICION_INVALIDA`
en lugar de finalizar dos veces (RNF-08). Bloquear todas las acciones porque se cayó una caché
sería peor para el usuario.

## Consecuencias

- Un reintento durante una caída de Redis recibe `409` en lugar de la respuesta original. El viaje
  queda bien; sólo cambia la respuesta.
- Redis no necesita volumen ni backups: todo lo que guarda vence solo.
