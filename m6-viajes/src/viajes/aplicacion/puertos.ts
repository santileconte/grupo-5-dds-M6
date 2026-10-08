import { EstadoViaje } from '../dominio/tipos';
import { Viaje } from '../dominio/viaje';
import { SobreEvento } from './eventos';

/**
 * Puertos: interfaces que la aplicación necesita del mundo exterior.
 * Cada una tiene una implementación en `infraestructura/` que se puede reemplazar
 * (por ejemplo, el repositorio en memoria por uno de PostgreSQL) sin tocar los casos de uso.
 */

export interface FiltrosViajes {
  clienteId?: string;
  conductorId?: string;
  estados?: EstadoViaje[];
  desde?: Date;
  hasta?: Date;
  pagina: number;
  tamanio: number;
}

export interface PaginaDeViajes {
  items: Viaje[];
  total: number;
}

export interface RepositorioViajes {
  buscarPorId(id: string): Promise<Viaje | null>;
  buscarPorAsignacion(asignacionId: string): Promise<Viaje | null>;
  buscarActivoPorSolicitud(solicitudId: string): Promise<Viaje | null>;
  listar(filtros: FiltrosViajes): Promise<PaginaDeViajes>;
  /** Guarda un viaje nuevo. Si ya existe uno con la misma asignación devuelve ese, sin guardar. */
  insertar(viaje: Viaje): Promise<Viaje>;
  /**
   * Guarda los cambios sólo si la versión guardada sigue siendo `versionLeida` (RNF-08).
   * Si otro pedido lo modificó antes, lanza ConflictoConcurrenciaError.
   */
  actualizar(viaje: Viaje, versionLeida: number): Promise<void>;
}

export interface PublicadorEventos {
  publicar(evento: SobreEvento): Promise<void>;
}

export type ResultadoValidacionCodigo = 'VALIDO' | 'INVALIDO';

/** Valida y consume el código QR de un solo uso contra M8 (RF-6.4, RF-8.3). */
export interface ValidadorCodigoVerificacion {
  validarYConsumir(viajeId: string, codigo: string, idCorrelacion: string): Promise<ResultadoValidacionCodigo>;
}

export interface Reloj {
  ahora(): Date;
}

// Tokens de inyección de dependencias de NestJS (las interfaces no existen en tiempo de ejecución).
export const REPOSITORIO_VIAJES = Symbol('RepositorioViajes');
export const PUBLICADOR_EVENTOS = Symbol('PublicadorEventos');
export const VALIDADOR_CODIGO = Symbol('ValidadorCodigoVerificacion');
export const RELOJ = Symbol('Reloj');
export const CONFIGURACION_VIAJES = Symbol('ConfiguracionViaje');
