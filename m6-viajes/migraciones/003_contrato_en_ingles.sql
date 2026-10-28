-- Adecuación al contrato del Grupo 12 (M6 compartido):
--   1. Vocabulario del dominio en inglés: estados, roles, acciones, motivos y tipos de vehículo.
--   2. Modelo de datos más preciso: las coordenadas pasan de objetos JSONB a columnas `double precision`
--      y la distancia recorrida de metros enteros a kilómetros decimales.
-- Los nombres de tablas y columnas no cambian: son internos de M6 (RNF-05).

-- Los eventos que siguen en la bandeja están guardados con el formato anterior (nombres y campos en
-- español). Hay que dejar que se publiquen antes de migrar; si no, saldrían con el contrato viejo.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM eventos_salientes WHERE publicado_en IS NULL) THEN
        RAISE EXCEPTION 'Hay eventos pendientes en eventos_salientes: esperá a que se publiquen antes de migrar (003)';
    END IF;
END $$;

-- Valores viejos -> nuevos. No hay claves repetidas entre los dominios (estado, rol, acción, motivo, vehículo).
CREATE TEMP TABLE traduccion (viejo TEXT PRIMARY KEY, nuevo TEXT NOT NULL) ON COMMIT DROP;
INSERT INTO traduccion (viejo, nuevo) VALUES
    ('ASIGNADO', 'PENDING_ARRIVAL'),
    ('CONDUCTOR_ARRIBADO', 'DRIVER_ARRIVED'),
    ('EN_CURSO', 'IN_PROGRESS'),
    ('FINALIZADO', 'COMPLETED'),
    ('CANCELADO', 'CANCELLED'),
    ('CLIENTE', 'CLIENT'),
    ('CONDUCTOR', 'DRIVER'),
    ('OPERADOR', 'OPERATOR'),
    ('SERVICIO', 'SYSTEM'),
    ('AUTO', 'CAR'),
    ('MOTO', 'MOTORCYCLE'),
    ('CREAR', 'CREATE'),
    ('REGISTRAR_ARRIBO', 'REGISTER_ARRIVAL'),
    ('INICIAR', 'START'),
    ('FINALIZAR', 'COMPLETE'),
    ('CANCELAR', 'CANCEL'),
    ('CAMBIO_DE_PLANES', 'CHANGE_OF_PLANS'),
    ('DEMORA_EXCESIVA', 'EXCESSIVE_DELAY'),
    ('CONDUCTOR_NO_SE_PRESENTO', 'DRIVER_NO_SHOW'),
    ('CLIENTE_NO_SE_PRESENTO', 'CLIENT_NO_SHOW'),
    ('PROBLEMA_CON_VEHICULO', 'VEHICLE_PROBLEM'),
    ('ORIGEN_INACCESIBLE', 'ORIGIN_UNREACHABLE'),
    ('INCIDENTE_DE_SEGURIDAD', 'SECURITY_INCIDENT'),
    ('BLOQUEO_ADMINISTRATIVO', 'ADMINISTRATIVE_BLOCK'),
    ('OTRO', 'OTHER');

-- Las restricciones y el índice parcial dependen de los valores viejos: se recrean al final.
ALTER TABLE viajes DROP CONSTRAINT viajes_estado_check;
ALTER TABLE viajes DROP CONSTRAINT viajes_tipo_vehiculo_check;
DROP INDEX viajes_un_activo_por_solicitud;

UPDATE viajes v
   SET estado = (SELECT nuevo FROM traduccion WHERE viejo = v.estado),
       tipo_vehiculo = (SELECT nuevo FROM traduccion WHERE viejo = v.tipo_vehiculo);

-- El historial es inmutable (trigger): se desactiva sólo durante esta migración.
ALTER TABLE transiciones_viaje DISABLE TRIGGER transiciones_viaje_inmutables;
UPDATE transiciones_viaje t
   SET desde     = (SELECT nuevo FROM traduccion WHERE viejo = t.desde),
       hacia     = (SELECT nuevo FROM traduccion WHERE viejo = t.hacia),
       accion    = (SELECT nuevo FROM traduccion WHERE viejo = t.accion),
       actor_rol = (SELECT nuevo FROM traduccion WHERE viejo = t.actor_rol),
       motivo    = (SELECT nuevo FROM traduccion WHERE viejo = t.motivo);
