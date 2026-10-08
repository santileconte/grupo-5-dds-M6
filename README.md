# Grupo 5 – M6: Viajes y Ciclo de Vida

Desarrollo de Software 2026. La consigna describe una plataforma distribuida de movilidad urbana
bajo demanda con nueve módulos. Al **Grupo 5** le corresponde **M6 – Viajes y Ciclo de Vida**:
estados del viaje, arribo, inicio, finalización, cancelación y auditoría.

## Contenido del repositorio

| Ruta | Qué hay |
|---|---|
| [`docs/m6/maquina-de-estados.md`](docs/m6/maquina-de-estados.md) | Estados, transiciones, reglas de negocio y temas pendientes de acordar con otros grupos. |
| [`contratos/m6-viajes.openapi.yaml`](contratos/m6-viajes.openapi.yaml) | Contrato de la API síncrona (OpenAPI 3.1). |
| [`contratos/eventos/m6-viajes.asyncapi.yaml`](contratos/eventos/m6-viajes.asyncapi.yaml) | Eventos que publica M6 (AsyncAPI 3.0). |
| [`docs/catalogo-eventos.md`](docs/catalogo-eventos.md) | Catálogo legible de eventos y convenciones propuestas al consorcio. |
| [`docs/decisiones/`](docs/decisiones) | Decisiones de arquitectura (ADR). |
| [`m6-viajes/`](m6-viajes) | Servicio en TypeScript y NestJS. |

## Servicio `m6-viajes`

Requisitos: Node.js 22 (ver `.nvmrc`).

```bash
cd m6-viajes
cp .env.example .env         # configuración local (sólo la primera vez)
npm ci                       # instala las dependencias exactas del lockfile
npm test                     # tests unitarios y de integración
npm run typecheck            # chequeo de tipos
npm run contratos:validar    # valida el OpenAPI y el AsyncAPI
npm run start:dev            # levanta el servicio en http://localhost:3000
```

### Cómo probar la API desde el navegador

1. Con el servicio levantado, abrí la raíz (`http://localhost:3000/`, o la URL del puerto 3000 en
   Codespaces). Redirige a **`/docs`**, una página Swagger generada desde el contrato OpenAPI.
2. En otra terminal, generá tokens de prueba (mientras M1 no exista):
   ```bash
   npm run token -- SERVICIO m5-despacho      # para crear viajes (simula a M5)
   npm run token -- CONDUCTOR <conductorId>   # el conductor del viaje
   npm run token -- CLIENTE <clienteId>       # el cliente del viaje
   npm run token -- OPERADOR                  # un operador
   ```
   Sin id, se genera uno al azar y se muestra.
3. En Swagger, tocá **Authorize** y pegá el token (sin la palabra `Bearer`).
4. Recorrido sugerido:
   - Con el token de **SERVICIO**: `POST /viajes` → copiá el `id` de la respuesta, y el
     `clienteId` y el `conductorId` que usaste.
   - Con el token del **CONDUCTOR** de ese viaje: `POST /viajes/{id}/arribo`, después
     `POST /viajes/{id}/inicio` con `{"codigoVerificacion": "QR-<id del viaje>"}` (QR simulado) y
     `POST /viajes/{id}/finalizacion` con `{"distanciaRecorridaMetros": 4200}`.
   - `GET /viajes/{id}/historial` para ver todas las transiciones.
5. Los eventos que en TP2 irán a RabbitMQ aparecen por ahora en la terminal del servicio,
   con la etiqueta `[Eventos]`.

Los datos se guardan **en memoria**: se pierden al reiniciar el servicio.

### Estructura

```
m6-viajes/
├── src/
│   ├── main.ts / app.module.ts        # arranque y armado de NestJS
│   ├── configuracion.ts               # validación de variables de entorno
│   ├── salud/                         # GET /salud y redirección de / a /docs
│   ├── comun/                         # lo transversal a toda la API
│   │   ├── autenticacion.guard.ts     # verifica el JWT y obtiene id y rol
│   │   ├── correlacion.middleware.ts  # X-Correlation-Id
│   │   ├── problemas.filter.ts        # convierte errores en problem+json
│   │   ├── idempotencia.interceptor.ts# Idempotency-Key
│   │   └── documentacion.ts           # Swagger UI en /docs desde el contrato
│   └── viajes/
│       ├── dominio/                   # reglas de negocio puras (sin NestJS)
│       ├── aplicacion/                # casos de uso (ViajesService), puertos, eventos
│       ├── infraestructura/           # implementaciones: repositorio en memoria, eventos al log, QR
│       ├── http/                      # controlador, DTOs y formato de respuestas
│       └── viajes.module.ts           # elige qué implementación usa cada puerto
├── test/                              # tests de integración (levantan la app y llaman por HTTP)
└── scripts/                           # generar tokens y validar el AsyncAPI
```

**Cómo viaja un pedido:** `controlador` (HTTP → datos) → `ViajesService` (lee el viaje, verifica
`If-Match`, aplica la acción del dominio, guarda con control de versión y publica el evento) →
`Viaje` (valida la transición y registra el historial).

### Configuración (`.env`)

| Variable | Descripción | Por defecto |
|---|---|---|
| `PUERTO` | Puerto HTTP | `3000` |
| `JWT_SECRETO` | Secreto para verificar los JWT (obligatorio, ≥ 16 caracteres) | — |
| `ESPERA_MINIMA_ARRIBO_MINUTOS` | Espera antes de cancelar por `CLIENTE_NO_SE_PRESENTO` | `5` |
| `VALIDADOR_QR` | `simulado` (código `QR-<viajeId>`) o `m8` | `simulado` |
| `M8_URL`, `M8_TIMEOUT_MS` | URL de M8 y timeout en ms, si `VALIDADOR_QR=m8` | —, `2000` |

## Estado

- [x] Máquina de estados del viaje (documento y dominio con tests)
- [x] Contrato OpenAPI
- [x] Catálogo de eventos (AsyncAPI)
- [x] Controladores HTTP de todos los endpoints del contrato, con autenticación JWT, errores
      problem+json, `ETag`/`If-Match`, `Idempotency-Key` y tests de integración
- [ ] Acordar contratos con M5, M7, M8, M1 y el Grupo 12 (ver pendientes en la máquina de estados)
- [ ] Persistencia en PostgreSQL (reemplaza al repositorio en memoria)
- [ ] Dockerfile y docker-compose
- [ ] Publicación de eventos en RabbitMQ con outbox (TP2)
