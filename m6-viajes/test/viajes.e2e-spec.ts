import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DependenciaNoDisponibleError } from '../src/viajes/aplicacion/errores';
import { ResultadoValidacionCodigo, ValidadorCodigoVerificacion } from '../src/viajes/aplicacion/puertos';
import { RegistroJson } from '../src/comun/registro/registro-json';
import { RelevadorDeEventos } from '../src/viajes/aplicacion/relevador-de-eventos';
import { PublicadorEventosEnLog } from '../src/viajes/infraestructura/publicador-eventos.log';
import { bearer, crearApp, cuerpoCrearViaje, nuevosIds } from './app-de-prueba';

const M5 = bearer('SYSTEM', 'm5-despacho');
const OPERATOR = bearer('OPERATOR', randomUUID());

describe('API de viajes (integración)', () => {
  let app: INestApplication;
  let eventos: PublicadorEventosEnLog;
  let relevador: RelevadorDeEventos;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    ({ app, eventos, relevador } = await crearApp());
    http = request(app.getHttpServer());
  });

  afterAll(() => app.close());

  /** Crea un viaje y devuelve su id y los tokens de su cliente y conductor. */
  async function crearViaje() {
    const ids = nuevosIds();
    const res = await http.post('/trips').set('Authorization', M5).send(cuerpoCrearViaje(ids)).expect(201);
    return {
      id: res.body.id as string,
      ids,
      cliente: bearer('CLIENT', ids.clientId),
      conductor: bearer('DRIVER', ids.driverId),
    };
  }

  async function viajeEnCurso() {
    const v = await crearViaje();
    await http.post(`/trips/${v.id}/arrived`).set('Authorization', v.conductor).expect(200);
    await http
      .post(`/trips/${v.id}/start`)
      .set('Authorization', v.conductor)
      .send({ verificationToken: `QR-${v.id}` })
      .expect(200);
    return v;
  }

  /** Hace correr al relevador (en los tests no corre solo) y devuelve lo publicado para ese viaje. */
  const eventosDe = async (tripId: string) => {
    await relevador.procesar();
    return eventos.publicados.filter((e) => e.payload.tripId === tripId);
  };

  describe('infraestructura común', () => {
    it('GET /health no requiere token', async () => {
      const res = await http.get('/health').expect(200);
      expect(res.body).toMatchObject({ status: 'UP', timestamp: expect.any(String) });
    });

    it('sin token responde 401 en formato problem+json', async () => {
      const res = await http.get('/trips').expect(401);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.body).toMatchObject({ status: 401, code: 'UNAUTHENTICATED', message: res.body.detail });
      expect(Number.isNaN(Date.parse(res.body.timestamp))).toBe(false);
    });

    it('rechaza un token firmado con otro secreto', async () => {
      const { JwtService } = await import('@nestjs/jwt');
      const falso = new JwtService({ secret: 'otro-secreto-cualquiera-1234' }).sign({ sub: 'x', role: 'OPERATOR' });
      await http.get('/trips').set('Authorization', `Bearer ${falso}`).expect(401);
    });

    it('GET /health/details informa el estado de cada dependencia', async () => {
      const res = await http.get('/health/details').expect(200);
      expect(res.body).toMatchObject({
        status: 'OK',
        version: expect.any(String),
        components: { postgres: expect.any(Object), rabbitmq: expect.any(Object), redis: expect.any(Object) },
        outbox: { pending: expect.any(Number) },
      });
    });

    it('registra cada pedido en JSON con su correlationId y su viaje', async () => {
      const lineas: Record<string, unknown>[] = [];
      app.useLogger(new RegistroJson((linea) => lineas.push(JSON.parse(linea))));
      try {
        const res = await http
          .post('/trips')
          .set('Authorization', M5)
          .set('X-Correlation-Id', 'corr-log-1')
          .send(cuerpoCrearViaje())
          .expect(201);
        await new Promise((r) => setImmediate(r)); // el log se escribe al terminar la respuesta
        expect(lineas).toContainEqual(
          expect.objectContaining({
            contexto: 'Pedidos',
            message: 'POST /trips 201',
            correlationId: 'corr-log-1',
            tripId: res.body.id,
            role: 'SYSTEM',
          }),
        );
        // Nunca se registra el token.
        expect(JSON.stringify(lineas)).not.toContain('Bearer');
      } finally {
        app.useLogger(false);
      }
    });

    it('una ruta inexistente responde 404 RUTA_NO_ENCONTRADA', async () => {
      const res = await http.get('/no-existe').set('Authorization', OPERATOR).expect(404);
      expect(res.body.code).toBe('ROUTE_NOT_FOUND');
    });

    it('propaga el X-Correlation-Id a la respuesta y a los eventos', async () => {
      const res = await http
        .post('/trips')
        .set('Authorization', M5)
        .set('X-Correlation-Id', 'mi-correlacion-123')
        .send(cuerpoCrearViaje())
        .expect(201);
      expect(res.headers['x-correlation-id']).toBe('mi-correlacion-123');
      expect((await eventosDe(res.body.id))[0].correlationId).toBe('mi-correlacion-123');
    });
  });

  describe('POST /viajes', () => {
    it('crea el viaje en ASIGNADO, con Location, ETag y evento ViajeCreado', async () => {
      const cuerpo = cuerpoCrearViaje();
      const res = await http.post('/trips').set('Authorization', M5).send(cuerpo).expect(201);

      expect(res.body).toMatchObject({ state: 'PENDING_ARRIVAL', version: 1, reservationId: null, closure: null });
      expect(res.headers.location).toBe(`/trips/${res.body.id}`);
      expect(res.headers.etag).toBe('"1"');
      expect((await eventosDe(res.body.id))).toEqual([
        expect.objectContaining({
          eventType: 'TripCreated',
          producer: 'm6-viajes',
          payload: expect.objectContaining({ requestId: cuerpo.requestId, vehicleType: 'CAR', tripVersion: 1 }),
        }),
      ]);
    });

    it('es idempotente por requestId: repetir devuelve el mismo viaje con 200', async () => {
      const cuerpo = cuerpoCrearViaje();
      const primero = await http.post('/trips').set('Authorization', M5).send(cuerpo).expect(201);
      const segundo = await http.post('/trips').set('Authorization', M5).send(cuerpo).expect(200);
      expect(segundo.body.id).toBe(primero.body.id);
      expect((await eventosDe(primero.body.id))).toHaveLength(1);
    });

    it('un reintento tras avanzar el viaje devuelve el viaje en su estado actual', async () => {
      const cuerpo = cuerpoCrearViaje();
      const creado = await http.post('/trips').set('Authorization', M5).send(cuerpo).expect(201);
      await http
        .post(`/trips/${creado.body.id}/arrived`)
        .set('Authorization', bearer('DRIVER', cuerpo.driverId))
        .expect(200);
      const reintento = await http.post('/trips').set('Authorization', M5).send(cuerpo).expect(200);
      expect(reintento.body).toMatchObject({ id: creado.body.id, state: 'DRIVER_ARRIVED' });
      expect(await eventosDe(creado.body.id)).toHaveLength(2);
    });

    it('responde 409 si el requestId ya existe con datos distintos', async () => {
      const cuerpo = cuerpoCrearViaje();
      await http.post('/trips').set('Authorization', M5).send(cuerpo).expect(201);
      const res = await http
        .post('/trips')
        .set('Authorization', M5)
        .send({ ...cuerpo, vehicleId: randomUUID() })
        .expect(409);
      expect(res.body.code).toBe('REQUEST_ID_CONFLICT');
    });

    it('sólo un servicio puede crear viajes', async () => {
      const res = await http
        .post('/trips')
        .set('Authorization', bearer('CLIENT', randomUUID()))
        .send(cuerpoCrearViaje())
        .expect(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('valida el cuerpo e informa cada campo inválido', async () => {
      const cuerpo = { ...cuerpoCrearViaje(), vehicleType: 'CAMION', originLatitude: 200, originLongitude: 0, };
      const res = await http.post('/trips').set('Authorization', M5).send(cuerpo).expect(400);
      expect(res.body.code).toBe('VALIDATION');
      const campos = res.body.errors.map((e: { field: string }) => e.field);
      expect(campos).toEqual(expect.arrayContaining(['vehicleType', 'originLatitude']));
    });

    it('rechaza campos que no están en el contrato', async () => {
      await http
        .post('/trips')
        .set('Authorization', M5)
        .send({ ...cuerpoCrearViaje(), tarifa: 1000 })
        .expect(400);
    });
  });

  describe('ciclo de vida completo', () => {
    it('ASIGNADO → CONDUCTOR_ARRIBADO → EN_CURSO → FINALIZADO, con historial y eventos', async () => {
      const v = await crearViaje();

      const arribo = await http.post(`/trips/${v.id}/arrived`).set('Authorization', v.conductor).expect(200);
      expect(arribo.body.state).toBe('DRIVER_ARRIVED');
      expect(arribo.headers.etag).toBe('"2"');

      const inicio = await http
        .post(`/trips/${v.id}/start`)
        .set('Authorization', v.conductor)
        .send({ verificationToken: `QR-${v.id}` })
        .expect(200);
      expect(inicio.body.state).toBe('IN_PROGRESS');

      const fin = await http
        .post(`/trips/${v.id}/complete`)
        .set('Authorization', v.conductor)
        .send({ distanceKm: 4.2 })
        .expect(200);
      expect(fin.body).toMatchObject({
        state: 'COMPLETED',
        version: 4,
        distanceKm: 4.2,
        durationMinutes: expect.any(Number),
        updatedAt: expect.any(String),
        closure: { distanceKm: 4.2, durationSeconds: expect.any(Number) },
      });

      const history = await http.get(`/trips/${v.id}/history`).set('Authorization', v.cliente).expect(200);
      expect(history.body.transitions.map((t: { to: string }) => t.to)).toEqual([
        'PENDING_ARRIVAL',
        'DRIVER_ARRIVED',
        'IN_PROGRESS',
        'COMPLETED',
      ]);
      expect(history.body.transitions[0]).toMatchObject({ sequence: 1, from: null, action: 'CREATE' });

      expect((await eventosDe(v.id)).map((e) => e.eventType)).toEqual([
        'TripCreated',
        'DriverArrived',
        'TripStarted',
        'TripCompleted',
      ]);
      expect((await eventosDe(v.id))[3].payload).toMatchObject({ distanceKm: 4.2, tripVersion: 4 });
    });

    it('una distancia menor a 0,1 km responde 400', async () => {
      const v = await crearViaje();
      const res = await http
        .post(`/trips/${v.id}/complete`)
        .set('Authorization', v.conductor)
        .send({ distanceKm: 0.05 })
        .expect(400);
      expect(res.body.errors).toEqual([expect.objectContaining({ field: 'distanceKm' })]);
    });

    it('una transición inválida responde 409 con el estado actual', async () => {
      const v = await crearViaje();
      const res = await http
        .post(`/trips/${v.id}/complete`)
        .set('Authorization', v.conductor)
        .send({ distanceKm: 0.1 })
        .expect(409);
      expect(res.body).toMatchObject({ code: 'INVALID_STATE_TRANSITION', currentState: 'PENDING_ARRIVAL' });
    });

    it('otro conductor no puede operar el viaje', async () => {
      const v = await crearViaje();
      const res = await http
        .post(`/trips/${v.id}/arrived`)
        .set('Authorization', bearer('DRIVER', randomUUID()))
        .expect(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('un viaje inexistente responde 404', async () => {
      const res = await http.post(`/trips/${randomUUID()}/arrived`).set('Authorization', OPERATOR).expect(404);
      expect(res.body.code).toBe('TRIP_NOT_FOUND');
    });
  });

  describe('inicio con QR (RF-6.4)', () => {
    it('un código incorrecto responde 422 y el viaje no cambia', async () => {
      const v = await crearViaje();
      await http.post(`/trips/${v.id}/arrived`).set('Authorization', v.conductor).expect(200);

      const res = await http
        .post(`/trips/${v.id}/start`)
        .set('Authorization', v.conductor)
        .send({ verificationToken: 'cualquier-cosa' })
        .expect(422);
      expect(res.body.code).toBe('INVALID_VERIFICATION_CODE');

      const viaje = await http.get(`/trips/${v.id}`).set('Authorization', v.conductor).expect(200);
      expect(viaje.body.state).toBe('DRIVER_ARRIVED');
    });

    it('el QR es de un solo uso', async () => {
      const v = await viajeEnCurso();
      const otro = await http
        .post(`/trips/${v.id}/start`)
        .set('Authorization', v.conductor)
        .send({ verificationToken: `QR-${v.id}` })
        .expect(409);
      expect(otro.body.code).toBe('INVALID_STATE_TRANSITION');
    });

    it('si la transición no es válida, no gasta el QR', async () => {
      const v = await crearViaje();
      // Intento de inicio sin arribo: debe fallar sin consumir el código.
      await http
        .post(`/trips/${v.id}/start`)
        .set('Authorization', v.conductor)
        .send({ verificationToken: `QR-${v.id}` })
        .expect(409);
      await http.post(`/trips/${v.id}/arrived`).set('Authorization', v.conductor).expect(200);
      await http
        .post(`/trips/${v.id}/start`)
        .set('Authorization', v.conductor)
        .send({ verificationToken: `QR-${v.id}` })
        .expect(200);
    });
  });

  describe('cancelación', () => {
    it('el conductor cancela antes del arribo y la solicitud vuelve a despacho', async () => {
      const v = await crearViaje();
      const res = await http
        .post(`/trips/${v.id}/cancel`)
        .set('Authorization', v.conductor)
        .send({ reason: 'VEHICLE_PROBLEM', detail: 'Pinché una goma' })
        .expect(200);
      expect(res.body).toMatchObject({
        state: 'CANCELLED',
        cancellation: { cancelledBy: 'DRIVER', previousState: 'PENDING_ARRIVAL', requiresRedispatch: true },
      });
      const evento = (await eventosDe(v.id)).at(-1);
      expect(evento).toMatchObject({
        eventType: 'TripCancelled',
        payload: expect.objectContaining({ requiresRedispatch: true, reason: 'VEHICLE_PROBLEM' }),
      });
      // El detalle libre no viaja en el evento (RNF-19).
      expect(evento?.payload).not.toHaveProperty('detail');
    });

    it('un motivo que no corresponde al rol responde 422', async () => {
      const v = await crearViaje();
      const res = await http
        .post(`/trips/${v.id}/cancel`)
        .set('Authorization', v.cliente)
        .send({ reason: 'SECURITY_INCIDENT' })
        .expect(422);
      expect(res.body.code).toBe('REASON_NOT_ALLOWED');
    });

    it('un motivo inexistente responde 400', async () => {
      const v = await crearViaje();
      await http.post(`/trips/${v.id}/cancel`).set('Authorization', v.cliente).send({ reason: 'NO_SE' }).expect(400);
    });
  });

  describe('consultas y visibilidad', () => {
    it('el cliente del viaje y el operador lo ven; otro cliente recibe 404', async () => {
      const v = await crearViaje();
      await http.get(`/trips/${v.id}`).set('Authorization', v.cliente).expect(200);
      await http.get(`/trips/${v.id}`).set('Authorization', OPERATOR).expect(200);
      await http.get(`/trips/${v.id}`).set('Authorization', bearer('CLIENT', randomUUID())).expect(404);
    });

    it('un servicio no puede ver el historial', async () => {
      const v = await crearViaje();
      await http.get(`/trips/${v.id}/history`).set('Authorization', M5).expect(403);
    });

    it('el cliente sólo lista sus viajes aunque pida los de otro', async () => {
      const a = await crearViaje();
      const b = await crearViaje();
      const res = await http
        .get('/trips')
        .query({ clientId: b.ids.clientId })
        .set('Authorization', a.cliente)
        .expect(200);
      expect(res.body).toMatchObject({ total: 1, page: 1, pageSize: 20 });
      expect(res.body.items[0]).toMatchObject({ id: a.id, originAddress: 'Av. Corrientes 1000' });
    });

    it('un servicio debe indicar clienteId o conductorId', async () => {
      await http.get('/trips').set('Authorization', M5).expect(400);
    });

    it('filtra por estado y pagina', async () => {
      const v = await viajeEnCurso();
      const otro = await crearViaje();
      const enCurso = await http
        .get('/trips')
        .query({ state: 'IN_PROGRESS,COMPLETED', pageSize: 100 })
        .set('Authorization', OPERATOR)
        .expect(200);
      const ids = enCurso.body.items.map((i: { id: string }) => i.id);
      expect(ids).toContain(v.id);
      expect(ids).not.toContain(otro.id);

      const page = await http.get('/trips').query({ pageSize: 1, page: 2 }).set('Authorization', OPERATOR).expect(200);
      expect(page.body.items).toHaveLength(1);
      expect(page.body.total).toBeGreaterThan(1);
    });

    it('valida los parámetros de la consulta', async () => {
      await http.get('/trips').query({ pageSize: 500 }).set('Authorization', OPERATOR).expect(400);
      await http.get('/trips').query({ state: 'VOLANDO' }).set('Authorization', OPERATOR).expect(400);
    });
  });

  describe('concurrencia e idempotencia (RNF-08, RNF-09)', () => {
    it('If-Match con una versión vieja responde 412; con la actual, 200', async () => {
      const v = await crearViaje();
      const res = await http
        .post(`/trips/${v.id}/arrived`)
        .set('Authorization', v.conductor)
        .set('If-Match', '"7"')
        .expect(412);
      expect(res.body.code).toBe('PRECONDITION_FAILED');
      await http.post(`/trips/${v.id}/arrived`).set('Authorization', v.conductor).set('If-Match', '"1"').expect(200);
    });

    it('un If-Match mal formado responde 400', async () => {
      const v = await crearViaje();
      await http.post(`/trips/${v.id}/arrived`).set('Authorization', v.conductor).set('If-Match', 'abc').expect(400);
    });

    it('repetir un pedido con la misma Idempotency-Key devuelve la respuesta original', async () => {
      const v = await crearViaje();
      const clave = randomUUID();
      const enviar = () =>
        http
          .post(`/trips/${v.id}/cancel`)
          .set('Authorization', v.cliente)
          .set('Idempotency-Key', clave)
          .send({ reason: 'CHANGE_OF_PLANS' });

      const primero = await enviar().expect(200);
      const repetido = await enviar().expect(200);
      expect(repetido.body).toEqual(primero.body);
      expect(repetido.headers['idempotent-replayed']).toBe('true');
      expect((await eventosDe(v.id)).filter((e) => e.eventType === 'TripCancelled')).toHaveLength(1);
    });

    it('la misma Idempotency-Key con otro cuerpo responde 422', async () => {
      const v = await crearViaje();
      const clave = randomUUID();
      await http
        .post(`/trips/${v.id}/cancel`)
        .set('Authorization', v.cliente)
        .set('Idempotency-Key', clave)
        .send({ reason: 'CHANGE_OF_PLANS' })
        .expect(200);
      const res = await http
        .post(`/trips/${v.id}/cancel`)
        .set('Authorization', v.cliente)
        .set('Idempotency-Key', clave)
        .send({ reason: 'EXCESSIVE_DELAY' })
        .expect(422);
      expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('un error no se guarda: se puede reintentar con la misma Idempotency-Key', async () => {
      const v = await crearViaje();
      const clave = randomUUID();
      const enviar = (reason: string) =>
        http
          .post(`/trips/${v.id}/cancel`)
          .set('Authorization', v.cliente)
          .set('Idempotency-Key', clave)
          .send({ reason });
      await enviar('SECURITY_INCIDENT').expect(422); // motivo no permitido para el cliente
      await enviar('CHANGE_OF_PLANS').expect(200);
    });

    it('una Idempotency-Key vacía o demasiado larga responde 400', async () => {
      const v = await crearViaje();
      await http
        .post(`/trips/${v.id}/arrived`)
        .set('Authorization', v.conductor)
        .set('Idempotency-Key', 'x'.repeat(201))
        .expect(400);
    });

    it('dos finalizaciones simultáneas: sólo una gana', async () => {
      const v = await viajeEnCurso();
      const finalizar = () =>
        http
          .post(`/trips/${v.id}/complete`)
          .set('Authorization', v.conductor)
          .send({ distanceKm: 1 });

      const respuestas = await Promise.all([finalizar(), finalizar(), finalizar()]);
      expect(respuestas.map((r) => r.status).sort()).toEqual([200, 409, 409]);
      expect((await eventosDe(v.id)).filter((e) => e.eventType === 'TripCompleted')).toHaveLength(1);
    });
  });
});

describe('API de viajes con M8 lento o caído (RNF-13)', () => {
  /** Validador controlable: espera `demoraMs` y luego responde o falla. */
  class ValidadorDePrueba implements ValidadorCodigoVerificacion {
    demoraMs = 0;
    caido = false;
    async validarYConsumir(): Promise<ResultadoValidacionCodigo> {
      await new Promise((r) => setTimeout(r, this.demoraMs));
      if (this.caido) throw new DependenciaNoDisponibleError('M8 (Notificaciones)');
      return 'VALIDO';
    }
  }

  const validador = new ValidadorDePrueba();
  let app: INestApplication;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    ({ app } = await crearApp({ validador }));
    http = request(app.getHttpServer());
  });

  afterAll(() => app.close());

  beforeEach(() => {
    validador.demoraMs = 0;
    validador.caido = false;
  });

  async function viajeArribado() {
    const ids = nuevosIds();
    const res = await http.post('/trips').set('Authorization', M5).send(cuerpoCrearViaje(ids)).expect(201);
    const conductor = bearer('DRIVER', ids.driverId);
    await http.post(`/trips/${res.body.id}/arrived`).set('Authorization', conductor).expect(200);
    return { id: res.body.id as string, conductor };
  }

  it('si M8 no responde, devuelve 503 con Retry-After y el viaje no cambia', async () => {
    const v = await viajeArribado();
    validador.caido = true;

    const res = await http
      .post(`/trips/${v.id}/start`)
      .set('Authorization', v.conductor)
      .send({ verificationToken: 'x' })
      .expect(503);
    expect(res.body.code).toBe('DEPENDENCY_UNAVAILABLE');
    expect(res.headers['retry-after']).toBe('5');

    const viaje = await http.get(`/trips/${v.id}`).set('Authorization', v.conductor).expect(200);
    expect(viaje.body.state).toBe('DRIVER_ARRIVED');
  });

  it('dos inicios simultáneos con la misma Idempotency-Key: el segundo recibe PEDIDO_EN_CURSO', async () => {
    const v = await viajeArribado();
    validador.demoraMs = 100;
    const clave = randomUUID();
    const iniciar = () =>
      http
        .post(`/trips/${v.id}/start`)
        .set('Authorization', v.conductor)
        .set('Idempotency-Key', clave)
        .send({ verificationToken: 'x' });

    const [a, b] = await Promise.all([iniciar(), iniciar()]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect([a.body.code, b.body.code]).toContain('REQUEST_IN_PROGRESS');

    // Terminado el primero, repetir devuelve la respuesta guardada.
    const repetido = await iniciar().expect(200);
    expect(repetido.headers['idempotent-replayed']).toBe('true');
  });

  it('dos inicios simultáneos mientras M8 demora: uno gana y el otro recibe CONFLICTO_CONCURRENCIA', async () => {
    const v = await viajeArribado();
    validador.demoraMs = 50;
    const iniciar = () =>
      http.post(`/trips/${v.id}/start`).set('Authorization', v.conductor).send({ verificationToken: 'x' });

    const [a, b] = await Promise.all([iniciar(), iniciar()]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect([a.body.code, b.body.code]).toContain('CONCURRENCY_CONFLICT');
  });
});

describe('API de viajes con el almacén de idempotencia caído (RNF-13)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const almacenCaido = {
    reservar: () => Promise.reject(new Error('Redis caído')),
    completar: () => Promise.reject(new Error('Redis caído')),
    liberar: () => Promise.reject(new Error('Redis caído')),
  };

  beforeAll(async () => {
    ({ app } = await crearApp({ almacenIdempotencia: almacenCaido }));
    http = request(app.getHttpServer());
  });

  afterAll(() => app.close());

  it('procesa el pedido igual, y las reglas del dominio siguen evitando efectos duplicados', async () => {
    const ids = nuevosIds();
    const creado = await http.post('/trips').set('Authorization', M5).send(cuerpoCrearViaje(ids)).expect(201);
    const conductor = bearer('DRIVER', ids.driverId);
    const arribo = () =>
      http.post(`/trips/${creado.body.id}/arrived`).set('Authorization', conductor).set('Idempotency-Key', 'k1');

    await arribo().expect(200);
    const repetido = await arribo().expect(409); // sin almacén no hay replay, pero tampoco doble arribo
    expect(repetido.body.code).toBe('INVALID_STATE_TRANSITION');
  });
});
