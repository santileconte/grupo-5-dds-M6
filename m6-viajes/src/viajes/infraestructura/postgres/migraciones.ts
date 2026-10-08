import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { Pool } from 'pg';

/** Carpeta `m6-viajes/migraciones`, tanto desde src/ como desde dist/. */
export const CARPETA_MIGRACIONES = join(__dirname, '..', '..', '..', '..', 'migraciones');

/**
 * Aplica, en orden alfabético, los archivos .sql de `migraciones/` que todavía no se aplicaron.
 * Cada archivo corre en su propia transacción y queda registrado en la tabla `migraciones`.
 * Un lock evita que dos instancias del servicio migren a la vez.
 *
 * Regla: un archivo ya aplicado no se modifica; los cambios van en un archivo nuevo (002_..., 003_...).
 */
export async function migrar(pool: Pool, carpeta = CARPETA_MIGRACIONES): Promise<string[]> {
  const logger = new Logger('Migraciones');
  const cliente = await pool.connect();
  try {
    await cliente.query(`SELECT pg_advisory_lock(hashtext('m6-viajes-migraciones'))`);
    await cliente.query(`
      CREATE TABLE IF NOT EXISTS migraciones (
        nombre      TEXT PRIMARY KEY,
        aplicada_en TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    const { rows } = await cliente.query<{ nombre: string }>('SELECT nombre FROM migraciones');
    const aplicadas = new Set(rows.map((r) => r.nombre));

    const pendientes = readdirSync(carpeta)
      .filter((archivo) => archivo.endsWith('.sql') && !aplicadas.has(archivo))
      .sort();

    for (const archivo of pendientes) {
      await cliente.query('BEGIN');
      try {
        await cliente.query(readFileSync(join(carpeta, archivo), 'utf8'));
        await cliente.query('INSERT INTO migraciones (nombre) VALUES ($1)', [archivo]);
        await cliente.query('COMMIT');
        logger.log(`Aplicada ${archivo}`);
      } catch (error) {
        await cliente.query('ROLLBACK');
        throw new Error(`Falló la migración ${archivo}: ${String(error)}`);
      }
    }
    return pendientes;
  } finally {
    await cliente.query(`SELECT pg_advisory_unlock(hashtext('m6-viajes-migraciones'))`).catch(() => undefined);
    cliente.release();
  }
}
