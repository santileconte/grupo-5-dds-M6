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
npm ci                       # instala las dependencias exactas del lockfile
npm test                     # tests unitarios
npm run typecheck            # chequeo de tipos
npm run contratos:validar    # valida el OpenAPI y el AsyncAPI
npm run start:dev            # levanta el servicio en http://localhost:3000 (GET /salud)
```

### Estructura

```
m6-viajes/src/
├── main.ts / app.module.ts      # arranque de NestJS
├── salud/                       # GET /salud
└── viajes/dominio/              # lógica de negocio pura, sin NestJS
    ├── tipos.ts                 # estados, acciones, roles, motivos
    ├── maquina-estados.ts       # tabla de transiciones (única fuente de verdad)
    ├── viaje.ts                 # entidad Viaje: aplica transiciones y registra el historial
    ├── errores.ts               # errores de dominio con código estable
    ├── viaje.spec.ts            # tests de reglas de negocio
    └── contrato.spec.ts         # verifica que los enums coincidan con los contratos
```

## Estado

- [x] Máquina de estados del viaje (documento y dominio con tests)
- [x] Contrato OpenAPI
- [x] Catálogo de eventos (AsyncAPI)
- [ ] Acordar contratos con M5, M7, M8, M1 y el Grupo 12 (ver pendientes en la máquina de estados)
- [ ] Capa HTTP (controladores) y persistencia con control de versión
- [ ] Dockerfile y docker-compose
- [ ] Tests de integración
