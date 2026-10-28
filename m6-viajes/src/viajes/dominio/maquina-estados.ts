import { AccionNoPermitidaError, TransicionInvalidaError } from './errores';
import { AccionViaje, EstadoViaje, MotivoCancelacion, Rol } from './tipos';

/**
 * Tabla de transiciones del viaje (RF-6.1).
 * Es la única fuente de verdad sobre qué acción puede ejecutar cada rol en cada estado.
 * Ver docs/m6/maquina-de-estados.md.
 */
interface ReglaTransicion {
  action: AccionViaje;
  from: readonly EstadoViaje[];
  to: EstadoViaje;
  roles: readonly Rol[];
}

export const TRANSICIONES: readonly ReglaTransicion[] = [
  {
    action: AccionViaje.REGISTER_ARRIVAL,
    from: [EstadoViaje.PENDING_ARRIVAL],
    to: EstadoViaje.DRIVER_ARRIVED,
    roles: [Rol.DRIVER],
  },
  {
    action: AccionViaje.START,
    from: [EstadoViaje.DRIVER_ARRIVED],
    to: EstadoViaje.IN_PROGRESS,
    roles: [Rol.DRIVER],
  },
  {
    action: AccionViaje.COMPLETE,
    from: [EstadoViaje.IN_PROGRESS],
    to: EstadoViaje.COMPLETED,
    roles: [Rol.DRIVER],
  },
  {
    action: AccionViaje.CANCEL,
    from: [EstadoViaje.PENDING_ARRIVAL, EstadoViaje.DRIVER_ARRIVED],
    to: EstadoViaje.CANCELLED,
    roles: [Rol.CLIENT, Rol.DRIVER],
  },
  {
    action: AccionViaje.CANCEL,
    from: [EstadoViaje.PENDING_ARRIVAL, EstadoViaje.DRIVER_ARRIVED, EstadoViaje.IN_PROGRESS],
    to: EstadoViaje.CANCELLED,
    roles: [Rol.OPERATOR],
  },
];

/** Motivos de cancelación que puede usar cada rol (regla R6-03). */
export const MOTIVOS_POR_ROL: Readonly<Partial<Record<Rol, readonly MotivoCancelacion[]>>> = {
  [Rol.CLIENT]: [
    MotivoCancelacion.CHANGE_OF_PLANS,
    MotivoCancelacion.EXCESSIVE_DELAY,
    MotivoCancelacion.DRIVER_NO_SHOW,
    MotivoCancelacion.OTHER,
  ],
  [Rol.DRIVER]: [
    MotivoCancelacion.CLIENT_NO_SHOW,
    MotivoCancelacion.VEHICLE_PROBLEM,
    MotivoCancelacion.ORIGIN_UNREACHABLE,
    MotivoCancelacion.OTHER,
  ],
  [Rol.OPERATOR]: [
    MotivoCancelacion.SECURITY_INCIDENT,
    MotivoCancelacion.ADMINISTRATIVE_BLOCK,
    MotivoCancelacion.OTHER,
  ],
};

/**
 * Devuelve el estado destino de ejecutar `accion` desde `estado` con el rol dado.
 * Lanza AccionNoPermitidaError si el rol nunca puede ejecutar esa acción y
 * TransicionInvalidaError si el rol podría, pero no en este estado.
 */
export function resolverTransicion(state: EstadoViaje, action: AccionViaje, role: Rol): EstadoViaje {
  const reglasDelRol = TRANSICIONES.filter((r) => r.action === action && r.roles.includes(role));
  if (reglasDelRol.length === 0) {
    throw new AccionNoPermitidaError(role, action, 'el rol no tiene permitida esta acción');
  }
  const regla = reglasDelRol.find((r) => r.from.includes(state));
  if (!regla) {
    throw new TransicionInvalidaError(state, action);
  }
  return regla.to;
}
