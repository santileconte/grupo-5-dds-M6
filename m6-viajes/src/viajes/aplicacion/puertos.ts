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
  /**
   * Guarda un viaje nuevo junto con sus eventos en la bandeja de salida, todo en una transacción.
   * Si ya existe uno con la misma asignación devuelve ese, sin guardar nada.
   */
  insertar(viaje: Viaje, eventos: SobreEvento[]): Promise<Viaje>;
  /**
   * Guarda los cambios y los eventos, en una transacción, sólo si la versión guardada sigue siendo
   * `versionLeida` (RNF-08). Si otro pedido lo modificó antes, lanza ConflictoConcurrenciaError
   * y no guarda nada.
   */
  actualizar(viaje: Viaje, versionLeida: number, eventos: SobreEvento[]): Promise<void>;
}

/**
 * Bandeja de salida (patrón "transactional outbox"): los eventos se guardan junto con el cambio del
 * viaje y el RelevadorDeEventos los publica después. Así un evento nunca se pierde aunque el broker
 * esté caído, y nunca se publica un evento de un cambio que no se guardó.
 */
export interface BandejaDeSalida {
  /**
   * Toma hasta `limite` eventos pendientes, en el orden en que se generaron, y llama a `publicar`
   * con cada uno. Los que se publican quedan marcados. Ante el primer fallo se detiene, para no
   * desordenar los eventos, y registra el error; ese evento se reintenta en la próxima vuelta.
   */
  procesarPendientes(limite: number, publicar: (evento: SobreEvento) => Promise<void>): Promise<ResultadoLote>;
}

export interface ResultadoLote {
  publicados: number;
  error?: unknown;
}

/** Envía un evento al broker. Debe fallar (lanzar) si no puede confirmar el envío. */
export interface PublicadorEventos {
  publicar(evento: SobreEvento, routingKey: string): Promise<void>;
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
export const BANDEJA_DE_SALIDA = Symbol('BandejaDeSalida');
export const VALIDADOR_CODIGO = Symbol('ValidadorCodigoVerificacion');
export const RELOJ = Symbol('Reloj');
export const CONFIGURACION_VIAJES = Symbol('ConfiguracionViaje');
