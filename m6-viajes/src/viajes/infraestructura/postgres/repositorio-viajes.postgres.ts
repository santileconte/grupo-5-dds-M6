import { Pool, PoolClient } from 'pg';
import {
  AccionViaje,
  Actor,
  DatosCancelacion,
  DatosCierre,
  EstadoViaje,
  MotivoCancelacion,
  TipoVehiculo,
  TransicionViaje,
  Ubicacion,
} from '../../dominio/tipos';
import { Viaje, ViajeProps } from '../../dominio/viaje';
import { ConflictoConcurrenciaError, ViajeActivoExistenteError, ViajeNoEncontradoError } from '../../aplicacion/errores';
import { routingKeyDe, SobreEvento } from '../../aplicacion/eventos';
import { FiltrosViajes, PaginaDeViajes, RepositorioViajes } from '../../aplicacion/puertos';

/** Fila de la tabla `viajes` tal como la devuelve `pg`. */
interface FilaViaje {
  id: string;
  solicitud_id: string;
  asignacion_id: string;
  reserva_id: string | null;
  cliente_id: string;
  conductor_id: string;
  vehiculo_id: string;
  tipo_vehiculo: TipoVehiculo;
  origen: Ubicacion;
  destino: Ubicacion;
  estado: EstadoViaje;
  version: number;
  creado_en: Date;
  arribo_en: Date | null;
  iniciado_en: Date | null;
  finalizado_en: Date | null;
  cancelado_en: Date | null;
  cierre: DatosCierre | null;
  cancelacion: DatosCancelacion | null;
}

interface FilaTransicion {
  viaje_id: string;
  secuencia: number;
  desde: EstadoViaje | null;
  hacia: EstadoViaje;
  accion: AccionViaje;
  actor_rol: Actor['rol'];
  actor_id: string;
  ocurrido_en: Date;
  motivo: MotivoCancelacion | null;
  detalle: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esUuid = (valor: string) => UUID.test(valor);

/** Código de PostgreSQL para "violación de restricción única". */
const VIOLACION_UNICIDAD = '23505';

/**
 * Repositorio de viajes sobre PostgreSQL (RNF-05: M6 es el único dueño de estas tablas).
 * Ver migraciones/001_viajes_y_transiciones.sql.
 */
export class RepositorioViajesPostgres implements RepositorioViajes {
  constructor(private readonly pool: Pool) {}

  async buscarPorId(id: string): Promise<Viaje | null> {
    if (!esUuid(id)) return null;
    return this.buscarUno('id = $1', [id]);
  }

  async buscarPorAsignacion(asignacionId: string): Promise<Viaje | null> {
    if (!esUuid(asignacionId)) return null;
    return this.buscarUno('asignacion_id = $1', [asignacionId]);
  }

  async buscarActivoPorSolicitud(solicitudId: string): Promise<Viaje | null> {
    if (!esUuid(solicitudId)) return null;
    return this.buscarUno(`solicitud_id = $1 AND estado NOT IN ('FINALIZADO', 'CANCELADO')`, [solicitudId]);
  }

  async listar(f: FiltrosViajes): Promise<PaginaDeViajes> {
    // Un id que no es UUID (por ejemplo, el de un token de prueba) no puede tener viajes.
    if ((f.clienteId && !esUuid(f.clienteId)) || (f.conductorId && !esUuid(f.conductorId))) {
      return { items: [], total: 0 };
    }

    const condiciones: string[] = [];
    const valores: unknown[] = [];
    const agregar = (condicion: string, valor: unknown) => {
      valores.push(valor);
      condiciones.push(condicion.replace('?', `$${valores.length}`));
    };
    if (f.clienteId) agregar('cliente_id = ?', f.clienteId);
    if (f.conductorId) agregar('conductor_id = ?', f.conductorId);
    if (f.estados?.length) agregar('estado = ANY(?)', f.estados);
    if (f.desde) agregar('creado_en >= ?', f.desde);
    if (f.hasta) agregar('creado_en < ?', f.hasta);
    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

    const total = await this.pool.query<{ total: string }>(`SELECT count(*) AS total FROM viajes ${where}`, valores);
    const filas = await this.pool.query<FilaViaje>(
      `SELECT * FROM viajes ${where}
       ORDER BY creado_en DESC, id
       LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}`,
      [...valores, f.tamanio, (f.pagina - 1) * f.tamanio],
    );
    return { items: await this.conHistorial(filas.rows), total: Number(total.rows[0].total) };
  }

