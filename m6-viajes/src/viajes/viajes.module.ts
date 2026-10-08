import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CONFIGURACION_VIAJES,
  PUBLICADOR_EVENTOS,
  RELOJ,
  REPOSITORIO_VIAJES,
  VALIDADOR_CODIGO,
} from './aplicacion/puertos';
import { ViajesService } from './aplicacion/viajes.service';
import { ConfiguracionViaje } from './dominio/viaje';
import { ViajesController } from './http/viajes.controller';
import { PublicadorEventosEnLog } from './infraestructura/publicador-eventos.log';
import { RepositorioViajesEnMemoria } from './infraestructura/repositorio-viajes.memoria';
import { ValidadorCodigoM8 } from './infraestructura/validador-codigo.m8';
import { ValidadorCodigoSimulado } from './infraestructura/validador-codigo.simulado';

/**
 * Arma el módulo de viajes: acá se decide qué implementación usa cada puerto.
 * Para pasar a PostgreSQL o RabbitMQ sólo hay que cambiar el `useClass` correspondiente.
 */
@Module({
  controllers: [ViajesController],
  providers: [
    ViajesService,
    { provide: REPOSITORIO_VIAJES, useClass: RepositorioViajesEnMemoria },
    { provide: PUBLICADOR_EVENTOS, useClass: PublicadorEventosEnLog },
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
})
export class ViajesModule {}
