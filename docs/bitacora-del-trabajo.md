# Bitácora del trabajo – M6 Viajes y Ciclo de Vida

Este documento cuenta, en orden, todo lo que hicimos desde el repositorio vacío hasta tener el
servicio M6 funcionando con base de datos. Para cada paso explica **qué** se hizo, **por qué**
y **cómo comprobarlo**. Al final hay una sección con los problemas que aparecieron al probar y
cómo se resolvieron.

---

## Paso 0 – Entender la consigna

La consigna describe una plataforma de movilidad urbana tipo Uber, dividida en 9 módulos (M1 a
M9). Cada módulo lo desarrolla un grupo distinto, y después todos se integran. Al **Grupo 5** le
toca **M6 – Viajes y Ciclo de Vida**.

**Responsabilidad de M6:** controlar los estados del viaje (arribo, inicio, finalización y
cancelación) y guardar un historial auditable.

**Con quién se relaciona:**

| Módulo | Relación con M6 |
|---|---|
| M5 – Despacho | Crea el viaje cuando asigna un conductor. Recibe de vuelta la solicitud si el conductor cancela. |
| M7 – Pagos | Cobra cuando el viaje termina y decide el cargo si se cancela. |
| M8 – Notificaciones | Avisa cada hito, genera el QR de inicio y el comprobante. |
| M2 – Clientes | Consulta el historial de viajes del cliente. |
| M1 – Identidad | Emite los tokens con los que se identifica cada usuario. |

**Requerimientos funcionales de M6:**
- RF-6.1: estados y transiciones controladas.
- RF-6.2: consulta del estado.
- RF-6.3: arribo del conductor.
- RF-6.4: inicio validado con QR.
- RF-6.5: finalización.
- RF-6.6 y RF-6.7: cancelación por cliente y por conductor.
- RF-6.8: historial no destructivo.

**Requisitos no funcionales del TP1:** RNF-01 a RNF-08 y RNF-20 (stack justificado, contratos,
contenedores, datos propios, configuración externa, pruebas, concurrencia y documentación).

---

## Paso 1 – Elegir por dónde empezar y con qué tecnología

**Decisión 1: empezar por el contrato, no por el código.** El repositorio existe para "definir
las interfaces entre módulos con OpenAPI", y otros grupos dependen de lo que publiquemos. Por eso
el orden fue:

1. máquina de estados;
2. contrato OpenAPI;
3. catálogo de eventos;
4. recién después, el código.

**Decisión 2: TypeScript con NestJS.** El grupo conoce JavaScript y TypeScript. NestJS da una
estructura ordenada (módulos, controladores, servicios), útil para un equipo con poca
experiencia en backend.

- Se usó **NestJS 11** y no la 12: la 12 sólo funciona como "ES Modules", lo que complica los
  tests, y casi toda la documentación disponible es de la 11.
- Se usó **TypeScript 5** y no la 7: la herramienta de tests (ts-jest) todavía no soporta la 7.

📄 Queda documentado en [`docs/decisiones/ADR-001-stack-tecnologico.md`](decisiones/ADR-001-stack-tecnologico.md).
Un ADR ("Architecture Decision Record") es un documento corto que registra una decisión técnica y
su justificación. Es lo que pide RNF-01.

---

## Paso 2 – Máquina de estados del viaje

**Qué es:** la lista de estados que puede tener un viaje y las reglas para pasar de uno a otro.

```
ASIGNADO → CONDUCTOR_ARRIBADO → EN_CURSO → FINALIZADO
    └──────────┴─────────────────┴──→ CANCELADO (según quién cancele)
```

**Reglas principales:**

- **Quién puede hacer cada cosa:**
  - sólo el **conductor asignado** registra el arribo, inicia y finaliza;
  - el **cliente** puede cancelar antes de que el viaje empiece;
  - el **operador** puede cancelar en cualquier estado no terminal, incluso en curso.
- **Inicio con QR:** el viaje sólo pasa a `EN_CURSO` si el conductor presenta el código QR del
  cliente. El QR lo genera M8; M6 lo valida.
- **Motivos de cancelación** por rol, de una lista cerrada.
- **"Cliente no se presentó":** el conductor sólo puede cancelar con ese motivo después de esperar
  5 minutos (configurable) desde el arribo.
