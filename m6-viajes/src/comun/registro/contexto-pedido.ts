import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Datos del pedido HTTP en curso, disponibles en cualquier parte del código sin pasarlos como
 * parámetro (gracias a AsyncLocalStorage). El logger los agrega a cada línea, así todos los logs
 * de un mismo pedido se pueden encontrar por su idCorrelacion, viajeId o reservaId (RNF-14).
 */
export interface ContextoPedido {
  idCorrelacion: string;
  viajeId?: string;
  reservaId?: string;
}

const almacenamiento = new AsyncLocalStorage<ContextoPedido>();

export const contextoPedido = {
  /** Ejecuta `funcion` con este contexto activo (lo usa el middleware de correlación). */
  ejecutar<T>(contexto: ContextoPedido, funcion: () => T): T {
    return almacenamiento.run(contexto, funcion);
  },
  /** Contexto del pedido actual, o undefined si no hay ninguno (por ejemplo, en el relevador). */
  actual(): ContextoPedido | undefined {
    return almacenamiento.getStore();
  },
};
