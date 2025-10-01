export const JSON_RPC_VERSION = '2.0' as const;

export type JSONRPCID = string | number | null;

export interface JSONRPCRequest {
  jsonrpc: typeof JSON_RPC_VERSION;
  method: string;
  params?: unknown;
  id?: JSONRPCID;
}

export interface JSONRPCError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JSONRPCResponse {
  jsonrpc: typeof JSON_RPC_VERSION;
  id: JSONRPCID;
  result?: unknown;
  error?: JSONRPCError;
}

export function isJSONRPCRequest(candidate: unknown): candidate is JSONRPCRequest {
  if (typeof candidate !== 'object' || candidate === null) {
    return false;
  }

  const maybeRequest = candidate as Partial<JSONRPCRequest>;
  return (
    maybeRequest.jsonrpc === JSON_RPC_VERSION &&
    typeof maybeRequest.method === 'string' &&
    (maybeRequest.id === undefined || typeof maybeRequest.id === 'string' || typeof maybeRequest.id === 'number' || maybeRequest.id === null)
  );
}

export function createErrorResponse(id: JSONRPCID, code: number, message: string, data?: unknown): JSONRPCResponse {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id,
    error: {
      code,
      message,
      data,
    },
  };
}

export function createResultResponse(id: JSONRPCID, result: unknown): JSONRPCResponse {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id,
    result,
  };
}
