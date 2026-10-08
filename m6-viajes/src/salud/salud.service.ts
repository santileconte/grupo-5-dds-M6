import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { CONEXION_REDIS, ConexionRedis } from '../comun/redis/conexion-redis';
import { BANDEJA_DE_SALIDA, BandejaDeSalida, PUBLICADOR_EVENTOS, PublicadorEventos } from '../viajes/aplicacion/puertos';
import { POOL_POSTGRES } from '../viajes/infraestructura/postgres/conexion';
import { PublicadorEventosRabbitMQ } from '../viajes/infraestructura/publicador-eventos.rabbitmq';

export type EstadoGeneral = 'OK' | 'DEGRADADO' | 'ERROR';

export interface EstadoComponente {
  estado: 'OK' | 'ERROR' | 'NO_CONFIGURADO';
  latenciaMs?: number;
  detalle?: string;
}

export interface InformeSalud {
  estado: EstadoGeneral;
  version: string;
  activoDesde: string;
  componentes: Record<'postgres' | 'rabbitmq' | 'redis', EstadoComponente>;
  bandejaDeSalida: { pendientes: number; antiguedadMaximaSegundos: number } | null;
}

/** Cuánto se espera a cada componente antes de considerarlo caído. */
const TIMEOUT_VERIFICACION_MS = 1500;
/** Si un evento espera más que esto para publicarse, algo anda mal con la publicación. */
const ANTIGUEDAD_MAXIMA_EVENTOS_S = 60;

const VERSION = (() => {
  try {
    return (JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')) as { version: string })
      .version;
  } catch {
    return 'desconocida';
  }
})();

/**
 * Diagnóstico del servicio y sus dependencias (RNF-14).
 *
 * - **ERROR** (HTTP 503): PostgreSQL no responde. Sin base, M6 no puede atender pedidos.
 * - **DEGRADADO** (HTTP 200): falla RabbitMQ o Redis, o hay eventos esperando hace más de un minuto.
 *   M6 sigue atendiendo: los eventos esperan en la bandeja y se procesa sin idempotencia (RNF-13).
 * - **OK**: todo responde.
 */
@Injectable()
export class SaludService {
  private readonly activoDesde = new Date().toISOString();

  constructor(
    @Inject(POOL_POSTGRES) private readonly pool: Pool | null,
    @Inject(PUBLICADOR_EVENTOS) private readonly publicador: PublicadorEventos,
    @Inject(CONEXION_REDIS) private readonly redis: ConexionRedis | null,
    @Inject(BANDEJA_DE_SALIDA) private readonly bandeja: BandejaDeSalida,
  ) {}

  async informe(): Promise<InformeSalud> {
    const [postgres, rabbitmq, redis, bandejaDeSalida] = await Promise.all([
      this.pool
        ? verificar(() => this.pool!.query('SELECT 1'))
        : noConfigurado('PERSISTENCIA=memoria'),
      this.publicador instanceof PublicadorEventosRabbitMQ
        ? verificar(() => (this.publicador as PublicadorEventosRabbitMQ).verificarConexion())
        : noConfigurado('PUBLICADOR_EVENTOS=log'),
      this.redis ? verificar(() => this.redis!.verificarConexion()) : noConfigurado('IDEMPOTENCIA=memoria'),
      this.resumenBandeja(),
    ]);

    let estado: EstadoGeneral = 'OK';
    if (rabbitmq.estado === 'ERROR' || redis.estado === 'ERROR') estado = 'DEGRADADO';
    if (bandejaDeSalida && bandejaDeSalida.antiguedadMaximaSegundos > ANTIGUEDAD_MAXIMA_EVENTOS_S) estado = 'DEGRADADO';
    if (postgres.estado === 'ERROR') estado = 'ERROR';

    return {
      estado,
      version: VERSION,
      activoDesde: this.activoDesde,
      componentes: { postgres, rabbitmq, redis },
      bandejaDeSalida,
    };
  }

  private async resumenBandeja(): Promise<InformeSalud['bandejaDeSalida']> {
    try {
      const { cantidad, masAntiguo } = await conTimeout(this.bandeja.resumenPendientes());
      return {
        pendientes: cantidad,
        antiguedadMaximaSegundos: masAntiguo ? Math.max(0, Math.round((Date.now() - masAntiguo.getTime()) / 1000)) : 0,
      };
    } catch {
      return null; // si la base no responde ya lo informa el componente postgres
    }
  }
}

async function verificar(chequeo: () => Promise<unknown>): Promise<EstadoComponente> {
  const inicio = Date.now();
  try {
    await conTimeout(chequeo());
    return { estado: 'OK', latenciaMs: Date.now() - inicio };
  } catch (error) {
    // Sin credenciales: se borra cualquier "usuario:clave@" que venga en el mensaje del error.
    const detalle = String(error instanceof Error ? error.message : error).replace(/\/\/[^@\s]*@/g, '//***@');
    return { estado: 'ERROR', latenciaMs: Date.now() - inicio, detalle: detalle.slice(0, 200) };
  }
}

function noConfigurado(detalle: string): Promise<EstadoComponente> {
  return Promise.resolve({ estado: 'NO_CONFIGURADO', detalle });
}

function conTimeout<T>(promesa: Promise<T>): Promise<T> {
  let temporizador: NodeJS.Timeout;
  const limite = new Promise<never>((_, rechazar) => {
    temporizador = setTimeout(() => rechazar(new Error(`sin respuesta en ${TIMEOUT_VERIFICACION_MS} ms`)), TIMEOUT_VERIFICACION_MS);
  });
  return Promise.race([promesa, limite]).finally(() => clearTimeout(temporizador));
}
