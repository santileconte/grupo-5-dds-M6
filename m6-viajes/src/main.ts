import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configurarDocumentacion } from './comun/documentacion';
import { RegistroJson } from './comun/registro/registro-json';
import { configurarSeguridad } from './comun/seguridad';

async function bootstrap(): Promise<void> {
  // bufferLogs: los logs del arranque esperan hasta que se elija el formato.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  // LOG_FORMATO=json (por defecto, para producción) o texto (más legible al programar).
  if (process.env.LOG_FORMATO !== 'texto') {
    app.useLogger(new RegistroJson());
  } else {
    app.flushLogs();
  }
  configurarSeguridad(app);
  configurarDocumentacion(app);
  // Al recibir SIGTERM (docker stop) o SIGINT (Ctrl + C) cierra el servidor y las conexiones a la base.
  app.enableShutdownHooks();
  // El puerto se configura por variable de entorno (RNF-06).
  await app.listen(Number(process.env.PUERTO ?? 3000));
}

void bootstrap();
