import { AccionNoPermitidaError, DatosInvalidosError, MotivoNoPermitidoError } from './errores';
import { MOTIVOS_POR_ROL, resolverTransicion } from './maquina-estados';
import {
  AccionViaje,
  Actor,
  DatosCancelacion,
  DatosCierre,
  EstadoViaje,
  MotivoCancelacion,
  Rol,
  TipoVehiculo,
  TransicionViaje,
} from './tipos';

const LARGO_MAXIMO_DETALLE = 500;
/** Mismo mínimo que el contrato del Grupo 12: un viaje de 0 km no es un viaje. */
export const DISTANCIA_MINIMA_KM = 0.1;

export interface ConfiguracionViaje {
  /** Minutos que el conductor debe esperar tras el arribo antes de cancelar por CLIENTE_NO_SE_PRESENTO (R6-04). */
  esperaMinimaArriboMinutos: number;
}

export const CONFIGURACION_POR_DEFECTO: ConfiguracionViaje = { esperaMinimaArriboMinutos: 5 };

/** Datos que M5 envía al crear el viaje. */
export interface DatosNuevoViaje {
  id: string;
  /** Id de la solicitud de M5. Es la clave de idempotencia de la creación (igual que en el Grupo 12). */
  requestId: string;
  reservationId?: string | null;
  clientId: string;
  driverId: string;
  vehicleId: string;
  vehicleType: TipoVehiculo;
  /** Coordenadas decimales (grados), como campos sueltos de tipo double. */
  originLatitude: number;
  originLongitude: number;
  destinationLatitude: number;
  destinationLongitude: number;
  originAddress?: string;
  destinationAddress?: string;
}

/** Foto completa del viaje, usada para persistir y reconstruir la entidad. */
export interface ViajeProps extends DatosNuevoViaje {
  state: EstadoViaje;
  version: number;
  history: TransicionViaje[];
  createdAt: Date;
  arrivedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  closure: DatosCierre | null;
  cancellation: DatosCancelacion | null;
}

export interface DatosFinalizacion {
  /** Kilómetros recorridos (decimal). */
  distanceKm: number;
  finalLatitude?: number;
  finalLongitude?: number;
}

export interface SolicitudCancelacion {
  reason: MotivoCancelacion;
  detail?: string;
}

/**
 * Entidad Viaje: aplica la máquina de estados y registra cada cambio en un historial
 * que sólo crece (RF-6.8). No sabe nada de HTTP ni de base de datos.
 */
export class Viaje {
  private constructor(private props: ViajeProps) {}

  static crear(datos: DatosNuevoViaje, actor: Actor, ahora: Date): Viaje {
    if (actor.role !== Rol.SYSTEM) {
      throw new AccionNoPermitidaError(actor.role, AccionViaje.CREATE, 'sólo M5 (servicio) crea viajes');
    }
    const viaje = new Viaje({
      ...datos,
      reservationId: datos.reservationId ?? null,
      state: EstadoViaje.PENDING_ARRIVAL,
      version: 1,
      history: [],
      createdAt: ahora,
      arrivedAt: null,
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
      closure: null,
      cancellation: null,
    });
    viaje.registrar(null, EstadoViaje.PENDING_ARRIVAL, AccionViaje.CREATE, actor, ahora);
    return viaje;
  }

  /** Reconstruye un viaje ya existente (por ejemplo, leído de la base). */
  static reconstituir(props: ViajeProps): Viaje {
    return new Viaje({ ...props, history: [...props.history] });
  }

  // RF-6.3
  registrarArribo(actor: Actor, ahora: Date): void {
    this.verificarPertenencia(actor, AccionViaje.REGISTER_ARRIVAL);
    const hacia = resolverTransicion(this.state, AccionViaje.REGISTER_ARRIVAL, actor.role);
    this.props.arrivedAt = ahora;
    this.aplicar(hacia, AccionViaje.REGISTER_ARRIVAL, actor, ahora);
  }

  /**
   * RF-6.4. La validación del código QR la hace la capa de aplicación contra M8
   * antes de llamar a este método: si se llega acá, el código ya fue validado y consumido.
   */
  iniciar(actor: Actor, ahora: Date): void {
    this.verificarPertenencia(actor, AccionViaje.START);
    const hacia = resolverTransicion(this.state, AccionViaje.START, actor.role);
    this.props.startedAt = ahora;
    this.aplicar(hacia, AccionViaje.START, actor, ahora);
  }

  // RF-6.5
  finalizar(actor: Actor, datos: DatosFinalizacion, ahora: Date): void {
    this.verificarPertenencia(actor, AccionViaje.COMPLETE);
    const hacia = resolverTransicion(this.state, AccionViaje.COMPLETE, actor.role);
    if (!Number.isFinite(datos.distanceKm) || datos.distanceKm < DISTANCIA_MINIMA_KM) {
      throw new DatosInvalidosError(`distanceKm debe ser un número mayor o igual a ${DISTANCIA_MINIMA_KM}`);
    }
    // iniciadoEn siempre está definido en EN_CURSO, que es el único estado desde el que se finaliza.
    const inicio = this.props.startedAt as Date;
    this.props.completedAt = ahora;
    this.props.closure = {
      distanceKm: datos.distanceKm,
      durationSeconds: Math.max(0, Math.round((ahora.getTime() - inicio.getTime()) / 1000)),
      finalLatitude: datos.finalLatitude,
      finalLongitude: datos.finalLongitude,
    };
    this.aplicar(hacia, AccionViaje.COMPLETE, actor, ahora);
  }

