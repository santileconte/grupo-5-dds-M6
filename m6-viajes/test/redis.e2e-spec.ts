import { AlmacenIdempotenciaRedis } from '../src/comun/idempotencia/almacen.redis';
import { REDIS_URL_TESTS } from './entorno';

describe('AlmacenIdempotenciaRedis sin Redis', () => {
  it('falla rápido si Redis no está disponible (RNF-13)', async () => {
    const almacen = new AlmacenIdempotenciaRedis('redis://127.0.0.1:1', 300);
    const inicio = Date.now();
    await expect(almacen.reservar('k', 'h', 1000)).rejects.toThrow();
    expect(Date.now() - inicio).toBeLessThan(2000);
    await almacen.onApplicationShutdown();
  });
});

(REDIS_URL_TESTS ? describe : describe.skip)('AlmacenIdempotenciaRedis con Redis real', () => {
  let almacen: AlmacenIdempotenciaRedis;
  const clave = () => `m6:test:${Math.random()}`;
  const respuesta = { huella: 'h', status: 200, etag: '"2"', cuerpo: { estado: 'CANCELADO' } };

  beforeAll(() => {
    almacen = new AlmacenIdempotenciaRedis(REDIS_URL_TESTS as string);
  });

  afterAll(() => almacen.onApplicationShutdown());

  it('reserva de forma atómica aunque lleguen muchos pedidos a la vez', async () => {
    const k = clave();
    const resultados = await Promise.all(Array.from({ length: 10 }, () => almacen.reservar(k, 'h', 5000)));
    expect(resultados.filter((r) => r.estado === 'RESERVADA')).toHaveLength(1);
    expect(resultados.filter((r) => r.estado === 'EN_CURSO')).toHaveLength(9);
  });

  it('guarda la respuesta completa y la devuelve', async () => {
    const k = clave();
    await almacen.reservar(k, 'h', 5000);
    await almacen.completar(k, respuesta, 5000);
    await expect(almacen.reservar(k, 'h', 5000)).resolves.toEqual({ estado: 'COMPLETA', respuesta });
  });

  it('liberar y vencer dejan la clave disponible', async () => {
    const k = clave();
    await almacen.reservar(k, 'h', 5000);
    await almacen.liberar(k);
    await expect(almacen.reservar(k, 'h', 100)).resolves.toEqual({ estado: 'RESERVADA' });
    await new Promise((r) => setTimeout(r, 200));
    await expect(almacen.reservar(k, 'h', 5000)).resolves.toEqual({ estado: 'RESERVADA' });
  });
});
