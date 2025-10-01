import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import test from 'node:test';

import { createResultResponse } from '../lib/jsonRpc';
import { JSONRPCDispatcher, startHttpServer } from '../transports/http';

const dispatcher: JSONRPCDispatcher = async (request) =>
  createResultResponse(request.id ?? null, { ok: true });

function resolvePort(server: Awaited<ReturnType<typeof startHttpServer>>): number {
  const address = server.address();
  assert(address && typeof address === 'object');
  return (address as AddressInfo).port;
}

test('POST /mcp enforces rate limiting when configured', async () => {
  const server = await startHttpServer({
    dispatcher,
    host: '127.0.0.1',
    port: 0,
    rateLimitConfig: { windowMs: 1_000, maxRequests: 1 },
  });

  const port = resolvePort(server);
  const url = `http://127.0.0.1:${port}/mcp`;
  const payload = { jsonrpc: '2.0', id: 1, method: 'ping', params: {} };

  try {
    const first = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(first.status, 200);

    const second = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(second.status, 429);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error?: Error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
});

test('rate limiting can be bypassed for development scenarios', async () => {
  const server = await startHttpServer({
    dispatcher,
    host: '127.0.0.1',
    port: 0,
  });

  const port = resolvePort(server);
  const url = `http://127.0.0.1:${port}/mcp`;
  const payload = { jsonrpc: '2.0', id: 2, method: 'ping', params: {} };

  try {
    for (let i = 0; i < 3; i += 1) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      assert.equal(response.status, 200);
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error?: Error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
});

test('transport secret guard rejects missing or invalid headers', async () => {
  const server = await startHttpServer({
    dispatcher,
    host: '127.0.0.1',
    port: 0,
    sharedSecretConfig: { secret: 'super-secret', headerName: 'x-test-secret' },
  });

  const port = resolvePort(server);
  const url = `http://127.0.0.1:${port}/mcp`;
  const payload = { jsonrpc: '2.0', id: 3, method: 'ping', params: {} };

  try {
    const missing = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(missing.status, 401);

    const invalid = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-secret': 'wrong' },
      body: JSON.stringify(payload),
    });
    assert.equal(invalid.status, 401);

    const valid = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-secret': 'super-secret' },
      body: JSON.stringify(payload),
    });
    assert.equal(valid.status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error?: Error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
});