  // RF-6.6 y RF-6.7
  cancelar(
    actor: Actor,
    solicitud: SolicitudCancelacion,
    ahora: Date,
    config: ConfiguracionViaje = CONFIGURACION_POR_DEFECTO,
  ): void {
    this.verificarPertenencia(actor, AccionViaje.CANCEL);
    const previousState = this.state;
    const hacia = resolverTransicion(previousState, AccionViaje.CANCEL, actor.role);
    this.validarMotivo(actor.role, solicitud.reason, ahora, config);
    if (solicitud.detail !== undefined && solicitud.detail.length > LARGO_MAXIMO_DETALLE) {
      throw new DatosInvalidosError(`detail no puede superar ${LARGO_MAXIMO_DETALLE} caracteres`);
    }

    this.props.cancelledAt = ahora;
    this.props.cancellation = {
      cancelledBy: actor.role,
      actorId: actor.id,
      reason: solicitud.reason,
      detail: solicitud.detail,
      previousState,
      requiresRedispatch:
        actor.role === Rol.DRIVER &&
        previousState !== EstadoViaje.IN_PROGRESS &&
        solicitud.reason !== MotivoCancelacion.CLIENT_NO_SHOW,
    };
    this.aplicar(hacia, AccionViaje.CANCEL, actor, ahora, solicitud.reason, solicitud.detail);
  }

  /** ¿Son estos los mismos datos con los que se creó el viaje? Decide entre 200 (reintento) y 409 en POST /trips. */
  coincideCon(datos: Omit<DatosNuevoViaje, 'id'>): boolean {
    const p = this.props;
    return (
      p.requestId === datos.requestId &&
      (p.reservationId ?? null) === (datos.reservationId ?? null) &&
      p.clientId === datos.clientId &&
      p.driverId === datos.driverId &&
      p.vehicleId === datos.vehicleId &&
      p.vehicleType === datos.vehicleType &&
      p.originLatitude === datos.originLatitude &&
      p.originLongitude === datos.originLongitude &&
      p.destinationLatitude === datos.destinationLatitude &&
      p.destinationLongitude === datos.destinationLongitude &&
      (p.originAddress ?? null) === (datos.originAddress ?? null) &&
      (p.destinationAddress ?? null) === (datos.destinationAddress ?? null)
    );
  }

  get id(): string {
    return this.props.id;
  }

  get state(): EstadoViaje {
    return this.props.state;
  }

  get version(): number {
    return this.props.version;
  }

  get history(): readonly TransicionViaje[] {
    return this.props.history;
  }

  /** Copia de los datos, para persistir o para armar respuestas. */
  toProps(): ViajeProps {
    return { ...this.props, history: [...this.props.history] };
  }

  private verificarPertenencia(actor: Actor, action: AccionViaje): void {
    if (actor.role === Rol.DRIVER && actor.id !== this.props.driverId) {
      throw new AccionNoPermitidaError(actor.role, action, 'no es el conductor asignado al viaje');
    }
    if (actor.role === Rol.CLIENT && actor.id !== this.props.clientId) {
      throw new AccionNoPermitidaError(actor.role, action, 'no es el cliente del viaje');
    }
  }

  private validarMotivo(role: Rol, reason: MotivoCancelacion, ahora: Date, config: ConfiguracionViaje): void {
    if (!(MOTIVOS_POR_ROL[role] ?? []).includes(reason)) {
      throw new MotivoNoPermitidoError(reason, `no es un motivo válido para ${role}`);
    }
    if (reason === MotivoCancelacion.CLIENT_NO_SHOW) {
      if (this.state !== EstadoViaje.DRIVER_ARRIVED || this.props.arrivedAt === null) {
        throw new MotivoNoPermitidoError(reason, 'el conductor todavía no registró el arribo');
      }
      const minutosEsperando = (ahora.getTime() - this.props.arrivedAt.getTime()) / 60_000;
      if (minutosEsperando < config.esperaMinimaArriboMinutos) {
        throw new MotivoNoPermitidoError(
          reason,
          `deben pasar ${config.esperaMinimaArriboMinutos} minutos desde el arribo`,
        );
      }
    }
  }

  private aplicar(
    to: EstadoViaje,
    action: AccionViaje,
    actor: Actor,
    ahora: Date,
    reason?: MotivoCancelacion,
    detail?: string,
  ): void {
    this.registrar(this.state, to, action, actor, ahora, reason, detail);
    this.props.state = to;
    this.props.version += 1;
  }

  private registrar(
    from: EstadoViaje | null,
    to: EstadoViaje,
    action: AccionViaje,
    actor: Actor,
    ahora: Date,
    reason?: MotivoCancelacion,
    detail?: string,
  ): void {
    const transicion: TransicionViaje = Object.freeze({
      sequence: this.props.history.length + 1,
      from,
      to,
      action,
      actor: Object.freeze({ ...actor }),
      occurredAt: ahora,
      ...(reason !== undefined && { reason }),
      ...(detail !== undefined && { detail }),
    });
    this.props.history.push(transicion);
  }
}