- **Vuelta al despacho:** si cancela el conductor antes del inicio, la solicitud vuelve a M5 para
  buscar otro conductor (`requiereRedespacho`).
- **El cargo de cancelación lo calcula M7, no M6.** M6 sólo informa quién canceló, cuándo y en
  qué estado estaba el viaje.
- **Historial no destructivo:** cada cambio se agrega como un registro nuevo y nunca se modifica
  ni se borra.
- **Concurrencia:** cada viaje tiene una `version`. Si dos pedidos llegan a la vez (por ejemplo,
  dos "finalizar"), sólo uno gana.

**Dónde está:**
- Documento: [`docs/m6/maquina-de-estados.md`](m6/maquina-de-estados.md), que incluye un diagrama
  y la lista de **temas pendientes de acordar con otros grupos**.
- Código: `m6-viajes/src/viajes/dominio/`. Es TypeScript puro, sin NestJS, para poder probarlo
  solo.
  - `maquina-estados.ts`: la tabla de transiciones. Es la única fuente de verdad.
  - `viaje.ts`: la entidad Viaje, que aplica las reglas y registra el historial.
  - `viaje.spec.ts`: tests de todas las reglas.

---

## Paso 3 – Contrato OpenAPI

**Qué es:** un archivo que describe exactamente la API de M6: rutas, datos que recibe, qué
responde y qué errores puede dar. Es el "acuerdo" con los otros grupos.

📄 [`contratos/m6-viajes.openapi.yaml`](../contratos/m6-viajes.openapi.yaml)

| Endpoint | Quién lo usa | Para qué |
|---|---|---|
| `POST /viajes` | M5 (rol SERVICIO) | Crear el viaje al asignar un conductor |
| `GET /viajes` | Cliente, conductor, operador, M2 | Historial resumido, paginado |
| `GET /viajes/{id}` | Partes del viaje, operador | Estado actual |
| `GET /viajes/{id}/historial` | Partes del viaje, operador | Todas las transiciones |
| `POST /viajes/{id}/arribo` | Conductor | Llegó al punto de retiro |
| `POST /viajes/{id}/inicio` | Conductor | Inicia validando el QR |
| `POST /viajes/{id}/finalizacion` | Conductor | Termina con la distancia recorrida |
| `POST /viajes/{id}/cancelacion` | Cliente, conductor, operador | Cancela con motivo |

**Convenciones del contrato:**
- **Errores:** siempre en formato `application/problem+json`, con un `codigo` fijo (por ejemplo
  `TRANSICION_INVALIDA` o `PROHIBIDO`).
- **Versión del viaje:** se devuelve en el header `ETag`. El header opcional `If-Match` sirve para
  asegurarse de actuar sobre la versión vista.
- **`Idempotency-Key`:** repetir un pedido con la misma clave no lo ejecuta dos veces.
- **`X-Correlation-Id`:** un identificador para seguir un pedido a través de logs y eventos.
- **Creación idempotente:** crear dos veces con el mismo `asignacionId` devuelve el mismo viaje.

---

## Paso 4 – Catálogo de eventos

**Qué es:** la descripción de los mensajes que M6 publica para avisar a los otros módulos que algo
pasó. Así M6 no necesita llamar a cada módulo: avisa y cada uno reacciona.

📄 [`contratos/eventos/m6-viajes.asyncapi.yaml`](../contratos/eventos/m6-viajes.asyncapi.yaml)
(formato AsyncAPI) y [`docs/catalogo-eventos.md`](catalogo-eventos.md) (versión legible).

| Evento | Cuándo | Lo usan |
|---|---|---|
| `ViajeCreado` | Al crear el viaje | M8 (aviso y QR), M9 |
| `ConductorArribado` | Al registrar el arribo | M8 |
| `ViajeIniciado` | Al pasar a `EN_CURSO` | M8, M7 |
| `ViajeFinalizado` | Al finalizar | M7 (cobro), M8 (comprobante), M2/M3 (calificaciones), M4 |
| `ViajeCancelado` | Al cancelar | M5 (redespacho), M7 (cargo), M8, M4, M9 |

