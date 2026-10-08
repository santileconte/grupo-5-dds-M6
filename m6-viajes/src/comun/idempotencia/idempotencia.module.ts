import { Global, Module } from '@nestjs/common';
import { ALMACEN_IDEMPOTENCIA } from './almacen';
import { AlmacenIdempotenciaEnMemoria } from './almacen.memoria';
import { AlmacenIdempotenciaRedis } from './almacen.redis';
import { IdempotenciaInterceptor } from './idempotencia.interceptor';
import { CONEXION_REDIS, ConexionRedis } from '../redis/conexion-redis';

/** Guarda las claves de idempotencia en Redis si está configurado (IDEMPOTENCIA=redis), si no en memoria. */
@Global()
@Module({
  providers: [
    {
      provide: ALMACEN_IDEMPOTENCIA,
      inject: [CONEXION_REDIS],
      useFactory: (redis: ConexionRedis | null) =>
        redis ? new AlmacenIdempotenciaRedis(redis) : new AlmacenIdempotenciaEnMemoria(),
    },
    IdempotenciaInterceptor,
  ],
  exports: [ALMACEN_IDEMPOTENCIA, IdempotenciaInterceptor],
})
export class IdempotenciaModule {}
