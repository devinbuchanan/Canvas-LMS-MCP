import { logger } from './lib/logger';
import {
  JSONRPCDispatcher,
  RateLimitConfig,
  SharedSecretConfig,
  startHttpServer,
} from './transports/http';
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

function parseBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];

  if (raw === undefined) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();

  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }

  logger.error(`${name} must be a boolean value (true/false). Received: ${raw}`);
  process.exit(1);
}

function parsePositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];

  if (raw === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(raw.trim(), 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    logger.error(`${name} must be set to a positive integer. Received: ${raw}`);
    process.exit(1);
  }

  return parsed;
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
  const nodeEnv = process.env.NODE_ENV?.trim().toLowerCase() ?? 'development';
  const isProduction = nodeEnv === 'production';

  const rateLimitEnabled = parseBooleanEnv('MCP_RATE_LIMIT_ENABLED', true);
  const rateLimitBypass = parseBooleanEnv('MCP_RATE_LIMIT_BYPASS', false);
  const rateLimitWindowMs = parsePositiveIntegerEnv('MCP_RATE_LIMIT_WINDOW_MS', 60_000);
  const rateLimitMaxRequests = parsePositiveIntegerEnv('MCP_RATE_LIMIT_MAX_REQUESTS', 120);

  let rateLimitConfig: RateLimitConfig | undefined;

  if (rateLimitEnabled && !rateLimitBypass) {
    rateLimitConfig = {
      windowMs: rateLimitWindowMs,
      maxRequests: rateLimitMaxRequests,
    };
  } else if (!rateLimitEnabled) {
    logger.info('Per-IP rate limiting is disabled via MCP_RATE_LIMIT_ENABLED=false.');
  } else if (rateLimitBypass) {
    logger.info('Per-IP rate limiting bypass is enabled.');
  }

  const transportSecret = process.env.MCP_TRANSPORT_SECRET?.trim();
  const transportSecretHeader = process.env.MCP_TRANSPORT_SECRET_HEADER?.trim() || 'x-mcp-transport-secret';
  const transportSecretBypass = parseBooleanEnv('MCP_TRANSPORT_SECRET_BYPASS', false);

  let sharedSecretConfig: SharedSecretConfig | undefined;

  if (transportSecret) {
    if (transportSecretBypass) {
      logger.info('MCP transport secret guard is bypassed. Requests will not require a shared secret.');
    } else {
      sharedSecretConfig = {
        secret: transportSecret,
        headerName: transportSecretHeader,
      };

      if (!isProduction) {
        logger.info(
          `MCP transport secret guard enabled in ${nodeEnv} mode. Requests must include the ${transportSecretHeader} header.`,
        );
      }
    }
  }

  if (rateLimitConfig) {
    logger.info(
      `Per-IP rate limiting enabled: ${rateLimitConfig.maxRequests} requests every ${rateLimitConfig.windowMs}ms.`,
    );
  }

  if (sharedSecretConfig) {
    logger.info(`MCP transport secret header enforcement enabled using ${transportSecretHeader}.`);
  }

  try {
    // Step 3: launch the HTTP transport. Additional transports (e.g., websockets, CLI) can
    // follow this pattern by instantiating their server here and sharing the dispatcher.
    await startHttpServer({
      dispatcher,
      corsOptions,
      host,
      port,
      rateLimitConfig,
      sharedSecretConfig,
    });
  } catch (error) {
    logger.error('Fatal error while starting HTTP transport', {
      error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
    });
    process.exit(1);
  }
}

void bootstrap();
