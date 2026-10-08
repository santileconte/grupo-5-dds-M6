import { Pool } from 'pg';
import { SobreEvento } from '../../aplicacion/eventos';
import { BandejaDeSalida, ResultadoLote } from '../../aplicacion/puertos';

/**
 * Bandeja de salida sobre la tabla `eventos_salientes` (migraciones/002_bandeja_de_salida.sql).
 *
 * `FOR UPDATE SKIP LOCKED` hace que, si corren varias instancias del servicio, cada una tome
 * eventos distintos y ninguno se publique dos veces en paralelo.
 */
export class BandejaDeSalidaPostgres implements BandejaDeSalida {
  constructor(private readonly pool: Pool) {}

  async procesarPendientes(limite: number, publicar: (evento: SobreEvento) => Promise<void>): Promise<ResultadoLote> {
    const cliente = await this.pool.connect();
    try {
      await cliente.query('BEGIN');
      const { rows } = await cliente.query<{ secuencia: string; cuerpo: SobreEvento }>(
        `SELECT secuencia, cuerpo FROM eventos_salientes
          WHERE publicado_en IS NULL
          ORDER BY secuencia
          LIMIT $1
          FOR UPDATE SKIP LOCKED`,
        [limite],
      );

      const resultado: ResultadoLote = { publicados: 0 };
      for (const fila of rows) {
        try {
          await publicar(fila.cuerpo);
        } catch (error) {
          await cliente.query(
            'UPDATE eventos_salientes SET intentos = intentos + 1, ultimo_error = $2 WHERE secuencia = $1',
            [fila.secuencia, String(error).slice(0, 1000)],
          );
          resultado.error = error;
          break; // los siguientes esperan, para respetar el orden
        }
        await cliente.query('UPDATE eventos_salientes SET publicado_en = now() WHERE secuencia = $1', [fila.secuencia]);
        resultado.publicados += 1;
      }

      await cliente.query('COMMIT');
      return resultado;
    } catch (error) {
      await cliente.query('ROLLBACK');
      throw error;
    } finally {
      cliente.release();
    }
  }
}