Todos usan el mismo "sobre": `idEvento`, `tipo`, `version`, `ocurridoEn`, `productor`,
`idCorrelacion` y `datos`. **Por privacidad no llevan coordenadas ni datos personales.** En TP2
se publicarán en RabbitMQ; por ahora se muestran en la terminal con la etiqueta `[Eventos]`.

**Validación:** `npm run contratos:validar` revisa que el OpenAPI y el AsyncAPI estén bien
escritos. Además hay un test (`contrato.spec.ts`) que falla si los valores del código (estados,
motivos, códigos de error) dejan de coincidir con los de los contratos.

---

## Paso 5 – Esqueleto NestJS y primera prueba

Se creó el proyecto `m6-viajes/` con NestJS y un endpoint mínimo `GET /salud`, que responde
`{"estado":"OK"}`.

```bash
cd m6-viajes
npm ci              # instala las dependencias exactas
npm test            # corre los tests
npm run start:dev   # levanta el servidor
```

**Lo que se ve al levantar:** líneas verdes de Nest que terminan en
`Nest application successfully started`. La terminal queda "ocupada" mientras el servidor corre;
`Ctrl + C` lo detiene.

✅ **Primera prueba:** en el Codespace, al abrir `https://<codespace>-3000.app.github.dev/salud`
apareció `{"estado":"OK"}`.

---

## Paso 6 – Controladores: la API completa

Se implementaron todos los endpoints del contrato, separando el código en capas:

```
HTTP → controlador → ViajesService → Viaje (dominio)
                          ↓
             repositorio / eventos / validador QR
```

| Carpeta | Qué hace |
|---|---|
| `viajes/http/` | Controlador y DTOs. Traduce HTTP a datos y valida lo que llega. |
| `viajes/aplicacion/` | `ViajesService`: lee el viaje, verifica la versión, aplica la regla, guarda y publica el evento. También define los "puertos" (interfaces). |
| `viajes/infraestructura/` | Implementaciones reemplazables: repositorio, publicador de eventos y validador del QR. |
| `comun/` | Lo transversal: autenticación, errores, correlación, idempotencia y documentación. |

**Piezas importantes:**

- **Autenticación con JWT.** Cada pedido debe traer `Authorization: Bearer <token>`. El token
  dice quién sos (`sub`) y tu rol (`rol`). Como M1 todavía no existe, el script
  `npm run token -- <ROL> [id]` genera tokens de prueba firmados con `JWT_SECRETO`.
- **QR simulado.** Mientras M8 no exista, el código válido de cada viaje es `QR-<id del viaje>` y
  sólo se puede usar una vez. Con `VALIDADOR_QR=m8` se llama a M8 de verdad, con timeout: si M8 no
  responde, se devuelve 503 en lugar de quedarse esperando.
- **Swagger en `/docs`.** Es una página web generada desde el contrato, que permite probar la API
  desde el navegador. La raíz `/` redirige ahí.
- **Configuración en `.env`** (RNF-06): puerto, secreto JWT, espera mínima y validador del QR.
  `.env.example` es la plantilla; el `.env` real no se sube al repositorio.

**Tests de integración** (`m6-viajes/test/`): levantan la aplicación completa y le hacen pedidos
HTTP reales. Prueban el recorrido completo, los permisos, la validación, el QR de un solo uso, M8
caído, la idempotencia y la concurrencia: con tres finalizaciones simultáneas, una gana y dos
reciben 409.

---

## Paso 7 – Probar la API a mano con Swagger

**Recorrido que hicimos:**

1. **Levantar el servidor.** En la terminal 1: `cd m6-viajes` y `npm run start:dev`.
2. **Generar tokens.** En la terminal 2:
   ```bash
   cd m6-viajes
   npm run token -- SERVICIO m5-despacho
   npm run token -- CONDUCTOR
   npm run token -- CLIENTE
   ```
   Hay que anotar el **Id** del conductor y el del cliente.
3. **Crear el viaje.** En `/docs`: **Authorize** con el token de **SERVICIO**, después
   `POST /viajes` con el `clienteId` y el `conductorId` anotados. Respuesta: **201** y
   `"estado": "ASIGNADO"`. Hay que copiar el `id` del viaje.
