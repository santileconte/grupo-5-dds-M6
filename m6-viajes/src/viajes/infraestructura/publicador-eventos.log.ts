import { Injectable, Logger } from '@nestjs/common';
import { SobreEvento } from '../aplicacion/eventos';
import { PublicadorEventos } from '../aplicacion/puertos';

/**
 * Publicador para desarrollo sin broker (PUBLICADOR_EVENTOS=log): escribe cada evento en el log
 * y lo guarda en memoria (los tests lo usan para ver qué se publicó).
 */
@Injectable()
export class PublicadorEventosEnLog implements PublicadorEventos {
  private readonly logger = new Logger('Eventos');
  readonly publicados: SobreEvento[] = [];

  async publicar(evento: SobreEvento, routingKey: string): Promise<void> {
    this.publicados.push(evento);
    // Con LOG_FORMATO=json, cada campo queda separado y se puede filtrar (por ejemplo por viajeId).
    this.logger.log({
      mensaje: `Evento ${evento.tipo} (${routingKey})`,
      idCorrelacion: evento.idCorrelacion,
      viajeId: evento.datos.viajeId,
      idEvento: evento.idEvento,
      evento,
    });
  }
}
