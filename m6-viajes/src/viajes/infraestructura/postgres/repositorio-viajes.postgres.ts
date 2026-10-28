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
} from '../../dominio/tipos';
import { Viaje, ViajeProps } from '../../dominio/viaje';
import { ConflictoConcurrenciaError, ViajeNoEncontradoError } from '../../aplicacion/errores';
import { routingKeyDe, SobreEvento } from '../../aplicacion/eventos';
import { FiltrosViajes, PaginaDeViajes, RepositorioViajes } from '../../aplicacion/puertos';

/** Fila de la tabla `viajes` tal como la devuelve `pg`. */
interface FilaViaje {
  id: string;
  solicitud_id: string;
  reserva_id: string | null;
  cliente_id: string;
  conductor_id: string;
  vehiculo_id: string;
  tipo_vehiculo: TipoVehiculo;
  origen_latitud: number;
  origen_longitud: number;
  origen_direccion: string | null;
  destino_latitud: number;
  destino_longitud: number;
  destino_direccion: string | null;
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
  actor_rol: Actor['role'];
  actor_id: string;
  ocurrido_en: Date;
  motivo: MotivoCancelacion | null;
  detalle: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esUuid = (valor: string) => UUID.test(valor);

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

  async buscarPorSolicitud(requestId: string): Promise<Viaje | null> {
    if (!esUuid(requestId)) return null;
    return this.buscarUno('solicitud_id = $1', [requestId]);
  }

  async listar(f: FiltrosViajes): Promise<PaginaDeViajes> {
    // Un id que no es UUID (por ejemplo, el de un token de prueba) no puede tener viajes.
    if ((f.clientId && !esUuid(f.clientId)) || (f.driverId && !esUuid(f.driverId))) {
      return { items: [], total: 0 };
    }

    const condiciones: string[] = [];
    const valores: unknown[] = [];
    const agregar = (condicion: string, valor: unknown) => {
      valores.push(valor);
      condiciones.push(condicion.replace('?', `$${valores.length}`));
    };
    if (f.clientId) agregar('cliente_id = ?', f.clientId);
    if (f.driverId) agregar('conductor_id = ?', f.driverId);
    if (f.states?.length) agregar('estado = ANY(?)', f.states);
    if (f.from) agregar('creado_en >= ?', f.from);
    if (f.to) agregar('creado_en < ?', f.to);
    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

    const total = await this.pool.query<{ total: string }>(`SELECT count(*) AS total FROM viajes ${where}`, valores);
    const filas = await this.pool.query<FilaViaje>(
      `SELECT * FROM viajes ${where}
       ORDER BY creado_en DESC, id
       LIMIT $${valores.length + 1} OFFSET $${valores.length + 2}`,
      [...valores, f.pageSize, (f.page - 1) * f.pageSize],
    );
    return { items: await this.conHistorial(filas.rows), total: Number(total.rows[0].total) };
  }

  async insertar(viaje: Viaje, eventos: SobreEvento[]): Promise<Viaje> {
    const v = viaje.toProps();
    const guardado = await this.enTransaccion(async (cliente) => {
      const { rowCount } = await cliente.query(
        `INSERT INTO viajes (id, solicitud_id, reserva_id, cliente_id, conductor_id, vehiculo_id,
                             tipo_vehiculo, origen_latitud, origen_longitud, origen_direccion, destino_latitud,
                             destino_longitud, destino_direccion, estado, version, creado_en, arribo_en,
                             iniciado_en, finalizado_en, cancelado_en, cierre, cancelacion)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
         ON CONFLICT (solicitud_id) DO NOTHING`,
        [
          v.id,
          v.requestId,
          v.reservationId ?? null,
          v.clientId,
          v.driverId,
          v.vehicleId,
          v.vehicleType,
          v.originLatitude,
          v.originLongitude,
          v.originAddress ?? null,
          v.destinationLatitude,
          v.destinationLongitude,
          v.destinationAddress ?? null,
          v.state,
          v.version,
          v.createdAt,
          v.arrivedAt,
          v.startedAt,
          v.completedAt,
          v.cancelledAt,
          json(v.closure),
          json(v.cancellation),
        ],
      );
      if (rowCount === 0) {
        return false; // Otro pedido ya creó el viaje de esta solicitud.
      }
      await this.insertarTransiciones(cliente, v.id, v.history);
      await insertarEventos(cliente, eventos);
      return true;
    });
    if (guardado) {
      return viaje;
    }
    const existente = await this.buscarPorSolicitud(v.requestId);
    if (!existente) throw new Error(`No se encontró el viaje de la solicitud ${v.requestId}`);
    return existente;
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
          v.state,
          v.version,
          v.arrivedAt,
          v.startedAt,
          v.completedAt,
          v.cancelledAt,
          json(v.closure),
          json(v.cancellation),
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
        v.history.filter((t) => t.sequence > versionLeida),
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
        [viajeId, t.sequence, t.from, t.to, t.action, t.actor.role, t.actor.id, t.occurredAt, t.reason ?? null, t.detail ?? null],
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
      [evento.eventId, evento.eventType, routingKeyDe(evento), JSON.stringify(evento)],
    );
  }
}

const json = (valor: unknown) => (valor === null || valor === undefined ? null : JSON.stringify(valor));

function aTransicion(f: FilaTransicion): TransicionViaje {
  return Object.freeze({
    sequence: f.secuencia,
    from: f.desde,
    to: f.hacia,
    action: f.accion,
    actor: Object.freeze({ role: f.actor_rol, id: f.actor_id }),
    occurredAt: f.ocurrido_en,
    ...(f.motivo !== null && { reason: f.motivo }),
    ...(f.detalle !== null && { detail: f.detalle }),
  });
}

function aProps(f: FilaViaje, historial: TransicionViaje[]): ViajeProps {
  return {
    id: f.id,
    requestId: f.solicitud_id,
    reservationId: f.reserva_id,
    clientId: f.cliente_id,
    driverId: f.conductor_id,
    vehicleId: f.vehiculo_id,
    vehicleType: f.tipo_vehiculo,
    originLatitude: f.origen_latitud,
    originLongitude: f.origen_longitud,
    destinationLatitude: f.destino_latitud,
    destinationLongitude: f.destino_longitud,
    ...(f.origen_direccion !== null && { originAddress: f.origen_direccion }),
    ...(f.destino_direccion !== null && { destinationAddress: f.destino_direccion }),
    state: f.estado,
    version: f.version,
    history: historial,
    createdAt: f.creado_en,
    arrivedAt: f.arribo_en,
    startedAt: f.iniciado_en,
    completedAt: f.finalizado_en,
    cancelledAt: f.cancelado_en,
    closure: f.cierre,
    cancellation: f.cancelacion,
  };
}
