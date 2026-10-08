import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // El puerto se configura por variable de entorno (RNF-06).
  await app.listen(Number(process.env.PUERTO ?? 3000));
}

void bootstrap();
