export enum EstadoViaje {
  ASIGNADO = 'ASIGNADO',
  CONDUCTOR_ARRIBADO = 'CONDUCTOR_ARRIBADO',
  EN_CURSO = 'EN_CURSO',
  FINALIZADO = 'FINALIZADO',
  CANCELADO = 'CANCELADO',
}

export const ESTADOS_TERMINALES: readonly EstadoViaje[] = [EstadoViaje.FINALIZADO, EstadoViaje.CANCELADO];

export enum AccionViaje {
  CREAR = 'CREAR',
  REGISTRAR_ARRIBO = 'REGISTRAR_ARRIBO',
  INICIAR = 'INICIAR',
  FINALIZAR = 'FINALIZAR',
  CANCELAR = 'CANCELAR',
}

/** Roles definidos por M1 (RF-1.3) más SERVICIO para llamadas entre módulos. */
export enum Rol {
  CLIENTE = 'CLIENTE',
  CONDUCTOR = 'CONDUCTOR',
  OPERADOR = 'OPERADOR',
  SERVICIO = 'SERVICIO',
}

export enum TipoVehiculo {
  AUTO = 'AUTO',
  MOTO = 'MOTO',
}

export enum MotivoCancelacion {
  // Cliente
  CAMBIO_DE_PLANES = 'CAMBIO_DE_PLANES',
  DEMORA_EXCESIVA = 'DEMORA_EXCESIVA',
  CONDUCTOR_NO_SE_PRESENTO = 'CONDUCTOR_NO_SE_PRESENTO',
  // Conductor
  CLIENTE_NO_SE_PRESENTO = 'CLIENTE_NO_SE_PRESENTO',
  PROBLEMA_CON_VEHICULO = 'PROBLEMA_CON_VEHICULO',
  ORIGEN_INACCESIBLE = 'ORIGEN_INACCESIBLE',
  // Operador
  INCIDENTE_DE_SEGURIDAD = 'INCIDENTE_DE_SEGURIDAD',
  BLOQUEO_ADMINISTRATIVO = 'BLOQUEO_ADMINISTRATIVO',
  // Cualquiera
  OTRO = 'OTRO',
}

/** Quién ejecuta una acción. El id es el del usuario (M1) o el del módulo si es SERVICIO. */
export interface Actor {
  rol: Rol;
  id: string;
}

export interface Ubicacion {
  latitud: number;
  longitud: number;
  direccion?: string;
}

/** Registro inmutable del historial (RF-6.8). */
export interface TransicionViaje {
  readonly secuencia: number;
  readonly desde: EstadoViaje | null;
  readonly hacia: EstadoViaje;
  readonly accion: AccionViaje;
  readonly actor: Readonly<Actor>;
  readonly ocurridoEn: Date;
  readonly motivo?: MotivoCancelacion;
  readonly detalle?: string;
}

export interface DatosCancelacion {
  canceladoPor: Rol;
  actorId: string;
  motivo: MotivoCancelacion;
  detalle?: string;
  estadoAlCancelar: EstadoViaje;
  requiereRedespacho: boolean;
}

export interface DatosCierre {
  distanciaRecorridaMetros: number;
  duracionSegundos: number;
  ubicacionFinal?: Ubicacion;
}