4. **Recorrer el viaje como conductor.** **Authorize** → **Logout** → token del **CONDUCTOR**, y:
   - `POST /viajes/{id}/arribo` → `CONDUCTOR_ARRIBADO`
   - `POST /viajes/{id}/inicio` con `{"codigoVerificacion": "QR-<id>"}` → `EN_CURSO`
   - `POST /viajes/{id}/finalizacion` con `{"distanciaRecorridaMetros": 4200}` → `FINALIZADO`
5. **Ver el historial.** `GET /viajes/{id}/historial` muestra todas las transiciones.

✅ **Segunda prueba:** se creó el viaje y la API respondió con `estado: ASIGNADO`, `version: 1`,
`ETag: "1"` y un `x-correlation-id`.

---

## Paso 8 – Base de datos PostgreSQL

Hasta acá los viajes se guardaban en memoria y se perdían al reiniciar. Se agregó PostgreSQL.

**Tablas** (`m6-viajes/migraciones/001_viajes_y_transiciones.sql`):
- `viajes`: el estado actual de cada viaje.
- `transiciones_viaje`: una fila por cada cambio de estado (el historial).

**Reglas que garantiza la base de datos, además del código:**
- **Sin doble finalización:** se guarda con `UPDATE ... WHERE version = <versión leída>`. Si otro
  pedido se adelantó, no se actualiza nada y se responde 409.
- **Historial inmutable:** un *trigger* rechaza cualquier `UPDATE` o `DELETE` sobre el historial.
- **Unicidad:** un viaje por asignación y, como máximo, un viaje activo por solicitud.

**Migraciones:** al arrancar, el servicio aplica los archivos SQL pendientes de `migraciones/` y
los registra en la tabla `migraciones`. Un archivo ya aplicado no se modifica; los cambios van en
un archivo nuevo (`002_...`).

**Para trabajar:**
- `docker-compose.yml` levanta PostgreSQL en Docker con `npm run db:levantar`.
- `PERSISTENCIA=postgres|memoria` en `.env` elige dónde guardar. Con `memoria` se puede trabajar
  sin Docker.
- `npm run test:postgres` corre los tests de integración y del repositorio contra la base real.

Se eligió SQL escrito a mano, sin ORM, para que estas reglas queden visibles. Ver
[`docs/decisiones/ADR-002-persistencia-postgresql.md`](decisiones/ADR-002-persistencia-postgresql.md).

```bash
cd m6-viajes
cp .env.example .env
npm run db:levantar
npm run start:dev        # en el log: [Migraciones] Aplicada 001_viajes_y_transiciones.sql
```

Para mirar la base, desde **otra** terminal:

```bash
cd m6-viajes
npm run db:consola
```

Dentro de la consola:

```sql
SELECT id, estado, version FROM viajes;
SELECT * FROM transiciones_viaje;
\q
```

✅ **Tercera prueba:** con la base recién creada, `SELECT` devolvió `(0 rows)`. Después de crear
un viaje en Swagger, devolvió el viaje `27829121-...` en estado `ASIGNADO`, versión 1.

---

## Paso 9 – Dockerfile: el servicio en un contenedor

**Qué es:** el `Dockerfile` describe cómo armar una **imagen** del servicio: un paquete con Node,
el código compilado y sus dependencias, listo para correr igual en cualquier máquina. Es lo que
pide RNF-04: "imágenes OCI reproducibles y versionadas".

📄 [`m6-viajes/Dockerfile`](../m6-viajes/Dockerfile)

**Cómo está armado (dos etapas):**
1. **Compilación:** instala todas las dependencias, compila TypeScript a JavaScript y después
   borra las dependencias de desarrollo.
2. **Ejecución:** parte de una imagen limpia y copia sólo lo necesario para correr: `dist/`,
   `node_modules` de producción, `migraciones/` y el contrato OpenAPI (para `/docs`). No lleva
   TypeScript ni tests.

**Decisiones:**
- **Reproducible:** la imagen base tiene versión exacta (`node:22.23.3-alpine3.24`), lo mismo que
  PostgreSQL (`postgres:16.15-alpine3.24`). Las dependencias se instalan con `npm ci` desde el
  lockfile.
- **Versionada:** la imagen se llama `grupo5/m6-viajes:0.1.0`.
- **Se construye desde la raíz del repo**, porque necesita también `contratos/`. Dentro de la
  imagen se respeta la misma estructura de carpetas que en el repositorio.
