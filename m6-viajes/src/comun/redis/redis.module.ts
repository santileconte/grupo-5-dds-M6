import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CONEXION_REDIS, ConexionRedis } from './conexion-redis';

/**
 * Crea la conexión a Redis sólo si se configuró (IDEMPOTENCIA=redis). Si no, el valor es null y
 * la idempotencia y el límite de pedidos usan memoria.
 */
@Global()
@Module({
  providers: [
    {
      provide: CONEXION_REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService): ConexionRedis | null =>
        config.get('IDEMPOTENCIA', 'memoria') === 'redis'
          ? new ConexionRedis(config.getOrThrow('REDIS_URL'), Number(config.get('REDIS_TIMEOUT_MS', 1000)))
          : null,
    },
  ],
  exports: [CONEXION_REDIS],
})
export class RedisModule {}
