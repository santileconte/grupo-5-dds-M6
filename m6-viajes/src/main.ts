import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configurarDocumentacion } from './comun/documentacion';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configurarDocumentacion(app);
  // Al recibir SIGTERM (docker stop) o SIGINT (Ctrl + C) cierra el servidor y las conexiones a la base.
  app.enableShutdownHooks();
  // El puerto se configura por variable de entorno (RNF-06).
  await app.listen(Number(process.env.PUERTO ?? 3000));
}

void bootstrap();