- **No corre como root:** usa el usuario `node`.
- **Health check:** Docker consulta `/salud` y marca el contenedor como `healthy`.
- **Sin secretos adentro:** toda la configuración llega por variables de entorno (RNF-06). El
  archivo `.dockerignore` evita que `.env` o `node_modules` entren en la imagen.

**docker-compose.yml** ahora levanta dos servicios:
- `postgres`: la base, como antes.
- `m6-viajes`: el servicio. Espera a que la base esté `healthy`, se conecta a ella por el nombre
  `postgres` (dentro de la red de Docker no es `localhost`) y toma `JWT_SECRETO` del `.env`.

```bash
cd m6-viajes
cp .env.example .env
npm run docker:levantar     # = docker compose up -d --build --wait
npm run docker:logs         # ver los logs del servicio
npm run docker:detener      # apagar todo (los datos quedan en el volumen)
```

**Ajuste que surgió al probar:** al detener el contenedor, Docker tardaba 10 segundos y terminaba
matando el proceso, porque el servicio no escuchaba la señal de apagado. Se agregó
`app.enableShutdownHooks()` en `main.ts`. Ahora se detiene al instante y cierra las conexiones a la
base (en el log aparece `[PostgreSQL] Conexiones cerradas`).

✅ **Prueba:**
- se construyó la imagen;
- `docker compose up` dejó los dos contenedores `healthy`;
- las migraciones se aplicaron solas, `/salud` y `/docs` respondieron;
- se creó un viaje y se registró el arribo;
- se reinició el contenedor y el viaje seguía en `CONDUCTOR_ARRIBADO`, versión 2.

---

## Paso 10 – Preparar los acuerdos con los otros grupos

**Qué es:** M6 depende de cómo lo usen los demás módulos. M5 lo crea, M8 valida el QR, M7 cobra
y M2, M3, M4 y M9 escuchan sus eventos. Lo que definimos en el contrato es sólo una **propuesta**
hasta que los otros grupos lo acepten.

📄 [`docs/acuerdos-con-otros-grupos.md`](acuerdos-con-otros-grupos.md)

**Qué contiene:**
- **Tabla de seguimiento** por módulo: grupos a contactar (cada módulo tiene dos
  implementaciones), prioridad y estado (sin enviar, enviado, en discusión o acordado).
- **Convenciones comunes** para proponer a todos: formato de errores, `X-Correlation-Id`, exchange
  de RabbitMQ, routing keys y sobre de eventos.
- **Una sección por grupo**: qué necesitamos, nuestra propuesta concreta, las preguntas abiertas,
  un **mensaje listo para copiar y mandar** y un lugar para anotar lo acordado.

**Prioridades:**
1. M5: cómo se crea el viaje.
2. M8: cómo se valida el QR.
3. M1: formato del token. La consigna no le asigna grupo, así que la consulta es para la cátedra.
4. Grupo 12: la otra implementación de M6, para tener el mismo contrato.

**Cómo usarlo:**
- mandar los mensajes;
- ir actualizando la columna "Estado";
- anotar lo decidido en "Acordado".

Si un acuerdo cambia el contrato, hay que actualizar `contratos/` y el código, y registrarlo en
esta bitácora.

**Cambio en el flujo de trabajo:** a partir de este paso, los commits y el push los hace el grupo.
Los comandos están en la sección "Cómo traer los cambios y commitear" más abajo.

---

## Problemas que aparecieron al probar y cómo se resolvieron