  async insertar(viaje: Viaje, eventos: SobreEvento[]): Promise<Viaje> {
    const v = viaje.toProps();
    try {
      const guardado = await this.enTransaccion(async (cliente) => {
        const { rowCount } = await cliente.query(
          `INSERT INTO viajes (id, solicitud_id, asignacion_id, reserva_id, cliente_id, conductor_id, vehiculo_id,
                               tipo_vehiculo, origen, destino, estado, version, creado_en, arribo_en, iniciado_en,
                               finalizado_en, cancelado_en, cierre, cancelacion)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
           ON CONFLICT (asignacion_id) DO NOTHING`,
          [
            v.id,
            v.solicitudId,
            v.asignacionId,
            v.reservaId ?? null,
            v.clienteId,
            v.conductorId,
            v.vehiculoId,
            v.tipoVehiculo,
            JSON.stringify(v.origen),
            JSON.stringify(v.destino),
            v.estado,
            v.version,
            v.creadoEn,
            v.arriboEn,
            v.iniciadoEn,
            v.finalizadoEn,
            v.canceladoEn,
            json(v.cierre),
            json(v.cancelacion),
          ],
        );
        if (rowCount === 0) {
          return false; // Otro pedido ya creó el viaje de esta asignación.
        }
        await this.insertarTransiciones(cliente, v.id, v.historial);
        await insertarEventos(cliente, eventos);
        return true;
      });
      if (guardado) {
        return viaje;
      }
      const existente = await this.buscarPorAsignacion(v.asignacionId);
      if (!existente) throw new Error(`No se encontró el viaje de la asignación ${v.asignacionId}`);
      return existente;
    } catch (error) {
      if (esViolacionDe(error, 'viajes_un_activo_por_solicitud')) {
        throw new ViajeActivoExistenteError(v.solicitudId);
      }
      throw error;
    }
  }

  async actualizar(viaje: Viaje, versionLeida: number, eventos: SobreEvento[]): Promise<void> {
    const v = viaje.toProps();
    await this.enTransaccion(async (cliente) => {
      // Sólo se actualiza si nadie lo modificó desde que lo leímos (RNF-08).
      const { rowCount } = await cliente.query(
        `UPDATE viajes
            SET estado = $3, version = $4, arribo_en = $5, iniciado_en = $6, finalizado_en = $7,
                cancelado_en = $8, cierre = $9, cancelacion = $10
          WHERE id = $1 AND version = $2`,
        [
          v.id,
          versionLeida,
          v.estado,
          v.version,
          v.arriboEn,
          v.iniciadoEn,
          v.finalizadoEn,
          v.canceladoEn,
          json(v.cierre),
          json(v.cancelacion),
        ],
      );
      if (rowCount === 0) {
        const existe = await cliente.query('SELECT 1 FROM viajes WHERE id = $1', [v.id]);
        throw existe.rowCount ? new ConflictoConcurrenciaError(v.id) : new ViajeNoEncontradoError(v.id);
      }
      // Cada transición incrementa la versión en 1, así que las nuevas son las de secuencia > versionLeida.
      await this.insertarTransiciones(
        cliente,
        v.id,
        v.historial.filter((t) => t.secuencia > versionLeida),
      );
      await insertarEventos(cliente, eventos);
    });
  }

  private async buscarUno(condicion: string, valores: unknown[]): Promise<Viaje | null> {
    const { rows } = await this.pool.query<FilaViaje>(`SELECT * FROM viajes WHERE ${condicion}`, valores);
    if (rows.length === 0) return null;
    const [viaje] = await this.conHistorial(rows);
    return viaje;
  }

