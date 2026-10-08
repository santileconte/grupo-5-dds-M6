import { Pool } from 'pg';
import { ConexionRedis } from '../comun/redis/conexion-redis';
import { BandejaDeSalida } from '../viajes/aplicacion/puertos';
import { PublicadorEventosEnLog } from '../viajes/infraestructura/publicador-eventos.log';
import { PublicadorEventosRabbitMQ } from '../viajes/infraestructura/publicador-eventos.rabbitmq';
import { SaludService } from './salud.service';

const bandeja = (masAntiguo: Date | null = null, cantidad = 0): BandejaDeSalida => ({
  procesarPendientes: async () => ({ publicados: 0 }),
  resumenPendientes: async () => ({ cantidad, masAntiguo }),
});

const poolQue = (query: () => Promise<unknown>) => ({ query }) as unknown as Pool;

describe('SaludService', () => {
  it('OK cuando todo responde (y lo no configurado no cuenta como error)', async () => {
    const salud = new SaludService(poolQue(async () => ({})), new PublicadorEventosEnLog(), null, bandeja());
    const informe = await salud.informe();
    expect(informe.estado).toBe('OK');
    expect(informe.componentes).toMatchObject({
      postgres: { estado: 'OK' },
      rabbitmq: { estado: 'NO_CONFIGURADO' },
      redis: { estado: 'NO_CONFIGURADO' },
    });
  });

  it('ERROR si PostgreSQL falla, sin mostrar credenciales en el detalle', async () => {
    const pool = poolQue(async () => {
      throw new Error('no se pudo conectar a postgres://m6:secreta@db:5432');
    });
    const informe = await new SaludService(pool, new PublicadorEventosEnLog(), null, bandeja()).informe();
    expect(informe.estado).toBe('ERROR');
    expect(informe.componentes.postgres.detalle).not.toContain('secreta');
  });

  it('ERROR si PostgreSQL no responde a tiempo (nunca espera indefinidamente)', async () => {
    const pool = poolQue(() => new Promise(() => undefined));
    const inicio = Date.now();
    const informe = await new SaludService(pool, new PublicadorEventosEnLog(), null, bandeja()).informe();
    expect(informe.componentes.postgres).toMatchObject({ estado: 'ERROR', detalle: expect.stringContaining('sin respuesta') });
    expect(Date.now() - inicio).toBeLessThan(3000);
  });

  it('DEGRADADO si RabbitMQ y Redis no están disponibles', async () => {
    const rabbit = new PublicadorEventosRabbitMQ('amqp://guest:guest@127.0.0.1:1', 500);
    const redis = new ConexionRedis('redis://127.0.0.1:1', 300);
    try {
      const informe = await new SaludService(poolQue(async () => ({})), rabbit, redis, bandeja()).informe();
      expect(informe.estado).toBe('DEGRADADO');
      expect(informe.componentes).toMatchObject({ rabbitmq: { estado: 'ERROR' }, redis: { estado: 'ERROR' } });
    } finally {
      await rabbit.onApplicationShutdown();
      await redis.onApplicationShutdown();
    }
  });

  it('DEGRADADO si hay eventos esperando hace más de un minuto', async () => {
    const haceDosMinutos = new Date(Date.now() - 120_000);
    const informe = await new SaludService(
      poolQue(async () => ({})),
      new PublicadorEventosEnLog(),
      null,
      bandeja(haceDosMinutos, 3),
    ).informe();
    expect(informe.estado).toBe('DEGRADADO');
    expect(informe.bandejaDeSalida).toEqual({ pendientes: 3, antiguedadMaximaSegundos: 120 });
  });
});
