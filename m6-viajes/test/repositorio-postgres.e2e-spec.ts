import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { ConflictoConcurrenciaError, ViajeActivoExistenteError } from '../src/viajes/aplicacion/errores';
import { EstadoViaje, MotivoCancelacion, Rol, TipoVehiculo } from '../src/viajes/dominio/tipos';
import { Viaje } from '../src/viajes/dominio/viaje';
import { crearPoolPostgres } from '../src/viajes/infraestructura/postgres/conexion';
import { RepositorioViajesPostgres } from '../src/viajes/infraestructura/postgres/repositorio-viajes.postgres';
import { CON_POSTGRES } from './entorno';

// Tests del repositorio contra una base real. Se saltean si no se corre con `npm run test:postgres`.
const describeConPostgres = CON_POSTGRES ? describe : describe.skip;

describeConPostgres('RepositorioViajesPostgres', () => {
  let pool: Pool;
  let repo: RepositorioViajesPostgres;
  const M5 = { rol: Rol.SERVICIO, id: 'm5-despacho' };
  const T0 = new Date('2026-10-08T12:00:00.000Z');
  const minutos = (n: number) => new Date(T0.getTime() + n * 60_000);

  beforeAll(async () => {
    pool = await crearPoolPostgres(process.env.BASE_DATOS_URL as string);
    repo = new RepositorioViajesPostgres(pool);
    await pool.query('TRUNCATE transiciones_viaje, viajes');
  });

  afterAll(() => pool.end());

  function nuevoViaje(cambios: Partial<{ solicitudId: string; asignacionId: string }> = {}) {
    return Viaje.crear(
      {
        id: randomUUID(),
        solicitudId: cambios.solicitudId ?? randomUUID(),
        asignacionId: cambios.asignacionId ?? randomUUID(),
        reservaId: null,
        clienteId: randomUUID(),
        conductorId: randomUUID(),
        vehiculoId: randomUUID(),
        tipoVehiculo: TipoVehiculo.MOTO,
        origen: { latitud: -34.6, longitud: -58.38, direccion: 'Origen 123' },
        destino: { latitud: -34.58, longitud: -58.39 },
      },
      M5,
      T0,
    );
  }

  const conductorDe = (v: Viaje) => ({ rol: Rol.CONDUCTOR, id: v.toProps().conductorId });

  it('guarda y recupera el viaje completo, con su historial', async () => {
    const viaje = nuevoViaje();
    await repo.insertar(viaje);
    viaje.registrarArribo(conductorDe(viaje), minutos(5));
    await repo.actualizar(viaje, 1);
    viaje.cancelar(conductorDe(viaje), { motivo: MotivoCancelacion.PROBLEMA_CON_VEHICULO, detalle: 'Goma' }, minutos(6));
    await repo.actualizar(viaje, 2);

    const leido = await repo.buscarPorId(viaje.id);
    expect(leido?.toProps()).toEqual(viaje.toProps());
    expect(leido?.historial.map((t) => t.hacia)).toEqual([
      EstadoViaje.ASIGNADO,
      EstadoViaje.CONDUCTOR_ARRIBADO,
      EstadoViaje.CANCELADO,
    ]);
  });

  it('insertar es idempotente por asignación', async () => {
    const asignacionId = randomUUID();
    const primero = nuevoViaje({ asignacionId });
    await repo.insertar(primero);
    const repetido = await repo.insertar(nuevoViaje({ asignacionId }));
    expect(repetido.id).toBe(primero.id);
  });

  it('no permite dos viajes activos para la misma solicitud, pero sí uno nuevo tras cancelar', async () => {
    const solicitudId = randomUUID();
    const primero = nuevoViaje({ solicitudId });
    await repo.insertar(primero);
    await expect(repo.insertar(nuevoViaje({ solicitudId }))).rejects.toBeInstanceOf(ViajeActivoExistenteError);

    primero.cancelar(conductorDe(primero), { motivo: MotivoCancelacion.ORIGEN_INACCESIBLE }, minutos(1));
    await repo.actualizar(primero, 1);
    await expect(repo.insertar(nuevoViaje({ solicitudId }))).resolves.toBeDefined();
  });

  it('rechaza guardar sobre una versión vieja (concurrencia optimista)', async () => {
    const original = nuevoViaje();
    await repo.insertar(original);
    const a = (await repo.buscarPorId(original.id)) as Viaje;
    const b = (await repo.buscarPorId(original.id)) as Viaje;

    a.registrarArribo(conductorDe(a), minutos(1));
    await repo.actualizar(a, 1);

    b.cancelar({ rol: Rol.OPERADOR, id: 'op' }, { motivo: MotivoCancelacion.OTRO }, minutos(1));
    await expect(repo.actualizar(b, 1)).rejects.toBeInstanceOf(ConflictoConcurrenciaError);
    expect((await repo.buscarPorId(original.id))?.estado).toBe(EstadoViaje.CONDUCTOR_ARRIBADO);
  });

  it('la base impide modificar o borrar el historial (RF-6.8)', async () => {
    const viaje = nuevoViaje();
    await repo.insertar(viaje);
    await expect(
      pool.query(`UPDATE transiciones_viaje SET hacia = 'CANCELADO' WHERE viaje_id = $1`, [viaje.id]),
    ).rejects.toThrow(/no se puede modificar/);
    await expect(pool.query('DELETE FROM transiciones_viaje WHERE viaje_id = $1', [viaje.id])).rejects.toThrow(
      /no se puede modificar/,
    );
  });

  it('lista con filtros y paginación', async () => {
    const viaje = nuevoViaje();
    await repo.insertar(viaje);
    const { clienteId } = viaje.toProps();

    const propios = await repo.listar({ clienteId, pagina: 1, tamanio: 10 });
    expect(propios).toEqual({ items: [expect.any(Viaje)], total: 1 });
    expect(propios.items[0].id).toBe(viaje.id);

    const asignados = await repo.listar({ estados: [EstadoViaje.ASIGNADO], pagina: 1, tamanio: 1 });
    expect(asignados.items).toHaveLength(1);
    expect(asignados.total).toBeGreaterThan(1);
  });

  it('un id que no es UUID no rompe la consulta', async () => {
    await expect(repo.buscarPorId('no-es-uuid')).resolves.toBeNull();
    await expect(repo.listar({ clienteId: 'tampoco', pagina: 1, tamanio: 10 })).resolves.toEqual({ items: [], total: 0 });
  });

  it('las migraciones ya aplicadas no se vuelven a aplicar', async () => {
    const { migrar } = await import('../src/viajes/infraestructura/postgres/migraciones');
    await expect(migrar(pool)).resolves.toEqual([]);
  });
});
