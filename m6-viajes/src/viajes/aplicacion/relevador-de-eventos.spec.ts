import { RepositorioViajesEnMemoria } from '../infraestructura/repositorio-viajes.memoria';
import { Rol, TipoVehiculo } from '../dominio/tipos';
import { Viaje } from '../dominio/viaje';
import { eventoDeUltimaTransicion, SobreEvento } from './eventos';
import { PublicadorEventos } from './puertos';
import { RelevadorDeEventos } from './relevador-de-eventos';

/** Publicador de prueba que se puede "caer" a voluntad. */
class PublicadorDePrueba implements PublicadorEventos {
  caido = false;
  readonly recibidos: { evento: SobreEvento; routingKey: string }[] = [];
  async publicar(evento: SobreEvento, routingKey: string): Promise<void> {
    if (this.caido) throw new Error('broker caído');
    this.recibidos.push({ evento, routingKey });
  }
}

describe('RelevadorDeEventos', () => {
  let bandeja: RepositorioViajesEnMemoria;
  let publicador: PublicadorDePrueba;
  let relevador: RelevadorDeEventos;
  const conductor = { role: Rol.DRIVER, id: 'conductor-1' };

  beforeEach(() => {
    bandeja = new RepositorioViajesEnMemoria();
    publicador = new PublicadorDePrueba();
    relevador = new RelevadorDeEventos(bandeja, publicador, { intervaloMs: 0, tamanioLote: 2 });
  });

  /** Crea un viaje con arribo: genera dos eventos en la bandeja. */
  async function viajeConDosEventos(id: string) {
    const viaje = Viaje.crear(
      {
        id,
        requestId: `s-${id}`,
        clientId: 'cliente-1',
        driverId: conductor.id,
        vehicleId: 'v',
        vehicleType: TipoVehiculo.CAR,
        originLatitude: 0,
        originLongitude: 0,
        destinationLatitude: 0,
        destinationLongitude: 0,
      },
      { role: Rol.SYSTEM, id: 'm5' },
      new Date(),
    );
    await bandeja.insertar(viaje, [eventoDeUltimaTransicion(viaje, 'corr')]);
    viaje.registrarArribo(conductor, new Date());
    await bandeja.actualizar(viaje, 1, [eventoDeUltimaTransicion(viaje, 'corr')]);
  }

  it('publica todos los pendientes, en orden y con su routing key, aunque superen un lote', async () => {
    await viajeConDosEventos('v1');
    await viajeConDosEventos('v2');

    await expect(relevador.procesar()).resolves.toBe(4);
    expect(publicador.recibidos.map((r) => `${r.evento.payload.tripId}:${r.routingKey}`)).toEqual([
      'v1:trips.trip.created',
      'v1:trips.driver.arrived',
      'v2:trips.trip.created',
      'v2:trips.driver.arrived',
    ]);
    await expect(relevador.procesar()).resolves.toBe(0);
  });

  it('si el broker está caído no pierde eventos: los publica cuando vuelve', async () => {
    await viajeConDosEventos('v1');
    publicador.caido = true;
    await expect(relevador.procesar()).resolves.toBe(0);

    publicador.caido = false;
    await expect(relevador.procesar()).resolves.toBe(2);
    expect(publicador.recibidos).toHaveLength(2);
  });

  it('dos llamadas simultáneas no publican dos veces el mismo evento', async () => {
    await viajeConDosEventos('v1');
    await Promise.all([relevador.procesar(), relevador.procesar()]);
    expect(publicador.recibidos).toHaveLength(2);
  });

  it('un cambio que no se guarda (conflicto de versión) no deja eventos', async () => {
    await viajeConDosEventos('v1');
    const viejo = (await bandeja.buscarPorId('v1')) as Viaje;
    viejo.cancelar({ role: Rol.OPERATOR, id: 'op' }, { reason: 'OTHER' as never }, new Date());
    await expect(bandeja.actualizar(viejo, 1, [eventoDeUltimaTransicion(viejo, 'corr')])).rejects.toThrow();

    await relevador.procesar();
    expect(publicador.recibidos.map((r) => r.evento.eventType)).toEqual(['TripCreated', 'DriverArrived']);
  });
});
