import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ALMACEN_IDEMPOTENCIA } from './almacen';
import { AlmacenIdempotenciaEnMemoria } from './almacen.memoria';
import { AlmacenIdempotenciaRedis } from './almacen.redis';
import { IdempotenciaInterceptor } from './idempotencia.interceptor';

/** Elige dónde se guardan las claves de idempotencia: IDEMPOTENCIA=redis o memoria. */
@Global()
@Module({
  providers: [
    {
      provide: ALMACEN_IDEMPOTENCIA,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.get('IDEMPOTENCIA', 'memoria') === 'redis'
          ? new AlmacenIdempotenciaRedis(config.getOrThrow('REDIS_URL'), Number(config.get('REDIS_TIMEOUT_MS', 1000)))
          : new AlmacenIdempotenciaEnMemoria(),
    },
    IdempotenciaInterceptor,
  ],
  exports: [ALMACEN_IDEMPOTENCIA, IdempotenciaInterceptor],
})
export class IdempotenciaModule {}
