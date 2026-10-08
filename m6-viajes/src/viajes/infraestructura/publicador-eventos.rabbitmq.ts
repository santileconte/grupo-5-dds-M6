import { Logger, OnApplicationShutdown } from '@nestjs/common';
import { ChannelModel, ConfirmChannel, connect } from 'amqplib';
import { SobreEvento } from '../aplicacion/eventos';
import { PublicadorEventos } from '../aplicacion/puertos';

export const EXCHANGE_EVENTOS = 'movilidad.eventos';

/**
 * Publica los eventos en RabbitMQ (RNF-10), en el exchange `movilidad.eventos` de tipo topic.
 *
 * - Usa un "canal con confirmaciones": `publicar` termina recién cuando RabbitMQ confirma que
 *   recibió el mensaje. Si no confirma, falla, y el evento queda pendiente en la bandeja de salida.
 * - Los mensajes son persistentes: sobreviven a un reinicio del broker si la cola es durable.
 * - Si la conexión se cae, se reconecta sola en el próximo intento.
 * - Con timeout: nunca se queda esperando indefinidamente (RNF-13).
 */
export class PublicadorEventosRabbitMQ implements PublicadorEventos, OnApplicationShutdown {
  private readonly logger = new Logger('RabbitMQ');
  private conexion?: ChannelModel;
  private canal?: ConfirmChannel;
  private conectando?: Promise<ConfirmChannel>;

  constructor(
    private readonly url: string,
    private readonly timeoutMs = 5000,
  ) {}

  async publicar(evento: SobreEvento, routingKey: string): Promise<void> {
    const canal = await this.obtenerCanal();
    const contenido = Buffer.from(JSON.stringify(evento));
    const confirmado = new Promise<void>((resolver, rechazar) => {
      canal.publish(
        EXCHANGE_EVENTOS,
        routingKey,
        contenido,
        {
          persistent: true,
          contentType: 'application/json',
          messageId: evento.idEvento,
          correlationId: evento.idCorrelacion,
          type: evento.tipo,
          appId: evento.productor,
          timestamp: Math.floor(Date.parse(evento.ocurridoEn) / 1000),
        },
        (error) => (error ? rechazar(error) : resolver()),
      );
    });
    await conTimeout(confirmado, this.timeoutMs, 'RabbitMQ no confirmó la publicación a tiempo');
  }

  /** Para /salud/detalle: conecta si hace falta y falla si RabbitMQ no responde a tiempo. */
  async verificarConexion(): Promise<void> {
    await this.obtenerCanal();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.conexion?.close().catch(() => undefined);
  }

  private obtenerCanal(): Promise<ConfirmChannel> {
    if (this.canal) return Promise.resolve(this.canal);
    this.conectando ??= this.conectar().finally(() => (this.conectando = undefined));
    return this.conectando;
  }

  private async conectar(): Promise<ConfirmChannel> {
    const conexion = await conTimeout(
      connect(this.url, { timeout: this.timeoutMs }),
      this.timeoutMs,
      'No se pudo conectar a RabbitMQ a tiempo',
    );
    const olvidar = () => {
      this.canal = undefined;
      this.conexion = undefined;
    };
    // Sin estos manejadores, un error de conexión tiraría abajo todo el proceso.
    conexion.on('error', (error) => this.logger.warn(`Error de conexión: ${String(error)}`));
    conexion.on('close', olvidar);

    const canal = await conexion.createConfirmChannel();
    canal.on('error', (error) => this.logger.warn(`Error del canal: ${String(error)}`));
    canal.on('close', olvidar);
    await canal.assertExchange(EXCHANGE_EVENTOS, 'topic', { durable: true });

    this.conexion = conexion;
    this.canal = canal;
    this.logger.log(`Conectado; publicando en el exchange ${EXCHANGE_EVENTOS}`);
    return canal;
  }
}

function conTimeout<T>(promesa: Promise<T>, ms: number, mensaje: string): Promise<T> {
  let temporizador: NodeJS.Timeout;
  const limite = new Promise<never>((_, rechazar) => {
    temporizador = setTimeout(() => rechazar(new Error(mensaje)), ms);
  });
  return Promise.race([promesa, limite]).finally(() => clearTimeout(temporizador));
}
