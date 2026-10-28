-- Idempotencia de la creación por requestId (`solicitud_id`), como en el contrato del Grupo 12:
-- una solicitud tiene un único viaje, y repetir POST /trips con los mismos datos devuelve ese viaje.
-- Se elimina `asignacion_id`, que ya no forma parte del contrato.

-- Antes, una solicitud podía tener varios viajes (uno nuevo tras cancelar y volver a despachar).
-- Si hay datos así, hay que resolverlos a mano: la restricción única no se puede crear.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM viajes GROUP BY solicitud_id HAVING count(*) > 1) THEN
        RAISE EXCEPTION 'Hay solicitudes con más de un viaje en la tabla viajes: resolvelo antes de migrar (004)';
    END IF;
END $$;

DROP INDEX viajes_un_activo_por_solicitud;
ALTER TABLE viajes DROP COLUMN asignacion_id; -- también elimina su restricción UNIQUE
ALTER TABLE viajes ADD CONSTRAINT viajes_solicitud_id_key UNIQUE (solicitud_id);
