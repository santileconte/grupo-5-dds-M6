import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import {
  BANDEJA_DE_SALIDA,
  CONFIGURACION_VIAJES,
  PUBLICADOR_EVENTOS,
  RELOJ,
  REPOSITORIO_VIAJES,
  VALIDADOR_CODIGO,
} from './aplicacion/puertos';
import { CONFIGURACION_RELEVADOR, ConfiguracionRelevador, RelevadorDeEventos } from './aplicacion/relevador-de-eventos';
import { ViajesService } from './aplicacion/viajes.service';
import { ConfiguracionViaje } from './dominio/viaje';
import { ViajesController } from './http/viajes.controller';
import { PublicadorEventosEnLog } from './infraestructura/publicador-eventos.log';
import { PublicadorEventosRabbitMQ } from './infraestructura/publicador-eventos.rabbitmq';
import { BandejaDeSalidaPostgres } from './infraestructura/postgres/bandeja-de-salida.postgres';
import { CierrePoolPostgres, crearPoolPostgres, POOL_POSTGRES } from './infraestructura/postgres/conexion';
import { RepositorioViajesPostgres } from './infraestructura/postgres/repositorio-viajes.postgres';
import { RepositorioViajesEnMemoria } from './infraestructura/repositorio-viajes.memoria';
import { ValidadorCodigoM8 } from './infraestructura/validador-codigo.m8';
import { ValidadorCodigoSimulado } from './infraestructura/validador-codigo.simulado';

/**
 * Arma el módulo de viajes: acá se decide qué implementación usa cada puerto.
 * El repositorio se elige con PERSISTENCIA (`postgres` o `memoria`) y el destino de los eventos con
 * PUBLICADOR_EVENTOS (`rabbitmq` o `log`).
 */
@Module({
  controllers: [ViajesController],
  providers: [
    ViajesService,
    {
      provide: POOL_POSTGRES,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Promise<Pool> | null =>
        config.get('PERSISTENCIA', 'memoria') === 'postgres'
          ? crearPoolPostgres(config.getOrThrow('BASE_DATOS_URL'))
          : null,
    },
    CierrePoolPostgres,
    {
      provide: REPOSITORIO_VIAJES,
      inject: [POOL_POSTGRES],
      useFactory: (pool: Pool | null) =>
        pool ? new RepositorioViajesPostgres(pool) : new RepositorioViajesEnMemoria(),
    },
    {
      provide: BANDEJA_DE_SALIDA,
      inject: [POOL_POSTGRES, REPOSITORIO_VIAJES],
      // En memoria, el mismo repositorio guarda los eventos pendientes.
      useFactory: (pool: Pool | null, repositorio: RepositorioViajesEnMemoria) =>
        pool ? new BandejaDeSalidaPostgres(pool) : repositorio,
    },
    {
      provide: PUBLICADOR_EVENTOS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get('PUBLICADOR_EVENTOS', 'log') === 'rabbitmq'
          ? new PublicadorEventosRabbitMQ(config.getOrThrow('RABBITMQ_URL'), Number(config.get('RABBITMQ_TIMEOUT_MS', 5000)))
          : new PublicadorEventosEnLog(),
    },
    {
      provide: CONFIGURACION_RELEVADOR,
      inject: [ConfigService],
      useFactory: (config: ConfigService): ConfiguracionRelevador => ({
        intervaloMs: Number(config.get('OUTBOX_INTERVALO_MS', 1000)),
        tamanioLote: Number(config.get('OUTBOX_TAMANIO_LOTE', 50)),
      }),
    },
    RelevadorDeEventos,
    { provide: RELOJ, useValue: { ahora: () => new Date() } },
    {
      provide: CONFIGURACION_VIAJES,
      inject: [ConfigService],
      useFactory: (config: ConfigService): ConfiguracionViaje => ({
        esperaMinimaArriboMinutos: Number(config.get('ESPERA_MINIMA_ARRIBO_MINUTOS', 5)),
      }),
    },
    {
      provide: VALIDADOR_CODIGO,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get('VALIDADOR_QR', 'simulado') === 'm8'
          ? new ValidadorCodigoM8(config.getOrThrow('M8_URL'), Number(config.get('M8_TIMEOUT_MS', 2000)))
          : new ValidadorCodigoSimulado(),
    },
  ],
  // Los usa el health check detallado (salud/).
  exports: [POOL_POSTGRES, PUBLICADOR_EVENTOS, BANDEJA_DE_SALIDA],
})
export class ViajesModule {}
