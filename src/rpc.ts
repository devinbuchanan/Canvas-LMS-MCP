import { z, ZodTypeAny } from 'zod';
import {
  JSON_RPC_VERSION,
  JSONRPCRequest,
  JSONRPCResponse,
  createErrorResponse,
  createResultResponse,
} from './lib/jsonRpc';

/**
 * Tool handlers receive validated params and the raw JSON-RPC request, and may resolve to any JSON-serialisable result.
 */
type ToolHandler<T> = (params: T, request: JSONRPCRequest) => Promise<unknown> | unknown;

interface ToolDefinition<T> {
  schema: z.ZodType<T>;
  handler: ToolHandler<T>;
}

const jsonRpcRequestSchema = z.object({
  jsonrpc: z.literal(JSON_RPC_VERSION),
  method: z.string().min(1, 'Method name is required'),
  params: z.unknown().optional(),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
});

const toolRegistry = new Map<string, ToolDefinition<unknown>>();

interface HandleRpcFunction {
  (body: unknown): Promise<JSONRPCResponse | null>;
  registerTool<T>(method: string, schema: z.ZodType<T>, handler: ToolHandler<T>): void;
  tools: Map<string, ToolDefinition<unknown>>;
}

function normaliseBody(body: unknown): unknown {
  if (typeof body === 'string') {
    return JSON.parse(body);
  }

  if (body instanceof Buffer) {
    return JSON.parse(body.toString('utf8'));
  }

  return body;
}

async function dispatchRequest(request: JSONRPCRequest): Promise<JSONRPCResponse | null> {
  const tool = toolRegistry.get(request.method);
  const shouldRespond = request.id !== undefined;
  const id = request.id ?? null;

  if (!tool) {
    return shouldRespond
      ? createErrorResponse(id, -32601, `Method '${request.method}' was not found.`)
      : null;
  }

  const parsedParams = tool.schema.safeParse(request.params);

  if (!parsedParams.success) {
    return shouldRespond
      ? createErrorResponse(id, -32602, 'Invalid params', parsedParams.error.flatten())
      : null;
  }

  try {
    const result = await tool.handler(parsedParams.data, request);

    return shouldRespond ? createResultResponse(id, result) : null;
  } catch (error) {
    if (!shouldRespond) {
      return null;
    }

    const data =
      error instanceof Error
        ? { message: error.message, stack: error.stack }
        : { message: 'Unknown error', value: error };

    return createErrorResponse(id, -32603, 'Internal error', data);
  }
}

const handleRpcImpl = (async (body: unknown) => {
  let payload: unknown;

  try {
    payload = normaliseBody(body);
  } catch (error) {
    return createErrorResponse(null, -32700, 'Parse error', {
      message: error instanceof Error ? error.message : 'Unable to parse JSON payload.',
    });
  }

  const parsedRequest = jsonRpcRequestSchema.safeParse(payload);

  if (!parsedRequest.success) {
    return createErrorResponse(null, -32600, 'Invalid Request', parsedRequest.error.flatten());
  }

  return dispatchRequest(parsedRequest.data);
}) as HandleRpcFunction;

handleRpcImpl.registerTool = <T>(method: string, schema: z.ZodType<T>, handler: ToolHandler<T>) => {
  if (toolRegistry.has(method)) {
    throw new Error(`A tool handler for method '${method}' is already registered.`);
  }

  toolRegistry.set(method, { schema: schema as ZodTypeAny, handler: handler as ToolHandler<unknown> });
};

handleRpcImpl.tools = toolRegistry;

/**
 * Dispatch a JSON-RPC request body to the registered tool handlers.
 *
 * Control flow:
 * 1. Normalise the raw body (string/Buffer/object) into a JSON value.
 * 2. Validate the envelope against the JSON-RPC 2.0 schema.
 * 3. Resolve the matching tool handler, validating params with its Zod schema.
 * 4. Invoke the handler and wrap its result or failure in a JSON-RPC response.
 */
export const handleRpc = handleRpcImpl;

