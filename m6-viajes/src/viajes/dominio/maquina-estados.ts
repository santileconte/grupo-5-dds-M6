import { AccionNoPermitidaError, TransicionInvalidaError } from './errores';
import { AccionViaje, EstadoViaje, MotivoCancelacion, Rol } from './tipos';

/**
 * Tabla de transiciones del viaje (RF-6.1).
 * Es la única fuente de verdad sobre qué acción puede ejecutar cada rol en cada estado.
 * Ver docs/m6/maquina-de-estados.md.
 */
interface ReglaTransicion {
  accion: AccionViaje;
  desde: readonly EstadoViaje[];
  hacia: EstadoViaje;
  roles: readonly Rol[];
}

export const TRANSICIONES: readonly ReglaTransicion[] = [
  {
    accion: AccionViaje.REGISTRAR_ARRIBO,
    desde: [EstadoViaje.ASIGNADO],
    hacia: EstadoViaje.CONDUCTOR_ARRIBADO,
    roles: [Rol.CONDUCTOR],
  },
  {
    accion: AccionViaje.INICIAR,
    desde: [EstadoViaje.CONDUCTOR_ARRIBADO],
    hacia: EstadoViaje.EN_CURSO,
    roles: [Rol.CONDUCTOR],
  },
  {
    accion: AccionViaje.FINALIZAR,
    desde: [EstadoViaje.EN_CURSO],
    hacia: EstadoViaje.FINALIZADO,
    roles: [Rol.CONDUCTOR],
  },
  {
    accion: AccionViaje.CANCELAR,
    desde: [EstadoViaje.ASIGNADO, EstadoViaje.CONDUCTOR_ARRIBADO],
    hacia: EstadoViaje.CANCELADO,
    roles: [Rol.CLIENTE, Rol.CONDUCTOR],
  },
  {
    accion: AccionViaje.CANCELAR,
    desde: [EstadoViaje.ASIGNADO, EstadoViaje.CONDUCTOR_ARRIBADO, EstadoViaje.EN_CURSO],
    hacia: EstadoViaje.CANCELADO,
    roles: [Rol.OPERADOR],
  },
];

/** Motivos de cancelación que puede usar cada rol (regla R6-03). */
export const MOTIVOS_POR_ROL: Readonly<Partial<Record<Rol, readonly MotivoCancelacion[]>>> = {
  [Rol.CLIENTE]: [
    MotivoCancelacion.CAMBIO_DE_PLANES,
    MotivoCancelacion.DEMORA_EXCESIVA,
    MotivoCancelacion.CONDUCTOR_NO_SE_PRESENTO,
    MotivoCancelacion.OTRO,
  ],
  [Rol.CONDUCTOR]: [
    MotivoCancelacion.CLIENTE_NO_SE_PRESENTO,
    MotivoCancelacion.PROBLEMA_CON_VEHICULO,
    MotivoCancelacion.ORIGEN_INACCESIBLE,
    MotivoCancelacion.OTRO,
  ],
  [Rol.OPERADOR]: [
    MotivoCancelacion.INCIDENTE_DE_SEGURIDAD,
    MotivoCancelacion.BLOQUEO_ADMINISTRATIVO,
    MotivoCancelacion.OTRO,
  ],
};

/**
 * Devuelve el estado destino de ejecutar `accion` desde `estado` con el rol dado.
 * Lanza AccionNoPermitidaError si el rol nunca puede ejecutar esa acción y
 * TransicionInvalidaError si el rol podría, pero no en este estado.
 */
export function resolverTransicion(estado: EstadoViaje, accion: AccionViaje, rol: Rol): EstadoViaje {
  const reglasDelRol = TRANSICIONES.filter((r) => r.accion === accion && r.roles.includes(rol));
  if (reglasDelRol.length === 0) {
    throw new AccionNoPermitidaError(rol, accion, 'el rol no tiene permitida esta acción');
  }
  const regla = reglasDelRol.find((r) => r.desde.includes(estado));
  if (!regla) {
    throw new TransicionInvalidaError(estado, accion);
  }
  return regla.hacia;
}
