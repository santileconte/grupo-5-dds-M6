import { contextoPedido } from './contexto-pedido';
import { RegistroJson } from './registro-json';

describe('RegistroJson', () => {
  let lineas: Record<string, unknown>[];
  let registro: RegistroJson;

  beforeEach(() => {
    lineas = [];
    registro = new RegistroJson((linea) => lineas.push(JSON.parse(linea)));
  });

  it('escribe una línea JSON con nivel, contexto y mensaje', () => {
    registro.log('Servicio iniciado', 'NestApplication');
    expect(lineas[0]).toEqual({
      momento: expect.any(String),
      nivel: 'info',
      contexto: 'NestApplication',
      mensaje: 'Servicio iniciado',
    });
  });

  it('agrega el idCorrelacion y el viaje del pedido en curso', () => {
    contextoPedido.ejecutar({ idCorrelacion: 'corr-1', viajeId: 'viaje-1' }, () => registro.warn('algo', 'Prueba'));
    expect(lineas[0]).toMatchObject({ nivel: 'warn', idCorrelacion: 'corr-1', viajeId: 'viaje-1' });
  });

  it('acepta objetos con campos propios', () => {
    registro.log({ mensaje: 'POST /viajes 201', estado: 201, duracionMs: 5 }, 'Pedidos');
    expect(lineas[0]).toMatchObject({ mensaje: 'POST /viajes 201', estado: 201, duracionMs: 5, contexto: 'Pedidos' });
  });

  it('incluye el stack de los errores', () => {
    registro.error('Falló', 'Error: x\n    at algo', 'ProblemasFilter');
    expect(lineas[0]).toMatchObject({ nivel: 'error', mensaje: 'Falló', contexto: 'ProblemasFilter', stack: expect.stringContaining('at algo') });
  });
});
