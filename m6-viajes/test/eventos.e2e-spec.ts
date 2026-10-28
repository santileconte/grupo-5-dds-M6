import { randomUUID } from 'node:crypto';
import { connect } from 'amqplib';
import { Pool } from 'pg';
import { eventoDeUltimaTransicion, SobreEvento } from '../src/viajes/aplicacion/eventos';
import { Rol, TipoVehiculo } from '../src/viajes/dominio/tipos';
import { Viaje } from '../src/viajes/dominio/viaje';
import { BandejaDeSalidaPostgres } from '../src/viajes/infraestructura/postgres/bandeja-de-salida.postgres';
import { crearPoolPostgres } from '../src/viajes/infraestructura/postgres/conexion';
import { RepositorioViajesPostgres } from '../src/viajes/infraestructura/postgres/repositorio-viajes.postgres';
import {
  EXCHANGE_EVENTOS,
  PublicadorEventosRabbitMQ,
} from '../src/viajes/infraestructura/publicador-eventos.rabbitmq';
import { CON_POSTGRES } from './entorno';

const RABBITMQ_URL = process.env.TEST_RABBITMQ_URL;

function nuevoViaje() {
  return Viaje.crear(
    {
      id: randomUUID(),
      requestId: randomUUID(),
      clientId: randomUUID(),
      driverId: randomUUID(),
      vehicleId: randomUUID(),
      vehicleType: TipoVehiculo.CAR,
      originLatitude: -34.6,
      originLongitude: -58.38,
      destinationLatitude: -34.58,
      destinationLongitude: -58.39,
    },
    { role: Rol.SYSTEM, id: 'm5-despacho' },
    new Date(),
  );
}

describe('PublicadorEventosRabbitMQ sin broker', () => {
  it('falla rápido y con un error claro si RabbitMQ no está disponible (RNF-13)', async () => {
    const publicador = new PublicadorEventosRabbitMQ('amqp://guest:guest@127.0.0.1:1', 1000);
    const evento = eventoDeUltimaTransicion(nuevoViaje(), 'corr');
    const inicio = Date.now();
    await expect(publicador.publicar(evento, 'viajes.viaje.creado')).rejects.toThrow();
    expect(Date.now() - inicio).toBeLessThan(3000);
  });
});

(RABBITMQ_URL ? describe : describe.skip)('PublicadorEventosRabbitMQ con broker real', () => {
  it('publica en el exchange movilidad.eventos con la routing key y las propiedades del mensaje', async () => {
    const publicador = new PublicadorEventosRabbitMQ(RABBITMQ_URL as string);
    const conexion = await connect(RABBITMQ_URL as string);
    try {
      const canal = await conexion.createChannel();
      await canal.assertExchange(EXCHANGE_EVENTOS, 'topic', { durable: true });
      // Cola temporal que escucha todos los eventos de viajes, como haría otro módulo.
      const { queue } = await canal.assertQueue('', { exclusive: true });
      await canal.bindQueue(queue, EXCHANGE_EVENTOS, 'viajes.#');

      const evento = eventoDeUltimaTransicion(nuevoViaje(), 'corr-rabbit');
      await publicador.publicar(evento, 'viajes.viaje.creado');

      const message = await esperarMensaje(canal, queue);
      expect(message.fields.routingKey).toBe('viajes.viaje.creado');
      expect(message.properties).toMatchObject({
        messageId: evento.eventId,
        correlationId: 'corr-rabbit',
        type: 'TripCreated',
        contentType: 'application/json',
        deliveryMode: 2,
      });
      expect(JSON.parse(message.content.toString()) as SobreEvento).toEqual(evento);
    } finally {
      await publicador.onApplicationShutdown();
      await conexion.close();
    }
  });
});

(CON_POSTGRES ? describe : describe.skip)('Bandeja de salida en PostgreSQL', () => {
  let pool: Pool;
  let repo: RepositorioViajesPostgres;
  let bandeja: BandejaDeSalidaPostgres;

  beforeAll(async () => {
    pool = await crearPoolPostgres(process.env.BASE_DATOS_URL as string);
    repo = new RepositorioViajesPostgres(pool);
    bandeja = new BandejaDeSalidaPostgres(pool);
  });

  beforeEach(() => pool.query('TRUNCATE transiciones_viaje, viajes, eventos_salientes'));
  afterAll(() => pool.end());

  const pendientes = async () =>
    (await pool.query('SELECT tipo, intentos FROM eventos_salientes WHERE publicado_en IS NULL ORDER BY sequence')).rows;

  it('guarda el evento en la misma transacción que el viaje', async () => {
    const viaje = nuevoViaje();
    await repo.insertar(viaje, [eventoDeUltimaTransicion(viaje, 'c')]);
    expect(await pendientes()).toEqual([{ eventType: 'TripCreated', intentos: 0 }]);
  });

  it('si el cambio no se guarda por conflicto de versión, el evento tampoco', async () => {
    const viaje = nuevoViaje();
    await repo.insertar(viaje, [eventoDeUltimaTransicion(viaje, 'c')]);
    viaje.cancelar({ role: Rol.OPERATOR, id: 'op' }, { reason: 'OTHER' as never }, new Date());
    await expect(repo.actualizar(viaje, 99, [eventoDeUltimaTransicion(viaje, 'c')])).rejects.toThrow();
    expect(await pendientes()).toHaveLength(1);
  });

  it('publica en orden, se detiene ante un fallo y lo reintenta después', async () => {
    const viaje = nuevoViaje();
    await repo.insertar(viaje, [eventoDeUltimaTransicion(viaje, 'c')]);
    viaje.registrarArribo({ role: Rol.DRIVER, id: viaje.toProps().driverId }, new Date());
    await repo.actualizar(viaje, 1, [eventoDeUltimaTransicion(viaje, 'c')]);

    const fallido = await bandeja.procesarPendientes(10, async () => {
      throw new Error('broker caído');
    });
    expect(fallido.publicados).toBe(0);
    expect(await pendientes()).toEqual([
      { eventType: 'TripCreated', intentos: 1 },
      { eventType: 'DriverArrived', intentos: 0 },
    ]);

    const publicados: string[] = [];
    const exitoso = await bandeja.procesarPendientes(10, async (e) => {
      publicados.push(e.eventType);
    });
    expect(exitoso).toEqual({ publicados: 2 });
    expect(publicados).toEqual(['TripCreated', 'DriverArrived']);
    expect(await pendientes()).toEqual([]);
  });

  it('dos relevadores a la vez no toman el mismo evento (SKIP LOCKED)', async () => {
    for (let i = 0; i < 4; i++) {
      const viaje = nuevoViaje();
      await repo.insertar(viaje, [eventoDeUltimaTransicion(viaje, 'c')]);
    }
    const vistos: string[] = [];
    const lento = async (e: SobreEvento) => {
      vistos.push(e.eventId);
      await new Promise((r) => setTimeout(r, 30));
    };
    await Promise.all([bandeja.procesarPendientes(2, lento), bandeja.procesarPendientes(2, lento)]);
    expect(new Set(vistos).size).toBe(vistos.length);
    expect(vistos).toHaveLength(4);
  });
});

function esperarMensaje(canal: import('amqplib').Channel, cola: string) {
  return new Promise<import('amqplib').ConsumeMessage>((resolver, rechazar) => {
    const limite = setTimeout(() => rechazar(new Error('No llegó el mensaje')), 5000);
    void canal.consume(cola, (message) => {
      if (message) {
        clearTimeout(limite);
        resolver(message);
      }
    });
  });
}
