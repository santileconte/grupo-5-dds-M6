import { SetMetadata } from '@nestjs/common';

export const ES_PUBLICO = 'esPublico';

/** Marca una ruta que no requiere token (por ejemplo, el health check). */
export const Publico = () => SetMetadata(ES_PUBLICO, true);
