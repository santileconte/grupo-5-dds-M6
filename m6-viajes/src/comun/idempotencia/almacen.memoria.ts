import { AlmacenIdempotencia, EstadoClave, RespuestaGuardada } from './almacen';

type Entrada =
  | { estado: 'EN_CURSO'; huella: string; vence: number }
  | { estado: 'COMPLETA'; respuesta: RespuestaGuardada; vence: number };

/** Almacén en memoria (IDEMPOTENCIA=memoria). Sirve con una sola instancia; se pierde al reiniciar. */
export class AlmacenIdempotenciaEnMemoria implements AlmacenIdempotencia {
  private readonly entradas = new Map<string, Entrada>();

  async reservar(clave: string, huella: string, vigenciaMs: number): Promise<EstadoClave> {
    const ahora = Date.now();
    const entrada = this.entradas.get(clave);
    if (entrada && entrada.vence > ahora) {
      return entrada.estado === 'COMPLETA'
        ? { estado: 'COMPLETA', respuesta: entrada.respuesta }
        : { estado: 'EN_CURSO', huella: entrada.huella };
    }
    this.limpiarVencidas(ahora);
    this.entradas.set(clave, { estado: 'EN_CURSO', huella, vence: ahora + vigenciaMs });
    return { estado: 'RESERVADA' };
  }

  async completar(clave: string, respuesta: RespuestaGuardada, vigenciaMs: number): Promise<void> {
    this.entradas.set(clave, { estado: 'COMPLETA', respuesta, vence: Date.now() + vigenciaMs });
  }

  async liberar(clave: string): Promise<void> {
    this.entradas.delete(clave);
  }

  private limpiarVencidas(ahora: number): void {
    for (const [clave, entrada] of this.entradas) {
      if (entrada.vence <= ahora) this.entradas.delete(clave);
    }
  }
}
