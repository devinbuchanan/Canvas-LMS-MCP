import express, { NextFunction, Request, Response } from 'express';
import cors, { CorsOptions, CorsOptionsDelegate } from 'cors';
import type { Server } from 'node:http';

import {
  JSONRPCRequest,
  JSONRPCResponse,
  createErrorResponse,
  isJSONRPCRequest,
} from '../lib/jsonRpc';
import { logger } from '../lib/logger';

export type JSONRPCDispatcher = (request: JSONRPCRequest) => Promise<JSONRPCResponse>;

export interface HttpServerOptions {
  dispatcher: JSONRPCDispatcher;
  corsOptions?: CorsOptions | CorsOptionsDelegate<Request>;
  jsonBodyLimit?: string;
}

export interface StartHttpServerOptions extends HttpServerOptions {
  port?: number;
  host?: string;
}

const DEFAULT_JSON_LIMIT = '1mb';
const DEFAULT_HOST = '127.0.0.1';

function resolvePort(explicitPort?: number): number {
  if (typeof explicitPort === 'number') {
    if (!Number.isInteger(explicitPort) || explicitPort <= 0) {
      throw new Error('Port must be a positive integer.');
    }
    return explicitPort;
  }

  const envPort = process.env.PORT;

  if (!envPort) {
    throw new Error('PORT environment variable must be defined.');
  }

  const parsedPort = Number.parseInt(envPort, 10);

  if (!Number.isInteger(parsedPort) || parsedPort <= 0) {
    throw new Error('PORT must be set to a positive integer.');
  }

  return parsedPort;
}

export function createHttpServer({
  dispatcher,
  corsOptions,
  jsonBodyLimit = DEFAULT_JSON_LIMIT,
}: HttpServerOptions): express.Express {
  const app = express();

  // Enables cross-origin requests from approved origins so browser-based clients can reach the MCP server.
  app.use(corsOptions ? cors(corsOptions) : cors());

  // Parses JSON request bodies and enforces a size limit to protect server memory.
  app.use(express.json({ limit: jsonBodyLimit }));

  // Converts malformed JSON payloads into a JSON-RPC "parse error" response instead of crashing the server.
  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (error instanceof SyntaxError) {
      logger.warn('Rejected request with malformed JSON body.');
      res.status(400).json(createErrorResponse(null, -32700, 'Parse error'));
      return;
    }

    next(error as Error);
  });

  // Lightweight readiness endpoint that external monitors can call to verify the service is up.
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  // Primary MCP endpoint: validates the JSON-RPC request and delegates to the dispatcher for execution.
  app.post('/mcp', async (req: Request, res: Response) => {
    const payload = req.body;

    if (!isJSONRPCRequest(payload)) {
      logger.warn('Received invalid JSON-RPC payload', { payload });
      res.status(400).json(createErrorResponse(null, -32600, 'Invalid Request'));
      return;
    }

    try {
      const response = await dispatcher(payload);

      if (!response || typeof response !== 'object') {
        throw new Error('Dispatcher returned an invalid JSON-RPC response.');
      }

      res.json(response);
    } catch (error) {
      logger.error('Failed to handle JSON-RPC request', {
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      });

      res
        .status(500)
        .json(createErrorResponse(payload.id ?? null, -32603, 'Internal error while processing request.'));
    }
  });

  // Fallback error handler that ensures any uncaught errors are logged and surfaced as JSON-RPC faults.
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    logger.error('Unhandled error in HTTP transport', {
      error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
    });

    res.status(500).json(createErrorResponse(null, -32603, 'Internal server error.'));
  });

  return app;
}

export async function startHttpServer({
  dispatcher,
  corsOptions,
  jsonBodyLimit,
  port,
  host = DEFAULT_HOST,
}: StartHttpServerOptions): Promise<Server> {
  const resolvedPort = resolvePort(port);
  const app = createHttpServer({ dispatcher, corsOptions, jsonBodyLimit });

  return await new Promise<Server>((resolve, reject) => {
    const server = app
      .listen(resolvedPort, host, () => {
        logger.info(`HTTP transport listening on http://${host}:${resolvedPort}`);
        resolve(server);
      })
      .on('error', (error) => {
        logger.error('Failed to start HTTP server', {
          error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
        });
        reject(error);
      });

    server.keepAliveTimeout = 60000;
    server.headersTimeout = 65000;
  });
}
