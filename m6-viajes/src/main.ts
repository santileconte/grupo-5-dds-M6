import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configurarDocumentacion } from './comun/documentacion';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configurarDocumentacion(app);
  // El puerto se configura por variable de entorno (RNF-06).
  await app.listen(Number(process.env.PUERTO ?? 3000));
}

void bootstrap();