| Síntoma | Causa | Solución |
|---|---|---|
| `{"message":"Cannot GET /","statusCode":404}` al abrir el Codespace | Se abrió la raíz `/`, que todavía no tenía nada | Abrir `/salud`. Después la raíz pasó a redirigir a `/docs`. |
| `npm error ENOENT ... /workspaces/grupo-5-dds/package.json` | Cada terminal nueva arranca en la raíz del repo, y el proyecto está en `m6-viajes/` | Hacer siempre `cd m6-viajes` primero. |
| La respuesta mostraba `FINALIZADO` y fechas redondas apenas creado el viaje | Se estaba mirando el **ejemplo** de la sección *Responses* de Swagger, no la respuesta real | Mirar debajo de **Server response**, justo después de *Execute*. |
| **401** `NO_AUTENTICADO` | No se había tocado **Authorize** (el Curl no tenía `Authorization`) | Authorize con el token, sin la palabra `Bearer`. |
| **403** `PROHIBIDO` al crear el viaje | Se usó el token de CLIENTE y después el de CONDUCTOR; crear viajes sólo lo puede hacer SERVICIO | Logout y Authorize con el token de **SERVICIO**. |
| **200** en lugar de 201 al crear | El viaje ya se había creado en un Execute anterior con el mismo `asignacionId` | Es el comportamiento esperado (idempotencia). Para otro viaje, cambiar `solicitudId` y `asignacionId`. |
| Las consultas SQL "no hacían nada" | Se escribieron en la terminal donde corría el servidor | Abrir otra terminal con **+** y correr `npm run db:consola` ahí. |
| `docker stop` tardaba 10 s y mataba el proceso | Node no cerraba la app al recibir SIGTERM | `app.enableShutdownHooks()` en `main.ts` |
| GitHub rechazó un push ("Push cannot contain secrets") | Falso positivo: tomó un UUID de ejemplo escrito después de la palabra "token" como si fuera un token de npm | Se reemplazó el ejemplo por `<conductorId>`. |

---

## Cómo está organizado el repositorio hoy

```
grupo-5-dds/
├── README.md                         # cómo levantar y probar todo
├── contratos/
│   ├── m6-viajes.openapi.yaml        # API de M6
│   └── eventos/m6-viajes.asyncapi.yaml
├── docs/
│   ├── bitacora-del-trabajo.md       # este documento
│   ├── acuerdos-con-otros-grupos.md  # propuestas y mensajes para cada grupo
│   ├── catalogo-eventos.md
│   ├── m6/maquina-de-estados.md
│   └── decisiones/                   # ADR-001 (stack) y ADR-002 (persistencia)
└── m6-viajes/                        # servicio NestJS
    ├── src/                          # código (dominio, aplicación, infraestructura, http, común)
    ├── test/                         # tests de integración
    ├── migraciones/                  # esquema de la base
    ├── Dockerfile                    # imagen del servicio
    ├── docker-compose.yml            # PostgreSQL + servicio
    └── .env.example                  # plantilla de configuración
```

## Estado frente al TP1

| Requisito | Estado | Dónde |
|---|---|---|
| RNF-01 Stack justificado | ✅ | ADR-001 |
| RNF-02 Módulo con límites claros | ✅ | `m6-viajes/` |
| RNF-03 Contratos OpenAPI y eventos | ✅ | `contratos/` |
| RNF-04 Imagen de contenedor del servicio | ✅ | `m6-viajes/Dockerfile`, imagen `grupo5/m6-viajes:0.1.0` |
| RNF-05 Persistencia propia | ✅ | PostgreSQL, ADR-002 |
| RNF-06 Configuración externa | ✅ | `.env` / `.env.example` |
| RNF-07 Tests unitarios y de integración | ✅ | `npm test`, `npm run test:postgres` |
| RNF-08 Concurrencia | ✅ | Versión + `UPDATE` condicional |
| RNF-20 Documentación | ✅ | README, docs/, ADRs |
| RF-6.1 a RF-6.8 | ✅ | Dominio + API |

## Próximos pasos

1. **Mandar los mensajes** de `docs/acuerdos-con-otros-grupos.md`, empezando por M5, M8, M1 y el
   Grupo 12, y ajustar contratos y código según lo que se acuerde.
2. **TP2:**
   - publicar los eventos en RabbitMQ con el patrón *outbox*;
   - pasar la idempotencia a Redis;
   - agregar health checks y logs estructurados;
   - automatizar el build y los tests en CI.

---

## Cómo traer los cambios y commitear

Los cambios que hace Claude se suben a la rama `claude/amazing-ramanujan-h70f8m`. Para traerlos al
Codespace, desde la raíz del repo:

```bash
git pull
```

Para guardar y subir **cambios propios** (por ejemplo, después de completar un acuerdo):

```bash
git status                     # ver qué archivos cambiaron
git add -A                     # preparar todos los cambios
git commit -m "Describir el cambio en una línea"
git push
```

Si `git push` responde que la rama remota tiene cambios nuevos, primero hay que traerlos con
`git pull` y después repetir `git push`.