ALTER TABLE transiciones_viaje ENABLE TRIGGER transiciones_viaje_inmutables;

-- Cancelación: claves en inglés y valores traducidos.
UPDATE viajes v
   SET cancelacion = jsonb_strip_nulls(jsonb_build_object(
         'cancelledBy',        (SELECT nuevo FROM traduccion WHERE viejo = v.cancelacion ->> 'canceladoPor'),
         'actorId',            v.cancelacion -> 'actorId',
         'reason',             (SELECT nuevo FROM traduccion WHERE viejo = v.cancelacion ->> 'motivo'),
         'detail',             v.cancelacion -> 'detalle',
         'previousState',      (SELECT nuevo FROM traduccion WHERE viejo = v.cancelacion ->> 'estadoAlCancelar'),
         'requiresRedispatch', v.cancelacion -> 'requiereRedespacho'))
 WHERE v.cancelacion IS NOT NULL;

-- Cierre: metros enteros -> kilómetros decimales, y la ubicación final como dos campos sueltos.
UPDATE viajes v
   SET cierre = jsonb_strip_nulls(jsonb_build_object(
         'distanceKm',      round((v.cierre ->> 'distanciaRecorridaMetros')::numeric / 1000.0, 3),
         'durationSeconds', v.cierre -> 'duracionSegundos',
         'finalLatitude',   v.cierre -> 'ubicacionFinal' -> 'latitud',
         'finalLongitude',  v.cierre -> 'ubicacionFinal' -> 'longitud'))
 WHERE v.cierre IS NOT NULL;

-- Origen y destino: de objetos JSONB a columnas `double precision` (más la dirección, opcional).
ALTER TABLE viajes
    ADD COLUMN origen_latitud    DOUBLE PRECISION,
    ADD COLUMN origen_longitud   DOUBLE PRECISION,
    ADD COLUMN origen_direccion  TEXT,
    ADD COLUMN destino_latitud   DOUBLE PRECISION,
    ADD COLUMN destino_longitud  DOUBLE PRECISION,
    ADD COLUMN destino_direccion TEXT;

UPDATE viajes
   SET origen_latitud    = (origen ->> 'latitud')::double precision,
       origen_longitud   = (origen ->> 'longitud')::double precision,
       origen_direccion  = origen ->> 'direccion',
       destino_latitud   = (destino ->> 'latitud')::double precision,
       destino_longitud  = (destino ->> 'longitud')::double precision,
       destino_direccion = destino ->> 'direccion';

ALTER TABLE viajes
    ALTER COLUMN origen_latitud   SET NOT NULL,
    ALTER COLUMN origen_longitud  SET NOT NULL,
    ALTER COLUMN destino_latitud  SET NOT NULL,
    ALTER COLUMN destino_longitud SET NOT NULL,
    ADD CONSTRAINT viajes_origen_latitud_check   CHECK (origen_latitud   BETWEEN -90  AND 90),
    ADD CONSTRAINT viajes_origen_longitud_check  CHECK (origen_longitud  BETWEEN -180 AND 180),
    ADD CONSTRAINT viajes_destino_latitud_check  CHECK (destino_latitud  BETWEEN -90  AND 90),
    ADD CONSTRAINT viajes_destino_longitud_check CHECK (destino_longitud BETWEEN -180 AND 180),
    DROP COLUMN origen,
    DROP COLUMN destino;

-- Restricciones e índice, ahora con los valores nuevos.
ALTER TABLE viajes
    ADD CONSTRAINT viajes_estado_check
        CHECK (estado IN ('PENDING_ARRIVAL', 'DRIVER_ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
    ADD CONSTRAINT viajes_tipo_vehiculo_check
        CHECK (tipo_vehiculo IN ('CAR', 'MOTORCYCLE'));

CREATE UNIQUE INDEX viajes_un_activo_por_solicitud
    ON viajes (solicitud_id)
    WHERE estado NOT IN ('COMPLETED', 'CANCELLED');
