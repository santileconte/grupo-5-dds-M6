# ADR-001: Stack tecnológico de M6

- **Estado:** propuesta (pendiente de aprobación de la cátedra, RNF-01)
- **Fecha:** 2026-10-08

## Contexto

RNF-01 deja elegir lenguaje y framework, con aprobación y justificación técnica. M6 necesita:

- una API HTTP descrita con OpenAPI (RNF-03),
- control de concurrencia sobre las transiciones de estado (RNF-08),
- publicación de eventos en RabbitMQ (RNF-10) y uso de Redis (RNF-11) en TP2,
- pruebas unitarias y de integración desde TP1 (RNF-07),
- una imagen de contenedor reproducible (RNF-04).

El grupo conoce JavaScript y TypeScript mejor que otros lenguajes, aunque todavía no domina un
framework de backend.

## Decisión

- **Lenguaje:** TypeScript 5.x sobre **Node.js 22 LTS**.
- **Framework:** **NestJS 11**.
- **Tests:** Jest con ts-jest.
- **Contratos:** OpenAPI 3.1 (API síncrona) y AsyncAPI 3.0 (eventos), validados con Redocly CLI y
  `@asyncapi/parser`.
- **Base de datos:** PostgreSQL (ver ADR-002), para tener transacciones y
  actualizaciones condicionales por versión.

## Justificación

- **Lenguaje conocido:** se usa el lenguaje que el grupo ya maneja, así el esfuerzo se va al
  dominio y no a aprender un lenguaje nuevo.
- **NestJS da estructura:** módulos, controladores, servicios e inyección de dependencias de forma
  estándar. Eso ayuda a un equipo con poca experiencia a mantener separadas las capas de dominio,
  aplicación e infraestructura.
- **Ecosistema para lo que viene:** `@nestjs/swagger` (OpenAPI), `@nestjs/microservices` y
  bibliotecas AMQP (RabbitMQ), `@nestjs/terminus` (health checks), clientes de Redis y Testcontainers
  para pruebas de integración.
- **Por qué NestJS 11 y no 12:** NestJS 12 se distribuye sólo como ES Modules. Eso complica la
  configuración de Jest y la mayoría de la documentación y los tutoriales disponibles todavía usan
  la versión 11 con CommonJS. Se puede migrar más adelante sin tocar el dominio.
- **Por qué TypeScript 5 y no 7:** ts-jest todavía no es compatible con TypeScript 7.

## Consecuencias

- El dominio (`src/viajes/dominio`) es TypeScript puro, sin dependencias de NestJS, y se prueba sin
  levantar el servidor.
- Las versiones de las dependencias quedan fijadas exactas en `package.json` y `package-lock.json`
  para que los builds sean reproducibles.
- Alternativas consideradas: Java con Spring Boot (más robusto en concurrencia y mensajería, pero
  el grupo no lo domina) y Python con FastAPI (simple, pero el grupo tiene menos práctica).
