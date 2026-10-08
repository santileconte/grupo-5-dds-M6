import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { migrar } from './migraciones';

export const POOL_POSTGRES = Symbol('PoolPostgres');

/**
 * Crea el pool de conexiones, verifica que la base responda y aplica las migraciones pendientes.
 * Si la base no está disponible, el servicio no arranca y el error explica qué hacer.
 */
export async function crearPoolPostgres(url: string): Promise<Pool> {
  const pool = new Pool({ connectionString: url, max: 10, connectionTimeoutMillis: 5000 });
  try {
    await pool.query('SELECT 1');
  } catch (error) {
    await pool.end();
    const destino = url.replace(/\/\/[^@]*@/, '//***@'); // no mostrar la contraseña en el log
    throw new Error(
      `No se pudo conectar a PostgreSQL en ${destino}: ${String(error)}\n` +
        '¿Levantaste la base con "npm run db:levantar"? Para trabajar sin base, usá PERSISTENCIA=memoria en .env.',
    );
  }
  await migrar(pool);
  return pool;
}

/** Cierra el pool cuando la aplicación se detiene (por ejemplo, con Ctrl + C o al terminar los tests). */
@Injectable()
export class CierrePoolPostgres implements OnModuleDestroy {
  private readonly logger = new Logger('PostgreSQL');

  constructor(@Inject(POOL_POSTGRES) private readonly pool: Pool | null) {}

  async onModuleDestroy(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.logger.log('Conexiones cerradas');
    }
  }
}
