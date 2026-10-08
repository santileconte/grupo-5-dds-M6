# ADR-002: Persistencia de M6 en PostgreSQL con SQL explícito

- **Estado:** aceptada
- **Fecha:** 2026-10-08

## Contexto

M6 debe controlar su propia persistencia (RNF-05). También tiene que impedir la doble
finalización o la doble transición ante pedidos concurrentes (RNF-08) y mantener un historial
no destructivo (RF-6.8).

## Decisión

- **Motor:** PostgreSQL 16, con una base propia de M6 (`m6_viajes`).
- **Acceso:** driver `pg` con **SQL escrito a mano** en un único archivo
  (`src/viajes/infraestructura/postgres/repositorio-viajes.postgres.ts`), detrás de la interfaz
  `RepositorioViajes`.
- **Esquema:** migraciones SQL numeradas en `m6-viajes/migraciones/`. Se aplican solas al
  arrancar el servicio y quedan registradas en la tabla `migraciones`.
- **Concurrencia:** control optimista con la columna `version`:
  `UPDATE viajes ... WHERE id = $1 AND version = $2`. Si no se actualiza ninguna fila, otro pedido
  ganó y se responde `409 CONFLICTO_CONCURRENCIA`.
- **Historial:** la tabla `transiciones_viaje` sólo admite `INSERT`. Un trigger rechaza `UPDATE` y
  `DELETE`, así que el historial es inmutable aunque haya un error en el código.
- **Unicidades garantizadas por la base, no sólo por el código:**
  - `asignacion_id` es único (un viaje por asignación);
  - un índice único parcial impide dos viajes activos para la misma solicitud.

## Justificación

- Las reglas críticas (versión, unicidad e inmutabilidad) se ven tal cual en el SQL y las
  garantiza la base. Con un ORM quedan ocultas detrás de abstracciones que el grupo todavía no
  conoce.
- Son sólo dos tablas y pocas consultas, así que un ORM (TypeORM o Prisma) suma más configuración
  que beneficio.
- El dominio no depende de la base: el repositorio en memoria sigue disponible
  (`PERSISTENCIA=memoria`) para desarrollar sin Docker y para los tests rápidos.

## Consecuencias

- Agregar un campo implica escribir una migración nueva y actualizar el mapeo del repositorio.
- Las ubicaciones, el cierre y la cancelación se guardan como `JSONB`, porque siempre se leen
  junto con el viaje y nunca se filtra por ellos.
- `npm test` usa el repositorio en memoria; `npm run test:infra` corre los mismos tests de
  integración y los del repositorio contra una base real.
