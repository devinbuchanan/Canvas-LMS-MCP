import { createErrorResponse } from './lib/jsonRpc';
import { logger } from './lib/logger';
import { JSONRPCDispatcher, startHttpServer } from './transports/http';

const requiredEnvVars = [
  'CANVAS_DOMAIN',
  'CANVAS_API_TOKEN',
  'PORT',
  'CORS_ORIGINS',
] as const;

const missingEnvVars = requiredEnvVars.filter((name) => {
  const value = process.env[name];
  return value === undefined || value.trim() === '';
});

if (missingEnvVars.length > 0) {
  logger.error(
    `Missing required environment variables: ${missingEnvVars.join(', ')}. ` +
      'Please define them before starting the server.',
  );
  process.exit(1);
}

const dispatcher: JSONRPCDispatcher = async (request) => {
  const id = request.id ?? null;
  return createErrorResponse(id, -32601, `Method '${request.method}' is not implemented.`);
};

const corsOriginsEnv = process.env.CORS_ORIGINS ?? '';
const allowedOrigins = corsOriginsEnv
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

const corsOptions =
  allowedOrigins.length > 0 && !allowedOrigins.includes('*')
    ? { origin: allowedOrigins }
    : undefined;

startHttpServer({
  dispatcher,
  corsOptions,
}).catch((error) => {
  logger.error('Fatal error while starting HTTP transport', {
    error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
  });
  process.exit(1);
});
