import { ValidationError, ValidationPipe } from '@nestjs/common';
import { ErrorDeCampo, ValidacionError } from './errores-http';

/** Aplana los errores de class-validator (incluidos los de objetos anidados) a { campo, mensaje }. */
function aplanar(errores: ValidationError[], prefijo = ''): ErrorDeCampo[] {
  return errores.flatMap((e) => {
    const campo = prefijo ? `${prefijo}.${e.property}` : e.property;
    const propios = Object.values(e.constraints ?? {}).map((mensaje) => ({ campo, mensaje }));
    return [...propios, ...aplanar(e.children ?? [], campo)];
  });
}

/** Valida cuerpos y query params contra los DTOs y rechaza campos desconocidos. */
export const crearValidacionPipe = () =>
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errores) => new ValidacionError(aplanar(errores)),
  });
