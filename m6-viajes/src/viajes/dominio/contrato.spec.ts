import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { AccionViaje, EstadoViaje, MotivoCancelacion, Rol, TipoVehiculo } from './tipos';

// Si alguien cambia un enum en el código o en el contrato, este test avisa que hay que cambiar el otro.
const CONTRATOS = join(__dirname, '../../../../contratos');
const openapi = parse(readFileSync(join(CONTRATOS, 'm6-viajes.openapi.yaml'), 'utf8'));
const asyncapi = parse(readFileSync(join(CONTRATOS, 'eventos/m6-viajes.asyncapi.yaml'), 'utf8'));

const enumOpenapi = (nombre: string): string[] => openapi.components.schemas[nombre].enum;
const enumAsyncapi = (nombre: string): string[] => asyncapi.components.schemas[nombre].enum;
const valores = (e: object): string[] => Object.values(e);

describe('el dominio coincide con los contratos', () => {
  it.each([
    ['EstadoViaje', EstadoViaje],
    ['AccionViaje', AccionViaje],
    ['Rol', Rol],
    ['TipoVehiculo', TipoVehiculo],
    ['MotivoCancelacion', MotivoCancelacion],
  ])('OpenAPI: %s', (nombre, enumeracion) => {
    expect(enumOpenapi(nombre)).toEqual(valores(enumeracion));
  });

  it.each([
    ['EstadoViaje', EstadoViaje],
    ['TipoVehiculo', TipoVehiculo],
    ['MotivoCancelacion', MotivoCancelacion],
  ])('AsyncAPI: %s', (nombre, enumeracion) => {
    expect(enumAsyncapi(nombre)).toEqual(valores(enumeracion));
  });

  it('AsyncAPI: canceladoPor admite los roles humanos', () => {
    expect(enumAsyncapi('Rol')).toEqual(valores(Rol).filter((r) => r !== Rol.SERVICIO));
  });
});
