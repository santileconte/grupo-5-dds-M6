import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PUBLICADOR_EVENTOS, VALIDADOR_CODIGO, ValidadorCodigoVerificacion } from '../src/viajes/aplicacion/puertos';
import { PublicadorEventosEnLog } from '../src/viajes/infraestructura/publicador-eventos.log';
import { SECRETO_TESTS } from './entorno';


export interface AppDePrueba {
  app: INestApplication;
  eventos: PublicadorEventosEnLog;
}

/** Levanta la aplicación completa, opcionalmente con otro validador de QR. */
export async function crearApp(validador?: ValidadorCodigoVerificacion): Promise<AppDePrueba> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (validador) {
    builder = builder.overrideProvider(VALIDADOR_CODIGO).useValue(validador);
  }
  const modulo = await builder.compile();
  const app = modulo.createNestApplication({ logger: false });
  await app.init();
  return { app, eventos: app.get(PUBLICADOR_EVENTOS) };
}

const jwt = new JwtService({ secret: SECRETO_TESTS });

export const bearer = (rol: string, id: string) => `Bearer ${jwt.sign({ sub: id, rol })}`;

export function nuevosIds() {
  return {
    solicitudId: randomUUID(),
    asignacionId: randomUUID(),
    clienteId: randomUUID(),
    conductorId: randomUUID(),
    vehiculoId: randomUUID(),
  };
}

export function cuerpoCrearViaje(ids = nuevosIds()) {
  return {
    ...ids,
    tipoVehiculo: 'AUTO',
    origen: { latitud: -34.6037, longitud: -58.3816, direccion: 'Av. Corrientes 1000' },
    destino: { latitud: -34.5889, longitud: -58.3974, direccion: 'Av. Santa Fe 3000' },
  };
}
