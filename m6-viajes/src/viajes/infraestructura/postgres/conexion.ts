import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { migrar } from './migraciones';

export const POOL_POSTGRES = Symbol('PoolPostgres');

/**
 * Crea el pool de conexiones, verifica que la base responda y aplica las migraciones pendientes.
 * Si la base no está disponible, el servicio no arranca y el error explica qué hacer.
 */
export async function crearPoolPostgres(url: string): Promise<Pool> {
  const pool = new Pool({ connectionString: url, max: 10, connectionTimeoutMillis: 5000 });
  // Si PostgreSQL se reinicia o corta una conexión ociosa, el pool emite 'error'. Sin este
  // manejador, Node tiraría abajo todo el proceso. Con él, el pool descarta esa conexión y abre
  // otra en el próximo pedido; mientras la base no vuelva, los pedidos fallan con 500 y
  // /salud/detalle informa ERROR (RNF-13).
  const logger = new Logger('PostgreSQL');
  pool.on('error', (error) => logger.warn(`Se perdió una conexión con la base: ${error.message}`));
  try {
    await pool.query('SELECT 1');
  } catch (error) {
    await pool.end();
    const destino = url.replace(/\/\/[^@]*@/, '//***@'); // no mostrar la contraseña en el log
    throw new Error(
      `No se pudo conectar a PostgreSQL en ${destino}: ${String(error)}\n` +
        '¿Levantaste la base con "npm run infra:levantar"? Para trabajar sin base, usá PERSISTENCIA=memoria en .env.',
    );
  }
  await migrar(pool);
  return pool;
}

/**
 * Cierra el pool cuando la aplicación se detiene (por ejemplo, con Ctrl + C o al terminar los tests).
 * Usa la última etapa del apagado, para que antes termine el RelevadorDeEventos, que usa la base.
 */
@Injectable()
export class CierrePoolPostgres implements OnApplicationShutdown {
  private readonly logger = new Logger('PostgreSQL');

  constructor(@Inject(POOL_POSTGRES) private readonly pool: Pool | null) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.logger.log('Conexiones cerradas');
    }
  }
}
