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
  Ubicacion,
} from './tipos';

const LARGO_MAXIMO_DETALLE = 500;

export interface ConfiguracionViaje {
  /** Minutos que el conductor debe esperar tras el arribo antes de cancelar por CLIENTE_NO_SE_PRESENTO (R6-04). */
  esperaMinimaArriboMinutos: number;
}

export const CONFIGURACION_POR_DEFECTO: ConfiguracionViaje = { esperaMinimaArriboMinutos: 5 };

/** Datos que M5 envía al crear el viaje. */
export interface DatosNuevoViaje {
  id: string;
  solicitudId: string;
  asignacionId: string;
  reservaId?: string | null;
  clienteId: string;
  conductorId: string;
  vehiculoId: string;
  tipoVehiculo: TipoVehiculo;
  origen: Ubicacion;
  destino: Ubicacion;
}

/** Foto completa del viaje, usada para persistir y reconstruir la entidad. */
export interface ViajeProps extends DatosNuevoViaje {
  estado: EstadoViaje;
  version: number;
  historial: TransicionViaje[];
  creadoEn: Date;
  arriboEn: Date | null;
  iniciadoEn: Date | null;
  finalizadoEn: Date | null;
  canceladoEn: Date | null;
  cierre: DatosCierre | null;
  cancelacion: DatosCancelacion | null;
}

export interface DatosFinalizacion {
  distanciaRecorridaMetros: number;
  ubicacionFinal?: Ubicacion;
}

export interface SolicitudCancelacion {
  motivo: MotivoCancelacion;
  detalle?: string;
}

/**
 * Entidad Viaje: aplica la máquina de estados y registra cada cambio en un historial
 * que sólo crece (RF-6.8). No sabe nada de HTTP ni de base de datos.
 */
export class Viaje {
  private constructor(private props: ViajeProps) {}

  static crear(datos: DatosNuevoViaje, actor: Actor, ahora: Date): Viaje {
    if (actor.rol !== Rol.SERVICIO) {
      throw new AccionNoPermitidaError(actor.rol, AccionViaje.CREAR, 'sólo M5 (servicio) crea viajes');
    }
    const viaje = new Viaje({
      ...datos,
      reservaId: datos.reservaId ?? null,
      estado: EstadoViaje.ASIGNADO,
      version: 1,
      historial: [],
      creadoEn: ahora,
      arriboEn: null,
      iniciadoEn: null,
      finalizadoEn: null,
      canceladoEn: null,
      cierre: null,
      cancelacion: null,
    });
    viaje.registrar(null, EstadoViaje.ASIGNADO, AccionViaje.CREAR, actor, ahora);
    return viaje;
  }

  /** Reconstruye un viaje ya existente (por ejemplo, leído de la base). */
  static reconstituir(props: ViajeProps): Viaje {
    return new Viaje({ ...props, historial: [...props.historial] });
  }

  // RF-6.3
  registrarArribo(actor: Actor, ahora: Date): void {
    this.verificarPertenencia(actor, AccionViaje.REGISTRAR_ARRIBO);
    const hacia = resolverTransicion(this.estado, AccionViaje.REGISTRAR_ARRIBO, actor.rol);
    this.props.arriboEn = ahora;
    this.aplicar(hacia, AccionViaje.REGISTRAR_ARRIBO, actor, ahora);
  }

  /**
   * RF-6.4. La validación del código QR la hace la capa de aplicación contra M8
   * antes de llamar a este método: si se llega acá, el código ya fue validado y consumido.
   */
  iniciar(actor: Actor, ahora: Date): void {
    this.verificarPertenencia(actor, AccionViaje.INICIAR);
    const hacia = resolverTransicion(this.estado, AccionViaje.INICIAR, actor.rol);
    this.props.iniciadoEn = ahora;
    this.aplicar(hacia, AccionViaje.INICIAR, actor, ahora);
  }

  // RF-6.5
  finalizar(actor: Actor, datos: DatosFinalizacion, ahora: Date): void {
    this.verificarPertenencia(actor, AccionViaje.FINALIZAR);
    const hacia = resolverTransicion(this.estado, AccionViaje.FINALIZAR, actor.rol);
    if (!Number.isFinite(datos.distanciaRecorridaMetros) || datos.distanciaRecorridaMetros < 0) {
      throw new DatosInvalidosError('distanciaRecorridaMetros debe ser un número mayor o igual a 0');
    }
    // iniciadoEn siempre está definido en EN_CURSO, que es el único estado desde el que se finaliza.
    const inicio = this.props.iniciadoEn as Date;
    this.props.finalizadoEn = ahora;
    this.props.cierre = {
      distanciaRecorridaMetros: datos.distanciaRecorridaMetros,
      duracionSegundos: Math.max(0, Math.round((ahora.getTime() - inicio.getTime()) / 1000)),
      ubicacionFinal: datos.ubicacionFinal,
    };
    this.aplicar(hacia, AccionViaje.FINALIZAR, actor, ahora);
  }

