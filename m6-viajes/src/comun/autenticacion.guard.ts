import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Rol } from '../viajes/dominio/tipos';
import { PedidoConContexto } from './contexto';
import { NoAutenticadoError } from './errores-http';
import { ES_PUBLICO } from './publico.decorator';

/** Claims que esperamos en el JWT emitido por M1 (a confirmar con el Grupo de M1). */
interface ClaimsToken {
  sub?: unknown;
  rol?: unknown;
}

const ROLES_VALIDOS = new Set<string>(Object.values(Rol));

/**
 * Verifica el `Authorization: Bearer <JWT>` y deja el actor (id y rol) en el pedido.
 * Mientras M1 no esté disponible, los tokens se firman con un secreto compartido (JWT_SECRETO);
 * ver `npm run token`.
 */
@Injectable()
export class AutenticacionGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ejecucion: ExecutionContext): Promise<boolean> {
    const esPublico = this.reflector.getAllAndOverride<boolean>(ES_PUBLICO, [
      ejecucion.getHandler(),
      ejecucion.getClass(),
    ]);
    if (esPublico) {
      return true;
    }

    const pedido = ejecucion.switchToHttp().getRequest<PedidoConContexto>();
    const [esquema, token] = (pedido.header('authorization') ?? '').split(' ');
    if (esquema !== 'Bearer' || !token) {
      throw new NoAutenticadoError('Falta el header Authorization: Bearer <token>');
    }

    let claims: ClaimsToken;
    try {
      claims = await this.jwt.verifyAsync<ClaimsToken>(token, { algorithms: ['HS256'] });
    } catch {
      throw new NoAutenticadoError('El token es inválido o venció');
    }
    if (typeof claims.sub !== 'string' || typeof claims.rol !== 'string' || !ROLES_VALIDOS.has(claims.rol)) {
      throw new NoAutenticadoError('El token no tiene los claims sub y rol esperados');
    }

    pedido.actor = { id: claims.sub, rol: claims.rol as Rol };
    return true;
  }
}
