import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { ConflictoConcurrenciaError } from '../src/viajes/aplicacion/errores';
import { EstadoViaje, MotivoCancelacion, Rol, TipoVehiculo } from '../src/viajes/dominio/tipos';
import { Viaje } from '../src/viajes/dominio/viaje';
import { crearPoolPostgres } from '../src/viajes/infraestructura/postgres/conexion';
import { RepositorioViajesPostgres } from '../src/viajes/infraestructura/postgres/repositorio-viajes.postgres';
import { CON_POSTGRES } from './entorno';

// Tests del repositorio contra una base real. Se saltean si no se corre con `npm run test:infra`.
const describeConPostgres = CON_POSTGRES ? describe : describe.skip;

describeConPostgres('RepositorioViajesPostgres', () => {
  let pool: Pool;
  let repo: RepositorioViajesPostgres;
  const M5 = { role: Rol.SYSTEM, id: 'm5-despacho' };
  const T0 = new Date('2026-10-08T12:00:00.000Z');
  const minutos = (n: number) => new Date(T0.getTime() + n * 60_000);

  beforeAll(async () => {
    pool = await crearPoolPostgres(process.env.BASE_DATOS_URL as string);
    repo = new RepositorioViajesPostgres(pool);
    await pool.query('TRUNCATE transiciones_viaje, viajes, eventos_salientes');
  });

  afterAll(() => pool.end());

  function nuevoViaje(cambios: Partial<{ requestId: string }> = {}) {
    return Viaje.crear(
      {
        id: randomUUID(),
        requestId: cambios.requestId ?? randomUUID(),
        reservationId: null,
        clientId: randomUUID(),
        driverId: randomUUID(),
        vehicleId: randomUUID(),
        vehicleType: TipoVehiculo.MOTORCYCLE,
        originLatitude: -34.6,
        originLongitude: -58.38,
        originAddress: 'Origen 123',
        destinationLatitude: -34.58,
        destinationLongitude: -58.39,
      },
      M5,
      T0,
    );
  }

  const conductorDe = (v: Viaje) => ({ role: Rol.DRIVER, id: v.toProps().driverId });

  it('guarda y recupera el viaje completo, con su historial', async () => {
    const viaje = nuevoViaje();
    await repo.insertar(viaje, []);
    viaje.registrarArribo(conductorDe(viaje), minutos(5));
    await repo.actualizar(viaje, 1, []);
    viaje.cancelar(conductorDe(viaje), { reason: MotivoCancelacion.VEHICLE_PROBLEM, detail: 'Goma' }, minutos(6));
    await repo.actualizar(viaje, 2, []);

    const leido = await repo.buscarPorId(viaje.id);
    expect(leido?.toProps()).toEqual(viaje.toProps());
    expect(leido?.history.map((t) => t.to)).toEqual([
      EstadoViaje.PENDING_ARRIVAL,
      EstadoViaje.DRIVER_ARRIVED,
      EstadoViaje.CANCELLED,
    ]);
  });

  it('insertar es idempotente por requestId, también si el viaje ya avanzó o se canceló', async () => {
    const requestId = randomUUID();
    const primero = nuevoViaje({ requestId });
    await repo.insertar(primero, []);
    expect((await repo.insertar(nuevoViaje({ requestId }), [])).id).toBe(primero.id);

    primero.cancelar(conductorDe(primero), { reason: MotivoCancelacion.ORIGIN_UNREACHABLE }, minutos(1));
    await repo.actualizar(primero, 1, []);
    expect((await repo.insertar(nuevoViaje({ requestId }), [])).id).toBe(primero.id);
    expect((await repo.buscarPorSolicitud(requestId))?.id).toBe(primero.id);
  });

  it('rechaza guardar sobre una versión vieja (concurrencia optimista)', async () => {
    const original = nuevoViaje();
    await repo.insertar(original, []);
    const a = (await repo.buscarPorId(original.id)) as Viaje;
    const b = (await repo.buscarPorId(original.id)) as Viaje;

    a.registrarArribo(conductorDe(a), minutos(1));
    await repo.actualizar(a, 1, []);

    b.cancelar({ role: Rol.OPERATOR, id: 'op' }, { reason: MotivoCancelacion.OTHER }, minutos(1));
    await expect(repo.actualizar(b, 1, [])).rejects.toBeInstanceOf(ConflictoConcurrenciaError);
    expect((await repo.buscarPorId(original.id))?.state).toBe(EstadoViaje.DRIVER_ARRIVED);
  });

  it('la base impide modificar o borrar el historial (RF-6.8)', async () => {
    const viaje = nuevoViaje();
    await repo.insertar(viaje, []);
    await expect(
      pool.query(`UPDATE transiciones_viaje SET hacia = 'CANCELLED' WHERE viaje_id = $1`, [viaje.id]),
    ).rejects.toThrow(/no se puede modificar/);
    await expect(pool.query('DELETE FROM transiciones_viaje WHERE viaje_id = $1', [viaje.id])).rejects.toThrow(
      /no se puede modificar/,
    );
  });

  it('lista con filtros y paginación', async () => {
    const viaje = nuevoViaje();
    await repo.insertar(viaje, []);
    const { clientId } = viaje.toProps();

    const propios = await repo.listar({ clientId, page: 1, pageSize: 10 });
    expect(propios).toEqual({ items: [expect.any(Viaje)], total: 1 });
    expect(propios.items[0].id).toBe(viaje.id);

    const asignados = await repo.listar({ states: [EstadoViaje.PENDING_ARRIVAL], page: 1, pageSize: 1 });
    expect(asignados.items).toHaveLength(1);
    expect(asignados.total).toBeGreaterThan(1);
  });

  it('un id que no es UUID no rompe la consulta', async () => {
    await expect(repo.buscarPorId('no-es-uuid')).resolves.toBeNull();
    await expect(repo.listar({ clientId: 'tampoco', page: 1, pageSize: 10 })).resolves.toEqual({ items: [], total: 0 });
  });

  it('las migraciones ya aplicadas no se vuelven a aplicar', async () => {
    const { migrar } = await import('../src/viajes/infraestructura/postgres/migraciones');
    await expect(migrar(pool)).resolves.toEqual([]);
  });
});
