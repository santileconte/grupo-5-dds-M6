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
    ['TripState', EstadoViaje],
    ['TripAction', AccionViaje],
    ['Role', Rol],
    ['VehicleType', TipoVehiculo],
    ['CancellationReason', MotivoCancelacion],
  ])('OpenAPI: %s', (nombre, enumeracion) => {
    expect(enumOpenapi(nombre)).toEqual(valores(enumeracion));
  });

  it.each([
    ['TripState', EstadoViaje],
    ['VehicleType', TipoVehiculo],
    ['CancellationReason', MotivoCancelacion],
  ])('AsyncAPI: %s', (nombre, enumeracion) => {
    expect(enumAsyncapi(nombre)).toEqual(valores(enumeracion));
  });

  it('AsyncAPI: cancelledBy admite los roles humanos', () => {
    expect(enumAsyncapi('Role')).toEqual(valores(Rol).filter((r) => r !== Rol.SYSTEM));
  });
});

describe('los errores HTTP coinciden con el contrato', () => {
  it('cada código del filtro está en el enum Problem.code y viceversa', async () => {
    const { CODIGOS } = await import('../../comun/problemas.filter');
    const delContrato: string[] = openapi.components.schemas.Problem.properties.code.enum;
    expect(Object.keys(CODIGOS).sort()).toEqual([...delContrato].sort());
  });
});
