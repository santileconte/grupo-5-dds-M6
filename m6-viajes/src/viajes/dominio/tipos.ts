export enum EstadoViaje {
  PENDING_ARRIVAL = 'PENDING_ARRIVAL',
  DRIVER_ARRIVED = 'DRIVER_ARRIVED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export const ESTADOS_TERMINALES: readonly EstadoViaje[] = [EstadoViaje.COMPLETED, EstadoViaje.CANCELLED];

export enum AccionViaje {
  CREATE = 'CREATE',
  REGISTER_ARRIVAL = 'REGISTER_ARRIVAL',
  START = 'START',
  COMPLETE = 'COMPLETE',
  CANCEL = 'CANCEL',
}

/** Roles definidos por M1 (RF-1.3) más SERVICIO para llamadas entre módulos. */
export enum Rol {
  CLIENT = 'CLIENT',
  DRIVER = 'DRIVER',
  OPERATOR = 'OPERATOR',
  SYSTEM = 'SYSTEM',
}

export enum TipoVehiculo {
  CAR = 'CAR',
  MOTORCYCLE = 'MOTORCYCLE',
}

export enum MotivoCancelacion {
  // Cliente
  CHANGE_OF_PLANS = 'CHANGE_OF_PLANS',
  EXCESSIVE_DELAY = 'EXCESSIVE_DELAY',
  DRIVER_NO_SHOW = 'DRIVER_NO_SHOW',
  // Conductor
  CLIENT_NO_SHOW = 'CLIENT_NO_SHOW',
  VEHICLE_PROBLEM = 'VEHICLE_PROBLEM',
  ORIGIN_UNREACHABLE = 'ORIGIN_UNREACHABLE',
  // Operador
  SECURITY_INCIDENT = 'SECURITY_INCIDENT',
  ADMINISTRATIVE_BLOCK = 'ADMINISTRATIVE_BLOCK',
  // Cualquiera
  OTHER = 'OTHER',
}

/** Quién ejecuta una acción. El id es el del usuario (M1) o el del módulo si es SERVICIO. */
export interface Actor {
  role: Rol;
  id: string;
}

/** Registro inmutable del historial (RF-6.8). */
export interface TransicionViaje {
  readonly sequence: number;
  readonly from: EstadoViaje | null;
  readonly to: EstadoViaje;
  readonly action: AccionViaje;
  readonly actor: Readonly<Actor>;
  readonly occurredAt: Date;
  readonly reason?: MotivoCancelacion;
  readonly detail?: string;
}

export interface DatosCancelacion {
  cancelledBy: Rol;
  actorId: string;
  reason: MotivoCancelacion;
  detail?: string;
  previousState: EstadoViaje;
  requiresRedispatch: boolean;
}

export interface DatosCierre {
  /** Kilómetros recorridos (decimal). */
  distanceKm: number;
  durationSeconds: number;
  /** Posición donde terminó el viaje, si el conductor la informó. */
  finalLatitude?: number;
  finalLongitude?: number;
}
