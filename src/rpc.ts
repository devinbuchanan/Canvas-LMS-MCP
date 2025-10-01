import { ZodError } from 'zod';

import {
  createErrorResponse,
  createResultResponse,
  isJSONRPCRequest,
} from './lib/jsonRpc';
import type { JSONRPCRequest, JSONRPCResponse } from './lib/jsonRpc';
import { logger } from './lib/logger';
import { toolRegistry, ToolDefinition } from './tools';

function getTool(method: string): ToolDefinition | undefined {
  return toolRegistry.get(method);
}

export async function handleRpc(body: unknown): Promise<JSONRPCResponse> {
  if (!isJSONRPCRequest(body)) {
    return createErrorResponse(null, -32600, 'Invalid Request');
  }

  const request: JSONRPCRequest = body;
  const id = request.id ?? null;
  const tool = getTool(request.method);

  if (!tool) {
    return createErrorResponse(id, -32601, `Method '${request.method}' was not found.`);
  }

  let parsedParams: unknown;

  try {
    parsedParams = tool.paramsSchema.parse(request.params);
  } catch (error) {
    if (error instanceof ZodError) {
      logger.warn(`Validation failed for method '${request.method}'.`, { issues: error.issues });
      return createErrorResponse(id, -32602, 'Invalid params', { issues: error.issues });
    }

    logger.error(`Unexpected error while validating params for method '${request.method}'.`, {
      error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
    });
    return createErrorResponse(id, -32603, 'Internal error while validating params.');
  }

  try {
    const result = await tool.handler(parsedParams);
    return createResultResponse(id, result);
  } catch (error) {
    logger.error(`Handler for method '${request.method}' threw an error.`, {
      error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
    });
    return createErrorResponse(id, -32603, 'Internal error while executing method.');
  }
}
