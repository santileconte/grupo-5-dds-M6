-- Bandeja de salida de eventos (patrón "transactional outbox").
-- Cada evento se inserta en la MISMA transacción que el cambio del viaje que lo origina.
-- El RelevadorDeEventos los publica en RabbitMQ y completa `publicado_en`.

CREATE TABLE eventos_salientes (
    -- Orden en que se generaron los eventos: se publican en ese orden.
    secuencia     BIGSERIAL   PRIMARY KEY,
    id_evento     UUID        NOT NULL UNIQUE,
    tipo          TEXT        NOT NULL,
    routing_key   TEXT        NOT NULL,
    cuerpo        JSONB       NOT NULL,
    creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
    publicado_en  TIMESTAMPTZ,
    intentos      INTEGER     NOT NULL DEFAULT 0,
    ultimo_error  TEXT
);

-- Hace rápida la búsqueda de pendientes aunque la tabla tenga muchos eventos ya publicados.
CREATE INDEX eventos_salientes_pendientes ON eventos_salientes (secuencia) WHERE publicado_en IS NULL;
