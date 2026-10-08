import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { routingKeyDe } from './eventos';
import { BANDEJA_DE_SALIDA, BandejaDeSalida, PUBLICADOR_EVENTOS, PublicadorEventos } from './puertos';

export interface ConfiguracionRelevador {
  /** Cada cuántos milisegundos revisar la bandeja de salida. 0 desactiva la revisión automática. */
  intervaloMs: number;
  /** Cuántos eventos tomar por vuelta. */
  tamanioLote: number;
}

export const CONFIGURACION_RELEVADOR = Symbol('ConfiguracionRelevador');

/**
 * Publica en el broker los eventos guardados en la bandeja de salida (patrón outbox).
 *
 * - Si el broker está caído, el evento queda pendiente y se reintenta en la próxima vuelta:
 *   el viaje sigue funcionando y no se pierde ningún evento (RNF-13).
 * - Un evento puede publicarse más de una vez (por ejemplo, si el servicio se cae justo después de
 *   publicar y antes de marcarlo). Por eso los consumidores descartan duplicados por `idEvento` (RNF-09).
 */
@Injectable()
export class RelevadorDeEventos implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('RelevadorDeEventos');
  private temporizador?: NodeJS.Timeout;
  private enCurso?: Promise<number>;
  private fallando = false;

  constructor(
    @Inject(BANDEJA_DE_SALIDA) private readonly bandeja: BandejaDeSalida,
    @Inject(PUBLICADOR_EVENTOS) private readonly publicador: PublicadorEventos,
    @Inject(CONFIGURACION_RELEVADOR) private readonly config: ConfiguracionRelevador,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.intervaloMs > 0) {
      this.temporizador = setInterval(() => void this.procesar(), this.config.intervaloMs);
    }
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.temporizador);
    await this.enCurso; // esperar a que termine la vuelta actual antes de cerrar conexiones
  }

  /**
   * Publica todos los eventos pendientes que pueda y devuelve cuántos publicó.
   * Si ya hay una vuelta en curso, espera esa en lugar de empezar otra.
   */
  procesar(): Promise<number> {
    this.enCurso ??= this.vaciarBandeja().finally(() => (this.enCurso = undefined));
    return this.enCurso;
  }

  private async vaciarBandeja(): Promise<number> {
    let total = 0;
    for (;;) {
      let resultado;
      try {
        resultado = await this.bandeja.procesarPendientes(this.config.tamanioLote, (evento) =>
          this.publicador.publicar(evento, routingKeyDe(evento)),
        );
      } catch (error) {
        resultado = { publicados: 0, error };
      }
      total += resultado.publicados;

      if (resultado.error) {
        // Se avisa una sola vez por racha de fallos para no llenar el log cada segundo.
        if (!this.fallando) {
          this.logger.warn(`No se pudieron publicar eventos; se reintentará: ${String(resultado.error)}`);
          this.fallando = true;
        }
        return total;
      }
      if (this.fallando) {
        this.logger.log('Publicación de eventos restablecida');
        this.fallando = false;
      }
      if (resultado.publicados < this.config.tamanioLote) {
        return total; // no quedan más pendientes
      }
    }
  }
}
