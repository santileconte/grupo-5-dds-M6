/**
 * Valida las variables de entorno al arrancar (RNF-06: la configuración vive fuera del código).
 * Si falta algo, el servicio no arranca y el mensaje dice qué corregir.
 */
export function validarConfiguracion(env: Record<string, unknown>): Record<string, unknown> {
  const errores: string[] = [];

  const secreto = env.JWT_SECRETO;
  if (typeof secreto !== 'string' || secreto.length < 16) {
    errores.push('JWT_SECRETO es obligatorio y debe tener al menos 16 caracteres');
  }

  const validador = env.VALIDADOR_QR ?? 'simulado';
  if (validador !== 'simulado' && validador !== 'm8') {
    errores.push('VALIDADOR_QR debe ser "simulado" o "m8"');
  }
  if (validador === 'm8' && !env.M8_URL) {
    errores.push('M8_URL es obligatoria cuando VALIDADOR_QR=m8');
  }

  const persistencia = env.PERSISTENCIA ?? 'memoria';
  if (persistencia !== 'memoria' && persistencia !== 'postgres') {
    errores.push('PERSISTENCIA debe ser "memoria" o "postgres"');
  }
  if (persistencia === 'postgres' && !env.BASE_DATOS_URL) {
    errores.push('BASE_DATOS_URL es obligatoria cuando PERSISTENCIA=postgres');
  }

  const publicador = env.PUBLICADOR_EVENTOS ?? 'log';
  if (publicador !== 'log' && publicador !== 'rabbitmq') {
    errores.push('PUBLICADOR_EVENTOS debe ser "log" o "rabbitmq"');
  }
  if (publicador === 'rabbitmq' && !env.RABBITMQ_URL) {
    errores.push('RABBITMQ_URL es obligatoria cuando PUBLICADOR_EVENTOS=rabbitmq');
  }

  for (const nombre of ['OUTBOX_INTERVALO_MS', 'OUTBOX_TAMANIO_LOTE', 'RABBITMQ_TIMEOUT_MS', 'PUERTO', 'ESPERA_MINIMA_ARRIBO_MINUTOS', 'M8_TIMEOUT_MS']) {
    if (env[nombre] !== undefined && !(Number(env[nombre]) >= 0)) {
      errores.push(`${nombre} debe ser un número`);
    }
  }

  if (errores.length > 0) {
    throw new Error(
      `Configuración inválida:\n - ${errores.join('\n - ')}\n` +
        'Copiá .env.example a .env y completá los valores.',
    );
  }
  return env;
}
