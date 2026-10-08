// Se ejecuta antes de cada archivo de test (setupFiles), antes de importar AppModule.
// Por defecto los tests usan el repositorio en memoria; `npm run test:postgres` los corre contra PostgreSQL.
export const SECRETO_TESTS = 'secreto-solo-para-tests-0123456789';
export const CON_POSTGRES = process.env.TEST_PERSISTENCIA === 'postgres';

process.env.JWT_SECRETO = SECRETO_TESTS;
process.env.VALIDADOR_QR = 'simulado';
process.env.ESPERA_MINIMA_ARRIBO_MINUTOS = '5';
process.env.PERSISTENCIA = CON_POSTGRES ? 'postgres' : 'memoria';
if (CON_POSTGRES) {
  process.env.BASE_DATOS_URL =
    process.env.TEST_BASE_DATOS_URL ?? 'postgres://m6:m6@localhost:5432/m6_viajes_test';
}
