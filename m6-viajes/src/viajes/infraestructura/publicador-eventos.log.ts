import { Injectable, Logger } from '@nestjs/common';
import { SobreEvento } from '../aplicacion/eventos';
import { PublicadorEventos } from '../aplicacion/puertos';

/**
 * Publicador provisorio: escribe los eventos en el log y los guarda en memoria.
 * En TP2 se reemplaza por uno que publique en RabbitMQ (RNF-10), con la misma interfaz.
 */
@Injectable()
export class PublicadorEventosEnLog implements PublicadorEventos {
  private readonly logger = new Logger('Eventos');
  readonly publicados: SobreEvento[] = [];

  async publicar(evento: SobreEvento): Promise<void> {
    this.publicados.push(evento);
    this.logger.log(`${evento.tipo} ${JSON.stringify(evento)}`);
  }
}
