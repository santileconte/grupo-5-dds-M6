# ADR-005: Controles básicos de seguridad web

- **Estado:** aceptada
- **Fecha:** 2026-10-08

## Contexto

RNF-12 pide autenticación, autorización, validación, HTTPS en entornos publicados y controles
básicos de vulnerabilidades web. La autenticación y la autorización ya existían (JWT, roles y
dueño del viaje), igual que la validación de entradas (DTOs con `whitelist`). Al revisar el
servicio aparecieron estas brechas:

| Problema | Riesgo |
|---|---|
| Un cuerpo de 200 KB respondía `500 ERROR_INTERNO` | Error mal informado; cuerpos enormes consumen memoria |
| Se aceptaban tokens **sin vencimiento** | Un token robado serviría para siempre |
| Sin headers de seguridad y con `X-Powered-By: Express` | Se revela la tecnología; faltan defensas del navegador (CSP, HSTS, nosniff) |
| Sin límite de pedidos | Un script descontrolado o un ataque puede saturar el servicio |
| `X-Correlation-Id` aceptaba cualquier texto | Se podían inyectar líneas falsas en los logs |
| 2 vulnerabilidades moderadas en `js-yaml` (dentro de `@nestjs/swagger`) | Consumo de CPU con YAML malicioso |

## Decisión

1. **Headers de seguridad con `helmet`:** CSP, HSTS, `X-Content-Type-Options`,
   `X-Frame-Options`, etc., y sin `X-Powered-By`. `/docs` usa una CSP algo más amplia porque
   Swagger UI necesita scripts propios.
2. **Cuerpos de hasta 16 KB.** Un cuerpo más grande responde `413 CUERPO_DEMASIADO_GRANDE`, y un
   JSON mal formado responde `400 VALIDACION`.
3. **JWT:** se exige `exp`, con una tolerancia de reloj de 30 s. Si se configuran `JWT_EMISOR` y
   `JWT_AUDIENCIA`, también se verifican `iss` y `aud`, listos para los tokens reales de M1.
4. **Límite de pedidos por usuario y por minuto:**
   - 120 para usuarios y 1200 para servicios, configurables;
   - corre **después** de autenticar, así es por usuario y no por IP (que puede ser compartida);
   - se cuenta en Redis con `INCR` y `PEXPIRE NX` (atómico, compartido entre instancias), o en
     memoria;
   - informa `RateLimit-Limit`, `RateLimit-Remaining` y `RateLimit-Reset`, y al superarlo responde
     `429 DEMASIADOS_PEDIDOS` con `Retry-After`;
   - si Redis no responde, deja pasar el pedido (RNF-13).
5. **`X-Correlation-Id`:** sólo admite `[A-Za-z0-9._:-]{1,100}`; cualquier otro valor se reemplaza
   por un UUID.
6. **CORS cerrado** salvo los orígenes de `CORS_ORIGENES`, por ejemplo el frontend del TP3.
7. **Dependencias:** `js-yaml` se fuerza a 5.4.3 con `overrides`, y el CI corre
   `npm audit --omit=dev --audit-level=moderate`, que falla si aparece una vulnerabilidad nueva.
8. **HTTPS:** lo termina el proxy o balanceador del entorno publicado. El servicio ya envía HSTS.

## Consecuencias

- **La conexión a Redis se comparte** (`src/comun/redis/`) entre la idempotencia y el límite de
  pedidos. `IDEMPOTENCIA=redis` activa Redis para las dos cosas.
- **Pendiente con M1:** pasar de HS256 con secreto compartido a una clave pública (RS256 + JWKS),
  para que los módulos no compartan secretos (RF-1.4). La verificación está concentrada en
  `autenticacion.guard.ts`, así que el cambio queda acotado.
