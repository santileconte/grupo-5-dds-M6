import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import { CONFIGURACION_LIMITE, ConfiguracionLimite } from '../src/comun/limite/limite-pedidos.guard';
import { configurarSeguridad } from '../src/comun/seguridad';
import { ALMACEN_IDEMPOTENCIA, AlmacenIdempotencia } from '../src/comun/idempotencia/almacen';
import { PUBLICADOR_EVENTOS, VALIDADOR_CODIGO, ValidadorCodigoVerificacion } from '../src/viajes/aplicacion/puertos';
import { RelevadorDeEventos } from '../src/viajes/aplicacion/relevador-de-eventos';
import { PublicadorEventosEnLog } from '../src/viajes/infraestructura/publicador-eventos.log';
import { Pool } from 'pg';
import { POOL_POSTGRES } from '../src/viajes/infraestructura/postgres/conexion';
import { SECRETO_TESTS } from './entorno';


export interface AppDePrueba {
  app: INestApplication;
  eventos: PublicadorEventosEnLog;
  relevador: RelevadorDeEventos;
}

export interface OpcionesApp {
  validador?: ValidadorCodigoVerificacion;
  almacenIdempotencia?: AlmacenIdempotencia;
  limite?: ConfiguracionLimite;
}

/** Levanta la aplicación completa, opcionalmente reemplazando el validador de QR o el almacén de idempotencia. */
export async function crearApp(opciones: OpcionesApp = {}): Promise<AppDePrueba> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (opciones.validador) {
    builder = builder.overrideProvider(VALIDADOR_CODIGO).useValue(opciones.validador);
  }
  if (opciones.limite) {
    builder = builder.overrideProvider(CONFIGURACION_LIMITE).useValue(opciones.limite);
  }
  if (opciones.almacenIdempotencia) {
    builder = builder.overrideProvider(ALMACEN_IDEMPOTENCIA).useValue(opciones.almacenIdempotencia);
  }
  const modulo = await builder.compile();
  const app = modulo.createNestApplication<NestExpressApplication>({ logger: false });
  configurarSeguridad(app, 'https://front.example');
  await app.init();
  const pool = app.get<Pool | null>(POOL_POSTGRES);
  if (pool) {
    // Cada archivo de tests arranca con la base vacía (TRUNCATE no dispara el trigger del historial).
    await pool.query('TRUNCATE transiciones_viaje, viajes, eventos_salientes');
  }
  return { app, eventos: app.get(PUBLICADOR_EVENTOS), relevador: app.get(RelevadorDeEventos) };
}

const jwt = new JwtService({ secret: SECRETO_TESTS });

export const bearer = (rol: string, id: string) => `Bearer ${jwt.sign({ sub: id, rol }, { expiresIn: '1h' })}`;

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
