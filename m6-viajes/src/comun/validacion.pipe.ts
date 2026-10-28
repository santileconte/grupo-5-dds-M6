import { ValidationError, ValidationPipe } from '@nestjs/common';
import { ErrorDeCampo, ValidacionError } from './errores-http';

/** Aplana los errores de class-validator (incluidos los de objetos anidados) a { campo, mensaje }. */
function aplanar(errors: ValidationError[], prefijo = ''): ErrorDeCampo[] {
  return errors.flatMap((e) => {
    const field = prefijo ? `${prefijo}.${e.property}` : e.property;
    const propios = Object.values(e.constraints ?? {}).map((message) => ({ field, message }));
    return [...propios, ...aplanar(e.children ?? [], field)];
  });
}

/** Valida cuerpos y query params contra los DTOs y rechaza campos desconocidos. */
export const crearValidacionPipe = () =>
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) => new ValidacionError(aplanar(errors)),
  });
