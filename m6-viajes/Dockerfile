# syntax=docker/dockerfile:1
# Imagen OCI de M6 (RNF-04). Se construye desde la RAÍZ del repositorio, porque necesita también
# el contrato OpenAPI de contratos/ para servir /docs:
#   docker build -f m6-viajes/Dockerfile -t grupo5/m6-viajes:0.1.0 .
# (o simplemente `npm run docker:levantar` desde m6-viajes/)

# Versión exacta de la imagen base para que el build sea reproducible.
ARG IMAGEN_NODE=node:22.23.3-alpine3.24

# ---------- Etapa 1: compilar ----------
FROM ${IMAGEN_NODE} AS compilacion
WORKDIR /app/m6-viajes

# Primero sólo los package*.json: si no cambian, Docker reutiliza la capa de `npm ci`.
COPY m6-viajes/package.json m6-viajes/package-lock.json ./
RUN npm ci

COPY m6-viajes/tsconfig.json m6-viajes/tsconfig.build.json m6-viajes/nest-cli.json ./
COPY m6-viajes/src ./src
RUN npm run build \
 && npm prune --omit=dev

# ---------- Etapa 2: ejecutar ----------
# Sólo lleva lo necesario para correr: sin TypeScript, sin tests, sin herramientas de desarrollo.
FROM ${IMAGEN_NODE}
ENV NODE_ENV=production \
    PUERTO=3000
# Misma estructura de carpetas que el repositorio: dist/ encuentra ../migraciones y ../../contratos.
WORKDIR /app/m6-viajes

COPY --from=compilacion --chown=node:node /app/m6-viajes/node_modules ./node_modules
COPY --from=compilacion --chown=node:node /app/m6-viajes/dist ./dist
COPY --chown=node:node m6-viajes/package.json ./
COPY --chown=node:node m6-viajes/migraciones ./migraciones
COPY --chown=node:node contratos/m6-viajes.openapi.yaml /app/contratos/m6-viajes.openapi.yaml

# No correr como root dentro del contenedor.
USER node
EXPOSE 3000

# Docker marca el contenedor como "healthy" cuando /salud responde 200.
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PUERTO||3000)+'/salud').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Toda la configuración (JWT_SECRETO, BASE_DATOS_URL, etc.) llega por variables de entorno (RNF-06).
CMD ["node", "dist/main.js"]
