import { logger } from './lib/logger';
import { JSONRPCDispatcher, startHttpServer } from './transports/http';
import { handleRpc } from './rpc';

type RequiredEnvVar = 'CANVAS_DOMAIN' | 'CANVAS_API_TOKEN';

const REQUIRED_ENV_VARS: RequiredEnvVar[] = ['CANVAS_DOMAIN', 'CANVAS_API_TOKEN'];

function validateRequiredEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter((name) => {
    const value = process.env[name];
    return value === undefined || value.trim() === '';
  });

  if (missing.length > 0) {
    logger.error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
        'Please provide them before starting the server.',
    );
    process.exit(1);
  }
}

function resolvePort(rawPort: string | undefined, fallback: number): number {
  const candidate = rawPort?.trim();

  if (!candidate) {
    return fallback;
  }

  const parsed = Number.parseInt(candidate, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    logger.error('PORT must be set to a positive integer.');
    process.exit(1);
  }

  return parsed;
}

function resolveCorsOrigins(): string[] {
  const corsEnv = process.env.CORS_ORIGINS ?? '*';

  return corsEnv
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

const dispatcher: JSONRPCDispatcher = async (request) => handleRpc(request);

async function bootstrap(): Promise<void> {
  // Step 1: confirm the environment is configured with the secrets we need to talk to Canvas.
  validateRequiredEnv();

  // Step 2: derive runtime options (defaults today, but could be pulled from config services later).
  const host = process.env.HOST?.trim() || '127.0.0.1';
  const port = resolvePort(process.env.PORT, 3000);
  const corsOrigins = resolveCorsOrigins();
  const corsOptions =
    corsOrigins.length === 0 || corsOrigins.includes('*') ? undefined : { origin: corsOrigins };

  try {
    // Step 3: launch the HTTP transport. Additional transports (e.g., websockets, CLI) can
    // follow this pattern by instantiating their server here and sharing the dispatcher.
    await startHttpServer({ dispatcher, corsOptions, host, port });
  } catch (error) {
    logger.error('Fatal error while starting HTTP transport', {
      error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
    });
    process.exit(1);
  }
}

void bootstrap();