  // RF-6.6 y RF-6.7
  cancelar(
    actor: Actor,
    solicitud: SolicitudCancelacion,
    ahora: Date,
    config: ConfiguracionViaje = CONFIGURACION_POR_DEFECTO,
  ): void {
    this.verificarPertenencia(actor, AccionViaje.CANCELAR);
    const estadoAlCancelar = this.estado;
    const hacia = resolverTransicion(estadoAlCancelar, AccionViaje.CANCELAR, actor.rol);
    this.validarMotivo(actor.rol, solicitud.motivo, ahora, config);
    if (solicitud.detalle !== undefined && solicitud.detalle.length > LARGO_MAXIMO_DETALLE) {
      throw new DatosInvalidosError(`detalle no puede superar ${LARGO_MAXIMO_DETALLE} caracteres`);
    }

    this.props.canceladoEn = ahora;
    this.props.cancelacion = {
      canceladoPor: actor.rol,
      actorId: actor.id,
      motivo: solicitud.motivo,
      detalle: solicitud.detalle,
      estadoAlCancelar,
      requiereRedespacho:
        actor.rol === Rol.CONDUCTOR &&
        estadoAlCancelar !== EstadoViaje.EN_CURSO &&
        solicitud.motivo !== MotivoCancelacion.CLIENTE_NO_SE_PRESENTO,
    };
    this.aplicar(hacia, AccionViaje.CANCELAR, actor, ahora, solicitud.motivo, solicitud.detalle);
  }

  get id(): string {
    return this.props.id;
  }

  get estado(): EstadoViaje {
    return this.props.estado;
  }

  get version(): number {
    return this.props.version;
  }

  get historial(): readonly TransicionViaje[] {
    return this.props.historial;
  }

  /** Copia de los datos, para persistir o para armar respuestas. */
  toProps(): ViajeProps {
    return { ...this.props, historial: [...this.props.historial] };
  }

  private verificarPertenencia(actor: Actor, accion: AccionViaje): void {
    if (actor.rol === Rol.CONDUCTOR && actor.id !== this.props.conductorId) {
      throw new AccionNoPermitidaError(actor.rol, accion, 'no es el conductor asignado al viaje');
    }
    if (actor.rol === Rol.CLIENTE && actor.id !== this.props.clienteId) {
      throw new AccionNoPermitidaError(actor.rol, accion, 'no es el cliente del viaje');
    }
  }

  private validarMotivo(rol: Rol, motivo: MotivoCancelacion, ahora: Date, config: ConfiguracionViaje): void {
    if (!(MOTIVOS_POR_ROL[rol] ?? []).includes(motivo)) {
      throw new MotivoNoPermitidoError(motivo, `no es un motivo válido para ${rol}`);
    }
    if (motivo === MotivoCancelacion.CLIENTE_NO_SE_PRESENTO) {
      if (this.estado !== EstadoViaje.CONDUCTOR_ARRIBADO || this.props.arriboEn === null) {
        throw new MotivoNoPermitidoError(motivo, 'el conductor todavía no registró el arribo');
      }
      const minutosEsperando = (ahora.getTime() - this.props.arriboEn.getTime()) / 60_000;
      if (minutosEsperando < config.esperaMinimaArriboMinutos) {
        throw new MotivoNoPermitidoError(
          motivo,
          `deben pasar ${config.esperaMinimaArriboMinutos} minutos desde el arribo`,
        );
      }
    }
  }

  private aplicar(
    hacia: EstadoViaje,
    accion: AccionViaje,
    actor: Actor,
    ahora: Date,
    motivo?: MotivoCancelacion,
    detalle?: string,
  ): void {
    this.registrar(this.estado, hacia, accion, actor, ahora, motivo, detalle);
    this.props.estado = hacia;
    this.props.version += 1;
  }

  private registrar(
    desde: EstadoViaje | null,
    hacia: EstadoViaje,
    accion: AccionViaje,
    actor: Actor,
    ahora: Date,
    motivo?: MotivoCancelacion,
    detalle?: string,
  ): void {
    const transicion: TransicionViaje = Object.freeze({
      secuencia: this.props.historial.length + 1,
      desde,
      hacia,
      accion,
      actor: Object.freeze({ ...actor }),
      ocurridoEn: ahora,
      ...(motivo !== undefined && { motivo }),
      ...(detalle !== undefined && { detalle }),
    });
    this.props.historial.push(transicion);
  }
}
