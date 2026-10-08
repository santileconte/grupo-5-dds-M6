import { AlmacenIdempotenciaEnMemoria } from './almacen.memoria';

describe('AlmacenIdempotenciaEnMemoria', () => {
  const respuesta = { huella: 'h', status: 200, cuerpo: { ok: true } };

  it('sólo el primero reserva; los demás ven EN_CURSO y después COMPLETA', async () => {
    const almacen = new AlmacenIdempotenciaEnMemoria();
    await expect(almacen.reservar('k', 'h', 1000)).resolves.toEqual({ estado: 'RESERVADA' });
    await expect(almacen.reservar('k', 'h', 1000)).resolves.toEqual({ estado: 'EN_CURSO', huella: 'h' });
    await almacen.completar('k', respuesta, 1000);
    await expect(almacen.reservar('k', 'h', 1000)).resolves.toEqual({ estado: 'COMPLETA', respuesta });
  });

  it('liberar permite reservar de nuevo', async () => {
    const almacen = new AlmacenIdempotenciaEnMemoria();
    await almacen.reservar('k', 'h', 1000);
    await almacen.liberar('k');
    await expect(almacen.reservar('k', 'h', 1000)).resolves.toEqual({ estado: 'RESERVADA' });
  });

  it('las claves vencen', async () => {
    const almacen = new AlmacenIdempotenciaEnMemoria();
    await almacen.reservar('k', 'h', 1000);
    await almacen.completar('k', respuesta, 20);
    await new Promise((r) => setTimeout(r, 40));
    await expect(almacen.reservar('k', 'h', 1000)).resolves.toEqual({ estado: 'RESERVADA' });
  });
});
