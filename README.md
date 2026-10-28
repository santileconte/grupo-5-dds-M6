# Grupo 5 – M6: Viajes y Ciclo de Vida

[![M6 Viajes - CI](https://github.com/santileconte/grupo-5-dds-M6/actions/workflows/m6-viajes.yml/badge.svg)](https://github.com/santileconte/grupo-5-dds-M6/actions/workflows/m6-viajes.yml)

Trabajo práctico de Desarrollo de Software (2026). La consigna plantea una plataforma distribuida
de movilidad urbana bajo demanda, organizada en nueve módulos. Al **Grupo 5** le corresponde
**M6 – Viajes y Ciclo de Vida**, que abarca los estados del viaje, el arribo, el inicio, la
finalización, la cancelación y la auditoría.

## Contenido del repositorio

| Ruta | Contenido |
|---|---|
| [`docs/bitacora-del-trabajo.md`](docs/bitacora-del-trabajo.md) | Registro paso a paso del trabajo realizado y de los problemas encontrados al probar. |
| [`docs/acuerdos-con-otros-grupos.md`](docs/acuerdos-con-otros-grupos.md) | Propuestas de integración y mensajes preparados para cada grupo, con su seguimiento. |
| [`docs/m6/maquina-de-estados.md`](docs/m6/maquina-de-estados.md) | Estados, transiciones, reglas de negocio y temas pending de acordar con otros grupos. |
| [`contratos/m6-viajes.openapi.yaml`](contratos/m6-viajes.openapi.yaml) | Contrato de la API síncrona (OpenAPI 3.1). |
| [`contratos/eventos/m6-viajes.asyncapi.yaml`](contratos/eventos/m6-viajes.asyncapi.yaml) | Eventos que publica M6 (AsyncAPI 3.0). |
| [`docs/catalogo-eventos.md`](docs/catalogo-eventos.md) | Versión legible del catálogo de eventos y convenciones propuestas al consorcio. |
| [`docs/decisiones/`](docs/decisiones) | Registros de decisiones de arquitectura (ADR). |
| [`m6-viajes/`](m6-viajes) | Servicio en TypeScript y NestJS. |
| [`.github/workflows/m6-viajes.yml`](.github/workflows/m6-viajes.yml) | CI: tipos, tests, contratos e imagen Docker en cada push. |

## Servicio `m6-viajes`

Requisitos:
- Node.js 22 (ver `.nvmrc`).
- Docker, para PostgreSQL, RabbitMQ y Redis. GitHub Codespaces ya lo trae instalado.

### Opción A: servicio con Node y base en Docker (para desarrollo)

```bash
cd m6-viajes
cp .env.example .env         # configuración local (sólo la primera vez)
npm ci                       # instala las dependencias exactas del lockfile
npm run infra:levantar       # levanta PostgreSQL, RabbitMQ y Redis en Docker (quedan en segundo plano)
npm run start:dev            # levanta el servicio en http://localhost:3000
```

Al arrancar, el servicio aplica las migraciones pending de `migraciones/` y crea las tablas que
falten. Los datos se conservan aunque se reinicie el servicio o el Codespace.

### Opción B: todo en contenedores (sin Node)

```bash
cd m6-viajes
cp .env.example .env         # sólo la primera vez
npm run docker:levantar      # construye la imagen y levanta toda la infraestructura + el servicio
```

El script equivale a `docker compose up -d --build --wait`, que puede ejecutarse directamente si
no se tiene Node instalado. El servicio queda disponible en http://localhost:3000, igual que con
`start:dev`. Las dos opciones no deben usarse a la vez, porque ambas ocupan el puerto 3000.

### Comandos útiles

| Comando | Para qué |
|---|---|
| `npm test` | Tests unitarios y de integración (con repositorio en memoria, no necesita la base) |
| `npm run test:infra` | Tests de integración contra PostgreSQL, RabbitMQ y Redis reales (necesita `infra:levantar`) |
| `npm run typecheck` | Chequeo de tipos |
| `npm run contratos:validar` | Valida el OpenAPI y el AsyncAPI |
| `npm run infra:levantar` / `infra:detener` | Levanta o detiene PostgreSQL, RabbitMQ y Redis |
| `npm run docker:levantar` / `docker:detener` | Levanta o detiene todo (infraestructura y servicio) en contenedores |
| `npm run docker:logs` | Muestra los logs del servicio en contenedor |
| `npm run db:consola` | Abre `psql` dentro de la base, por ejemplo para `SELECT * FROM viajes;` |
| `npm run token -- <ROL> [id]` | Genera un token de prueba |

Para trabajar **sin Docker** se configuran `PERSISTENCIA=memoria`, `PUBLICADOR_EVENTOS=log` e
`IDEMPOTENCIA=memoria` en `.env`. En ese modo los datos se pierden al reiniciar y los eventos se
muestran en la terminal.

### Ver los eventos en RabbitMQ

Con la infraestructura levantada, la consola de RabbitMQ queda en el puerto **15672** (en
Codespaces, desde la pestaña *Puertos*). El usuario y la clave son `m6` / `m6`.
- En **Exchanges** → `movilidad.eventos` se ve cuántos mensajes se publican.
- Para ver el contenido de los mensajes hay que crear una cola en **Queues** (por ejemplo
  `pruebas`) y, en **Bindings**, enlazarla al exchange `movilidad.eventos` con la routing key
  `viajes.#`.
- Después de una acción en Swagger (crear un viaje, registrar un arribo), los mensajes se leen
  desde la cola con **Get messages**.

### Cómo probar la API desde el navegador

1. Con el servicio levantado, abrir la raíz (`http://localhost:3000/`, o la URL del puerto 3000 en
   Codespaces). Redirige a **`/docs`**, una página Swagger generada a partir del contrato OpenAPI.
2. En otra terminal, generar tokens de prueba (mientras M1 no esté disponible):
   ```bash
   npm run token -- SYSTEM m5-despacho      # para crear viajes (simula a M5)
   npm run token -- DRIVER <driverId>   # el conductor del viaje
   npm run token -- CLIENT <clientId>       # el cliente del viaje
   npm run token -- OPERATOR                  # un operador
   ```
   Si no se indica un id, el script genera uno al azar y lo muestra.
3. En Swagger, usar **Authorize** y pegar el token (sin la palabra `Bearer`).
4. Recorrido sugerido:
   - Con el token de **SYSTEM**: `POST /trips`. De la respuesta se copia el `id`, y se anotan
     el `clientId` y el `driverId` usados.
   - Con el token del **DRIVER** de ese viaje: `POST /trips/{id}/arrived`, luego
     `POST /trips/{id}/start` con `{"verificationToken": "QR-<id del viaje>"}` (QR simulado) y
     por último `POST /trips/{id}/complete` con `{"distanceKm": 4.2}`.
   - `GET /trips/{id}/history` muestra todas las transiciones.
5. Con `PUBLICADOR_EVENTOS=rabbitmq` (el valor de `.env.example`) los eventos se publican en
   RabbitMQ, como se explica en la sección anterior. Con `PUBLICADOR_EVENTOS=log` aparecen en la
   terminal del servicio, con la etiqueta `[Eventos]`.

### Estructura

```
m6-viajes/
├── src/
│   ├── main.ts / app.module.ts        # arranque y armado de NestJS
│   ├── configuracion.ts               # validación de variables de entorno
│   ├── salud/                         # GET /health, /health/details y redirección de / a /docs
│   ├── comun/                         # lo transversal a toda la API
│   │   ├── autenticacion.guard.ts     # verifica el JWT y obtiene id y rol
│   │   ├── correlacion.middleware.ts  # X-Correlation-Id
│   │   ├── problemas.filter.ts        # convierte errores en problem+json
│   │   ├── idempotencia/              # Idempotency-Key: interceptor y almacén (Redis o memoria)
│   │   ├── registro/                  # logs JSON y contexto del pedido (correlationId, tripId)
│   │   ├── limite/                    # límite de pedidos por usuario
│   │   ├── redis/                     # conexión a Redis compartida
│   │   ├── seguridad.ts               # helmet, tamaño máximo del cuerpo y CORS
│   │   └── documentacion.ts           # Swagger UI en /docs desde el contrato
│   └── viajes/
│       ├── dominio/                   # reglas de negocio puras (sin NestJS)
│       ├── aplicacion/                # casos de uso (ViajesService), puertos, eventos
│       ├── infraestructura/           # implementaciones: repositorios, eventos al log, QR
│       │   ├── postgres/              # repositorio y bandeja de salida en PostgreSQL, migraciones
│       │   └── publicador-eventos.rabbitmq.ts  # publicación en RabbitMQ
│       ├── http/                      # controlador, DTOs y formato de respuestas
│       └── viajes.module.ts           # elige qué implementación usa cada puerto
├── migraciones/                       # esquema de la base, en archivos SQL numerados
├── Dockerfile                         # imagen OCI del servicio (se construye desde la raíz)
├── docker-compose.yml                 # PostgreSQL + RabbitMQ + Redis + servicio para desarrollo
├── test/                              # tests de integración (levantan la app y llaman por HTTP)
└── scripts/                           # generar tokens y validar el AsyncAPI
```

**Recorrido de un pedido:** el `controlador` traduce HTTP a datos y llama a `ViajesService`, que
lee el viaje, verifica `If-Match`, aplica la acción del dominio y guarda el viaje y su evento en la
misma transacción. La entidad `Viaje` valida la transición y registra el historial. Por separado,
el `RelevadorDeEventos` publica en RabbitMQ los eventos guardados en la bandeja de salida.

### Salud y logs

- **`GET /health`**: responde `{"estado":"OK"}` si el proceso está vivo. Es el que usa Docker.
- **`GET /health/details`**: informa el estado de PostgreSQL, RabbitMQ y Redis, y cuántos eventos
  esperan ser publicados.
  - `OK`: todas las dependencias responden.
  - `DEGRADED`: falla RabbitMQ o Redis, pero el servicio sigue atendiendo.
  - `ERROR` (HTTP 503): falla PostgreSQL.
- **Logs:** con `LOG_FORMATO=json` (el que usa Docker), cada línea es un JSON con `correlationId`,
  `tripId` y `reservationId`, lo que permite filtrarlas. Por ejemplo:
  ```bash
  npm run docker:logs | grep '"tripId":"<id>"'
  ```
  Con `LOG_FORMATO=texto` (el de `.env.example`) los logs son más legibles durante el desarrollo.

### Seguridad

- **Token obligatorio** y con vencimiento (`exp`). `npm run token` genera tokens válidos por 8 horas.
- **Límite de 120 pedidos por minuto por usuario** (1200 para servicios). Al superarlo se responde
  `429` con `Retry-After`, y cada respuesta incluye `RateLimit-Remaining`.
- **Headers de seguridad** (helmet), cuerpos de hasta 16 KB y CORS cerrado salvo para
  `CORS_ORIGENES`.
- El detalle está en `docs/decisiones/ADR-005-seguridad-web.md`.

### Configuración (`.env`)

| Variable | Descripción | Por defecto |
|---|---|---|
| `PUERTO` | Puerto HTTP | `3000` |
| `LOG_FORMATO` | `json` (estructurado) o `texto` | `json` |
| `PERSISTENCIA` | `postgres` o `memoria` | `memoria` |
| `BASE_DATOS_URL` | Conexión a PostgreSQL, si `PERSISTENCIA=postgres` | — |
| `PUBLICADOR_EVENTOS` | `rabbitmq` o `log` | `log` |
| `RABBITMQ_URL` | Conexión a RabbitMQ, si `PUBLICADOR_EVENTOS=rabbitmq` | — |
| `IDEMPOTENCIA` | `redis` o `memoria`: dónde se guardan las `Idempotency-Key` y los contadores del límite | `memoria` |
| `REDIS_URL` | Conexión a Redis, si `IDEMPOTENCIA=redis` | — |
| `LIMITE_PEDIDOS_POR_MINUTO` | Pedidos por minuto por usuario (0 = sin límite) | `120` |
| `LIMITE_PEDIDOS_SERVICIO_POR_MINUTO` | Ídem para servicios (M5, M2) | `1200` |
| `CORS_ORIGENES` | Orígenes web permitidos, separados por coma | (ninguno) |
| `JWT_EMISOR` / `JWT_AUDIENCIA` | Si se definen, se exigen en el token | — |
| `OUTBOX_INTERVALO_MS` | Cada cuánto se publican los eventos pending (0 = nunca) | `1000` |
| `JWT_SECRETO` | Secreto para verificar los JWT (obligatorio, ≥ 16 caracteres) | — |
| `ESPERA_MINIMA_ARRIBO_MINUTOS` | Espera antes de cancelar por `CLIENT_NO_SHOW` | `5` |
| `VALIDADOR_QR` | `simulado` (código `QR-<tripId>`) o `m8` | `simulado` |
| `M8_URL`, `M8_TIMEOUT_MS` | URL de M8 y timeout en ms, si `VALIDADOR_QR=m8` | —, `2000` |

## Estado

- [x] Máquina de estados del viaje (documento y dominio con tests)
- [x] Contrato OpenAPI
- [x] Catálogo de eventos (AsyncAPI)
- [x] Controladores HTTP de todos los endpoints del contrato, con autenticación JWT, errores
      problem+json, `ETag`/`If-Match`, `Idempotency-Key` y tests de integración
- [ ] Acordar contratos con M5, M7, M8, M1 y el Grupo 12 (ver pending en la máquina de estados)
- [x] Persistencia en PostgreSQL con migraciones, control de versión e historial inmutable
- [x] Dockerfile (imagen versionada `grupo5/m6-viajes:0.1.0`) y docker-compose con base + servicio
- [x] Publicación de eventos en RabbitMQ con bandeja de salida (outbox), sin pérdida de eventos si el broker se cae
- [x] `Idempotency-Key` en Redis: sobrevive a reinicios, funciona con varias instancias y detecta pedidos simultáneos
- [x] CI en GitHub Actions
- [x] Salud y diagnóstico: `/health/details` por dependencia y logs JSON con correlación
- [x] Seguridad web: headers, límite de pedidos, tokens con vencimiento, cuerpos acotados y auditoría de dependencias
