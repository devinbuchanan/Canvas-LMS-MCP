import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import test from 'node:test';

import { createResultResponse } from '../lib/jsonRpc';
import { JSONRPCDispatcher, startHttpServer } from '../transports/http';

const noopDispatcher: JSONRPCDispatcher = async () => createResultResponse(null, null);

test('GET /mcp/stream emits heartbeats and closes when the server shuts down', async () => {
  const server = await startHttpServer({ dispatcher: noopDispatcher, port: 0, host: '127.0.0.1' });
  const address = server.address();
  assert(address && typeof address === 'object');
  const port = (address as AddressInfo).port;

  const response = await fetch(`http://127.0.0.1:${port}/mcp/stream?topic=notifications`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/event-stream');

  const reader = response.body?.getReader();
  assert(reader, 'SSE response should expose a readable body');

  const decoder = new TextDecoder();
  let receivedPing = false;
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    if (value) {
      const chunk = decoder.decode(value, { stream: true });
      if (chunk.includes(': ping') || chunk.includes('event: ping')) {
        receivedPing = true;
        break;
      }
    }
  }

  assert(receivedPing, 'expected to observe at least one heartbeat message');

  await Promise.race([
    new Promise<void>((resolve, reject) => {
      server.close((error?: Error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    }),
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error('server close timeout')), 3_000)),
  ]);

  // When the server shuts down, the stream should end without hanging.
  const finalRead = await Promise.race([
    reader.read(),
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('stream close timeout')), 1_000)),
  ]);
  assert.equal(finalRead.done, true);

});