  /** Carga el historial de las filas en una sola consulta y arma las entidades. */
  private async conHistorial(filas: FilaViaje[]): Promise<Viaje[]> {
    if (filas.length === 0) return [];
    const { rows } = await this.pool.query<FilaTransicion>(
      'SELECT * FROM transiciones_viaje WHERE viaje_id = ANY($1::uuid[]) ORDER BY viaje_id, secuencia',
      [filas.map((f) => f.id)],
    );
    const porViaje = new Map<string, TransicionViaje[]>();
    for (const fila of rows) {
      const lista = porViaje.get(fila.viaje_id) ?? [];
      lista.push(aTransicion(fila));
      porViaje.set(fila.viaje_id, lista);
    }
    return filas.map((fila) => Viaje.reconstituir(aProps(fila, porViaje.get(fila.id) ?? [])));
  }

  private async insertarTransiciones(cliente: PoolClient, viajeId: string, transiciones: readonly TransicionViaje[]) {
    for (const t of transiciones) {
      await cliente.query(
        `INSERT INTO transiciones_viaje (viaje_id, secuencia, desde, hacia, accion, actor_rol, actor_id, ocurrido_en, motivo, detalle)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [viajeId, t.secuencia, t.desde, t.hacia, t.accion, t.actor.rol, t.actor.id, t.ocurridoEn, t.motivo ?? null, t.detalle ?? null],
      );
    }
  }

  private async enTransaccion<T>(trabajo: (cliente: PoolClient) => Promise<T>): Promise<T> {
    const cliente = await this.pool.connect();
    try {
      await cliente.query('BEGIN');
      const resultado = await trabajo(cliente);
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

/** Guarda los eventos en la bandeja de salida, dentro de la transacción del cambio que los origina. */
async function insertarEventos(cliente: PoolClient, eventos: SobreEvento[]): Promise<void> {
  for (const evento of eventos) {
    await cliente.query(
      `INSERT INTO eventos_salientes (id_evento, tipo, routing_key, cuerpo) VALUES ($1, $2, $3, $4)`,
      [evento.idEvento, evento.tipo, routingKeyDe(evento), JSON.stringify(evento)],
    );
  }
}

const json = (valor: unknown) => (valor === null || valor === undefined ? null : JSON.stringify(valor));

function esViolacionDe(error: unknown, restriccion: string): boolean {
  const e = error as { code?: string; constraint?: string };
  return e?.code === VIOLACION_UNICIDAD && e.constraint === restriccion;
}

function aTransicion(f: FilaTransicion): TransicionViaje {
  return Object.freeze({
    secuencia: f.secuencia,
    desde: f.desde,
    hacia: f.hacia,
    accion: f.accion,
    actor: Object.freeze({ rol: f.actor_rol, id: f.actor_id }),
    ocurridoEn: f.ocurrido_en,
    ...(f.motivo !== null && { motivo: f.motivo }),
    ...(f.detalle !== null && { detalle: f.detalle }),
  });
}

function aProps(f: FilaViaje, historial: TransicionViaje[]): ViajeProps {
  return {
    id: f.id,
    solicitudId: f.solicitud_id,
    asignacionId: f.asignacion_id,
    reservaId: f.reserva_id,
    clienteId: f.cliente_id,
    conductorId: f.conductor_id,
    vehiculoId: f.vehiculo_id,
    tipoVehiculo: f.tipo_vehiculo,
    origen: f.origen,
    destino: f.destino,
    estado: f.estado,
    version: f.version,
    historial,
    creadoEn: f.creado_en,
    arriboEn: f.arribo_en,
    iniciadoEn: f.iniciado_en,
    finalizadoEn: f.finalizado_en,
    canceladoEn: f.cancelado_en,
    cierre: f.cierre,
    cancelacion: f.cancelacion,
  };
}
