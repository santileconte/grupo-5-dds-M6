import { NestExpressApplication } from '@nestjs/platform-express';
import { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';

/** Tamaño máximo del cuerpo de un pedido: los de M6 son de unos pocos cientos de bytes. */
export const LIMITE_CUERPO = '16kb';

/**
 * Controles básicos de seguridad web (RNF-12):
 * - Headers de seguridad con helmet: oculta `X-Powered-By` y agrega `Content-Security-Policy`,
 *   `Strict-Transport-Security` (HTTPS), `X-Content-Type-Options`, `X-Frame-Options`, etc.
 * - Límite de tamaño del cuerpo: un pedido gigante recibe 413 en lugar de consumir memoria.
 * - CORS cerrado salvo los orígenes listados en CORS_ORIGENES (por ejemplo, el frontend del TP3).
 */
export function configurarSeguridad(app: NestExpressApplication, corsOrigenes = process.env.CORS_ORIGENES): void {
  const paraApi = helmet();
  // Swagger UI (/docs) necesita scripts y estilos propios, así que su política es un poco más amplia.
  const paraDocumentacion = helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
      },
    },
  });
  app.use((pedido: Request, respuesta: Response, siguiente: NextFunction) =>
    (pedido.path.startsWith('/docs') ? paraDocumentacion : paraApi)(pedido, respuesta, siguiente),
  );

  app.useBodyParser('json', { limit: LIMITE_CUERPO });

  const origenes = (corsOrigenes ?? '')
    .split(',')
    .map((origen) => origen.trim())
    .filter(Boolean);
  if (origenes.length > 0) {
    app.enableCors({
      origin: origenes,
      allowedHeaders: ['Authorization', 'Content-Type', 'If-Match', 'Idempotency-Key', 'X-Correlation-Id'],
      exposedHeaders: ['ETag', 'Location', 'X-Correlation-Id', 'Idempotent-Replayed', 'Retry-After', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset'],
    });
  }
}
