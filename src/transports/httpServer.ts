import express, { Request, Response } from 'express';
import { createErrorResponse, JSON_RPC_VERSION, JSONRPCID, isJSONRPCRequest } from '../lib/jsonRpc';
import { logger } from '../lib/logger';

export interface MCPContext {
  // Placeholder for future dependencies such as Canvas API clients or tool registries.
}

export function createHttpServer(_context: MCPContext = {}): express.Express {
  const app = express();

  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'canvas-lms-mcp', version: JSON_RPC_VERSION });
  });

  app.post('/mcp', (req: Request, res: Response) => {
    const payload = req.body;

    if (!isJSONRPCRequest(payload)) {
      logger.warn('Received invalid JSON-RPC payload', { payload });
      res.status(400).json(createErrorResponse(null, -32600, 'Invalid Request'));
      return;
    }

    const id: JSONRPCID = payload.id ?? null;

    logger.info('Received JSON-RPC request', {
      id: payload.id ?? null,
      method: payload.method,
    });

    res.json(createErrorResponse(id, -32601, `Method '${payload.method}' is not implemented.`));
  });

  app.get('/mcp/stream', (_req: Request, res: Response) => {
    res.status(501).json({
      error: 'Server-sent events stream is not implemented yet.',
    });
  });

  return app;
}
