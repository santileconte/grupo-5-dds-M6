// Se ejecuta antes de cada archivo de test (setupFiles), antes de importar AppModule.
export const SECRETO_TESTS = 'secreto-solo-para-tests-0123456789';
process.env.JWT_SECRETO = SECRETO_TESTS;
process.env.VALIDADOR_QR = 'simulado';
process.env.ESPERA_MINIMA_ARRIBO_MINUTOS = '5';
