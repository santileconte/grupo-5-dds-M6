import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { parse } from 'yaml';

const CONTRATO_POR_DEFECTO = join(__dirname, '..', '..', '..', 'contratos', 'm6-viajes.openapi.yaml');

/**
 * Publica en /docs una interfaz Swagger UI generada desde el contrato OpenAPI del repositorio
 * (el contrato es la fuente de verdad; no se genera desde el código).
 */
export function configurarDocumentacion(app: INestApplication, ruta = process.env.RUTA_CONTRATO_OPENAPI): void {
  const contrato = parse(readFileSync(ruta ?? CONTRATO_POR_DEFECTO, 'utf8')) as OpenAPIObject;
  // Ruta relativa para que "Try it out" funcione en localhost, Codespaces o cualquier otro host.
  contrato.servers = [{ url: '/', description: 'Este servidor' }];
  SwaggerModule.setup('docs', app, contrato, {
    swaggerOptions: { persistAuthorization: true },
  });
}
