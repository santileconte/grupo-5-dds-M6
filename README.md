# Grupo 5 – M6: Viajes y Ciclo de Vida

[![M6 Viajes - CI](https://github.com/facundoros9/grupo-5-dds/actions/workflows/m6-viajes.yml/badge.svg)](https://github.com/facundoros9/grupo-5-dds/actions/workflows/m6-viajes.yml)

Desarrollo de Software 2026. La consigna describe una plataforma distribuida de movilidad urbana
bajo demanda con nueve módulos. Al **Grupo 5** le corresponde **M6 – Viajes y Ciclo de Vida**:
estados del viaje, arribo, inicio, finalización, cancelación y auditoría.

## Contenido del repositorio

| Ruta | Qué hay |
|---|---|
| [`docs/bitacora-del-trabajo.md`](docs/bitacora-del-trabajo.md) | Recorrido paso a paso de todo lo hecho hasta ahora, con los problemas encontrados al probar. |
| [`docs/acuerdos-con-otros-grupos.md`](docs/acuerdos-con-otros-grupos.md) | Propuestas de integración y mensajes listos para cada grupo, con su seguimiento. |
| [`docs/m6/maquina-de-estados.md`](docs/m6/maquina-de-estados.md) | Estados, transiciones, reglas de negocio y temas pendientes de acordar con otros grupos. |
| [`contratos/m6-viajes.openapi.yaml`](contratos/m6-viajes.openapi.yaml) | Contrato de la API síncrona (OpenAPI 3.1). |
| [`contratos/eventos/m6-viajes.asyncapi.yaml`](contratos/eventos/m6-viajes.asyncapi.yaml) | Eventos que publica M6 (AsyncAPI 3.0). |
| [`docs/catalogo-eventos.md`](docs/catalogo-eventos.md) | Catálogo legible de eventos y convenciones propuestas al consorcio. |
| [`docs/decisiones/`](docs/decisiones) | Decisiones de arquitectura (ADR). |
| [`m6-viajes/`](m6-viajes) | Servicio en TypeScript y NestJS. |
| [`.github/workflows/m6-viajes.yml`](.github/workflows/m6-viajes.yml) | CI: tipos, tests, contratos e imagen Docker en cada push. |

## Servicio `m6-viajes`

Requisitos:
- Node.js 22 (ver `.nvmrc`).
- Docker, para PostgreSQL, RabbitMQ y Redis. En GitHub Codespaces ya viene instalado.

### Opción A: servicio con Node y base en Docker (para programar)

```bash
cd m6-viajes
cp .env.example .env         # configuración local (sólo la primera vez)
npm ci                       # instala las dependencias exactas del lockfile
npm run infra:levantar       # levanta PostgreSQL, RabbitMQ y Redis en Docker (quedan en segundo plano)
npm run start:dev            # levanta el servicio en http://localhost:3000
```

Al arrancar, el servicio crea las tablas que falten (migraciones de `migraciones/`). Los datos
quedan guardados aunque reinicies el servicio o el Codespace.

### Opción B: todo en contenedores (sin Node)

```bash
cd m6-viajes
cp .env.example .env         # sólo la primera vez
npm run docker:levantar      # construye la imagen y levanta toda la infraestructura + el servicio
```

Equivale a `docker compose up -d --build --wait`; si no tenés Node, podés correr ese comando
directamente. El servicio queda en http://localhost:3000, igual que con `start:dev`. No uses las
dos opciones a la vez, porque las dos usan el puerto 3000.

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

Para trabajar **sin Docker**, poné `PERSISTENCIA=memoria`, `PUBLICADOR_EVENTOS=log` e
`IDEMPOTENCIA=memoria` en `.env`.
Los datos se pierden al reiniciar y los eventos se muestran en la terminal.

### Ver los eventos en RabbitMQ

Con la infraestructura levantada, abrí la consola de RabbitMQ en el puerto **15672**. En
Codespaces está en la pestaña *Puertos*. Usuario y clave: `m6` / `m6`.
- En **Exchanges** → `movilidad.eventos` se ve cuántos mensajes se publican.
- Para ver su contenido, creá una cola en **Queues** (por ejemplo `pruebas`) y en
  **Bindings** enlazala al exchange `movilidad.eventos` con la routing key `viajes.#`.
- Hacé algo en Swagger (crear un viaje, registrar un arribo) y en la cola usá **Get messages**.

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

### Estructura

```
m6-viajes/
├── src/
│   ├── main.ts / app.module.ts        # arranque y armado de NestJS
│   ├── configuracion.ts               # validación de variables de entorno
│   ├── salud/                         # GET /salud, /salud/detalle y redirección de / a /docs
│   ├── comun/                         # lo transversal a toda la API
│   │   ├── autenticacion.guard.ts     # verifica el JWT y obtiene id y rol
│   │   ├── correlacion.middleware.ts  # X-Correlation-Id
│   │   ├── problemas.filter.ts        # convierte errores en problem+json
│   │   ├── idempotencia/              # Idempotency-Key: interceptor y almacén (Redis o memoria)
│   │   ├── registro/                  # logs JSON y contexto del pedido (idCorrelacion, viajeId)
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

**Cómo viaja un pedido:** `controlador` (HTTP → datos) → `ViajesService` (lee el viaje, verifica
`If-Match`, aplica la acción del dominio y guarda el viaje y su evento en la misma transacción) →
`Viaje` (valida la transición y registra el historial). Aparte, el `RelevadorDeEventos` publica en
RabbitMQ los eventos guardados en la bandeja de salida.

### Salud y logs

- **`GET /salud`**: responde `{"estado":"OK"}` si el proceso está vivo. Lo usa Docker.
- **`GET /salud/detalle`**: estado de PostgreSQL, RabbitMQ y Redis, y cuántos eventos esperan
  publicarse.
  - `OK`: todo responde.
  - `DEGRADADO`: falla RabbitMQ o Redis, pero se sigue atendiendo.
  - `ERROR` (HTTP 503): falla PostgreSQL.
- **Logs:** con `LOG_FORMATO=json` (el de Docker), cada línea es un JSON con `idCorrelacion`,
  `viajeId` y `reservaId`, que se puede filtrar. Ejemplo:
  ```bash
  npm run docker:logs | grep '"viajeId":"<id>"'
  ```
  Con `LOG_FORMATO=texto` (el de `.env.example`), los logs son más legibles al programar.

### Configuración (`.env`)

| Variable | Descripción | Por defecto |
|---|---|---|
| `PUERTO` | Puerto HTTP | `3000` |
| `LOG_FORMATO` | `json` (estructurado) o `texto` | `json` |
| `PERSISTENCIA` | `postgres` o `memoria` | `memoria` |
| `BASE_DATOS_URL` | Conexión a PostgreSQL, si `PERSISTENCIA=postgres` | — |
| `PUBLICADOR_EVENTOS` | `rabbitmq` o `log` | `log` |
| `RABBITMQ_URL` | Conexión a RabbitMQ, si `PUBLICADOR_EVENTOS=rabbitmq` | — |
| `IDEMPOTENCIA` | `redis` o `memoria`: dónde se guardan las `Idempotency-Key` | `memoria` |
| `REDIS_URL` | Conexión a Redis, si `IDEMPOTENCIA=redis` | — |
| `OUTBOX_INTERVALO_MS` | Cada cuánto se publican los eventos pendientes (0 = nunca) | `1000` |
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
- [x] Persistencia en PostgreSQL con migraciones, control de versión e historial inmutable
- [x] Dockerfile (imagen versionada `grupo5/m6-viajes:0.1.0`) y docker-compose con base + servicio
- [x] Publicación de eventos en RabbitMQ con bandeja de salida (outbox), sin perder eventos si el broker se cae
- [x] `Idempotency-Key` en Redis: sobrevive reinicios, sirve con varias instancias y detecta pedidos simultáneos
- [x] CI en GitHub Actions
- [x] Salud y diagnóstico: `/salud/detalle` por dependencia y logs JSON con correlación
