import { createHttpServer } from './transports/httpServer';
import { logger } from './lib/logger';

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

const parsedPort = Number.parseInt(process.env.PORT ?? '', 10);

if (!Number.isInteger(parsedPort) || parsedPort <= 0) {
  logger.error('PORT must be a positive integer.');
  process.exit(1);
}

const app = createHttpServer();

app.listen(parsedPort, () => {
  logger.info(`Canvas LMS MCP server listening on port ${parsedPort}`);
});
