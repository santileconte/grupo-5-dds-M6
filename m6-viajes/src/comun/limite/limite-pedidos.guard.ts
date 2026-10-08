import { CanActivate, ExecutionContext, Inject, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Response } from 'express';
import { Rol } from '../../viajes/dominio/tipos';
import { PedidoConContexto } from '../contexto';
import { DemasiadosPedidosError } from '../errores-http';
import { ES_PUBLICO } from '../publico.decorator';
import { CONTADOR_PEDIDOS, ContadorPedidos } from './contador';

export interface ConfiguracionLimite {
  /** Pedidos por minuto para clientes, conductores y operadores. 0 = sin límite. */
  porMinuto: number;
  /** Pedidos por minuto para otros módulos (rol SERVICIO), que hacen muchos más pedidos. 0 = sin límite. */
  porMinutoServicio: number;
}

export const CONFIGURACION_LIMITE = Symbol('ConfiguracionLimite');

const VENTANA_MS = 60_000;

/**
 * Limita la cantidad de pedidos por usuario y por minuto (RNF-12): frena abusos, scripts
 * descontrolados y ataques de fuerza bruta. Corre después de la autenticación, así el límite es
 * por usuario (no por IP, que podría ser compartida).
 *
 * Informa el estado en los headers `RateLimit-Limit`, `RateLimit-Remaining` y `RateLimit-Reset`.
 * Al superarlo responde `429 DEMASIADOS_PEDIDOS` con `Retry-After`. Si el contador (Redis) no
 * responde, deja pasar el pedido y avisa en el log (RNF-13).
 */
@Injectable()
export class LimitePedidosGuard implements CanActivate {
  private readonly logger = new Logger('LimitePedidos');

  constructor(
    @Inject(CONTADOR_PEDIDOS) private readonly contador: ContadorPedidos,
    @Inject(CONFIGURACION_LIMITE) private readonly config: ConfiguracionLimite,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ejecucion: ExecutionContext): Promise<boolean> {
    const esPublico = this.reflector.getAllAndOverride<boolean>(ES_PUBLICO, [ejecucion.getHandler(), ejecucion.getClass()]);
    const pedido = ejecucion.switchToHttp().getRequest<PedidoConContexto>();
    if (esPublico || !pedido.actor) return true;

    const limite = pedido.actor.rol === Rol.SERVICIO ? this.config.porMinutoServicio : this.config.porMinuto;
    if (limite <= 0) return true;

    let conteo;
    try {
      conteo = await this.contador.incrementar(`m6:limite:${pedido.actor.id}`, VENTANA_MS);
    } catch (error) {
      this.logger.warn(`No se pudo contar el pedido; se deja pasar: ${String(error)}`);
      return true;
    }

    const reiniciaEnSegundos = Math.ceil(conteo.reiniciaEnMs / 1000);
    const respuesta = ejecucion.switchToHttp().getResponse<Response>();
    respuesta.setHeader('RateLimit-Limit', String(limite));
    respuesta.setHeader('RateLimit-Remaining', String(Math.max(0, limite - conteo.cantidad)));
    respuesta.setHeader('RateLimit-Reset', String(reiniciaEnSegundos));

    if (conteo.cantidad > limite) {
      throw new DemasiadosPedidosError(reiniciaEnSegundos);
    }
    return true;
  }
}
