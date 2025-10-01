import assert from 'node:assert/strict';
import test from 'node:test';

import { CanvasHttpError, CanvasUserProfile, createCanvasClient } from '../lib/canvas';

type FetchFactory = () => Response | Promise<Response>;

type FetchCall = { input: Parameters<typeof fetch>[0]; init?: Parameters<typeof fetch>[1] };

function createFetchStub(factories: FetchFactory[]) {
  const calls: FetchCall[] = [];

  const stub: typeof fetch = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    calls.push({ input, init });
    const index = Math.min(calls.length - 1, factories.length - 1);
    return await factories[index]();
  };

  return { stub, calls };
}

function jsonResponse(payload: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', headers.get('Content-Type') ?? 'application/json');
  return new Response(JSON.stringify(payload), { ...init, headers });
}

test('getCurrentUser fetches the authenticated profile', async () => {
  const profile: CanvasUserProfile = {
    id: 42,
    name: 'Ada Lovelace',
    short_name: 'Ada',
    sortable_name: 'Lovelace, Ada',
    primary_email: 'ada@example.com',
    login_id: 'ada',
  };

  const { stub, calls } = createFetchStub([() => jsonResponse(profile)]);
  const client = createCanvasClient({
    domain: 'canvas.test',
    token: 'token-123',
    fetchImpl: stub,
    maxRetries: 0,
    timeoutMs: 5_000,
  });

  const result = await client.getCurrentUser();
  assert.deepEqual(result, profile);
  assert.equal(calls.length, 1);

  const firstCall = calls[0];
  const requestUrl = new URL(firstCall.input.toString());
  assert.equal(requestUrl.toString(), 'https://canvas.test/api/v1/users/self/profile');
  const headers = new Headers(firstCall.init?.headers);
  assert.equal(headers.get('Authorization'), 'Bearer token-123');
  assert.equal(headers.get('Accept'), 'application/json');
});

test('listCourses follows pagination via Link headers', async () => {
  const { stub, calls } = createFetchStub([
    () =>
      jsonResponse(
        [
          { id: 1, name: 'Course A', course_code: 'A-1', workflow_state: 'available' },
          { id: 2, name: 'Course B', course_code: 'B-1', workflow_state: 'available' },
        ],
        {
          status: 200,
          headers: {
            Link: '<https://canvas.test/api/v1/courses?page=2&per_page=50>; rel="next"',
          },
        },
      ),
    () =>
      jsonResponse([
        { id: 3, name: 'Course C', course_code: 'C-1', workflow_state: 'available' },
      ]),
  ]);

  const client = createCanvasClient({
    domain: 'canvas.test',
    token: 'token-123',
    fetchImpl: stub,
    maxRetries: 0,
  });

  const courses = await client.listCourses();
  assert.equal(calls.length, 2);
  assert.equal(courses.length, 3);
  assert.deepEqual(
    courses.map((course) => course.id),
    [1, 2, 3],
  );

  const firstUrl = new URL(calls[0].input.toString());
  assert.equal(firstUrl.pathname, '/api/v1/courses');
  assert.equal(firstUrl.searchParams.get('per_page'), '50');
  assert.equal(firstUrl.searchParams.get('enrollment_state'), 'active');
});

test('throws CanvasHttpError with snippet on 401 responses', async () => {
  const { stub } = createFetchStub([
    () => new Response('Unauthorized token', { status: 401 }),
  ]);

  const client = createCanvasClient({
    domain: 'canvas.test',
    token: 'token-123',
    fetchImpl: stub,
    maxRetries: 0,
  });

  await assert.rejects(client.getCurrentUser(), (error: unknown) => {
    assert(error instanceof CanvasHttpError);
    assert.equal(error.status, 401);
    assert.equal(error.bodySnippet, 'Unauthorized token');
    assert.match(error.message, /status 401/);
    return true;
  });
});

test('retries 429 responses using Retry-After and eventually succeeds', async () => {
  let attempts = 0;
  const { stub, calls } = createFetchStub([
    () => {
      attempts += 1;
      return new Response('Rate limited', {
        status: 429,
        headers: { 'Retry-After': '0' },
      });
    },
    () => {
      attempts += 1;
      return jsonResponse([
        { id: 10, name: 'Course Z', course_code: 'Z-1' },
      ]);
    },
  ]);

  const client = createCanvasClient({
    domain: 'canvas.test',
    token: 'token-123',
    fetchImpl: stub,
    maxRetries: 2,
    retryDelayMs: 1,
  });

  const courses = await client.listCourses();
  assert.equal(attempts, 2);
  assert.equal(calls.length, 2);
  assert.equal(courses.length, 1);
  assert.equal(courses[0].id, 10);
});

test('fails fast after exhausting retries on 5xx responses', async () => {
  const body = 'Server exploded'.padEnd(250, '!');
  const { stub } = createFetchStub([
    () => new Response(body, { status: 500 }),
    () => new Response(body, { status: 500 }),
  ]);

  const client = createCanvasClient({
    domain: 'canvas.test',
    token: 'token-123',
    fetchImpl: stub,
    maxRetries: 1,
    retryDelayMs: 0,
  });

  await assert.rejects(client.getCurrentUser(), (error: unknown) => {
    assert(error instanceof CanvasHttpError);
    assert.equal(error.status, 500);
    assert(error.bodySnippet);
    assert(error.bodySnippet.length <= 201);
    assert(error.bodySnippet.endsWith('…'));
    return true;
  });
});
