-- Esquema inicial de M6. Sólo M6 accede a estas tablas (RNF-05): los demás módulos usan la API o los eventos.

CREATE TABLE viajes (
    id             UUID PRIMARY KEY,
    solicitud_id   UUID        NOT NULL,
    -- Una asignación de M5 genera como máximo un viaje (idempotencia de POST /viajes).
    asignacion_id  UUID        NOT NULL UNIQUE,
    reserva_id     UUID,
    cliente_id     UUID        NOT NULL,
    conductor_id   UUID        NOT NULL,
    vehiculo_id    UUID        NOT NULL,
    tipo_vehiculo  TEXT        NOT NULL CHECK (tipo_vehiculo IN ('AUTO', 'MOTO')),
    origen         JSONB       NOT NULL,
    destino        JSONB       NOT NULL,
    estado         TEXT        NOT NULL CHECK (estado IN ('ASIGNADO', 'CONDUCTOR_ARRIBADO', 'EN_CURSO', 'FINALIZADO', 'CANCELADO')),
    -- Control de concurrencia optimista (RNF-08): cada transición incrementa la versión.
    version        INTEGER     NOT NULL CHECK (version >= 1),
    creado_en      TIMESTAMPTZ NOT NULL,
    arribo_en      TIMESTAMPTZ,
    iniciado_en    TIMESTAMPTZ,
    finalizado_en  TIMESTAMPTZ,
    cancelado_en   TIMESTAMPTZ,
    cierre         JSONB,
    cancelacion    JSONB
);

-- Una solicitud no puede tener dos viajes activos a la vez. Si el viaje se cancela y M5
-- vuelve a despachar, la misma solicitud puede tener un viaje nuevo.
CREATE UNIQUE INDEX viajes_un_activo_por_solicitud
    ON viajes (solicitud_id)
    WHERE estado NOT IN ('FINALIZADO', 'CANCELADO');

CREATE INDEX viajes_por_cliente   ON viajes (cliente_id, creado_en DESC);
CREATE INDEX viajes_por_conductor ON viajes (conductor_id, creado_en DESC);
CREATE INDEX viajes_por_fecha     ON viajes (creado_en DESC);

-- Historial no destructivo (RF-6.8): una fila por transición, nunca se modifica ni se borra.
CREATE TABLE transiciones_viaje (
    viaje_id     UUID        NOT NULL REFERENCES viajes (id),
    secuencia    INTEGER     NOT NULL CHECK (secuencia >= 1),
    desde        TEXT,
    hacia        TEXT        NOT NULL,
    accion       TEXT        NOT NULL,
    actor_rol    TEXT        NOT NULL,
    actor_id     TEXT        NOT NULL,
    ocurrido_en  TIMESTAMPTZ NOT NULL,
    motivo       TEXT,
    detalle      TEXT,
    PRIMARY KEY (viaje_id, secuencia)
);

CREATE FUNCTION impedir_cambios_en_historial() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'El historial de un viaje no se puede modificar ni borrar (RF-6.8)';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER transiciones_viaje_inmutables
    BEFORE UPDATE OR DELETE ON transiciones_viaje
    FOR EACH ROW EXECUTE FUNCTION impedir_cambios_en_historial();
