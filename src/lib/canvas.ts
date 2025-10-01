import { setTimeout as delay } from 'node:timers/promises';

export interface CanvasClientOptions {
  /** Canvas instance domain, e.g. `canvas.instructure.com`. Pulled from CANVAS_DOMAIN when omitted. */
  domain?: string;
  /** API access token. Pulled from CANVAS_API_TOKEN when omitted. */
  token?: string;
  /** Maximum number of retry attempts after the initial request. */
  maxRetries?: number;
  /** Base delay in milliseconds used when calculating retry backoff. */
  retryDelayMs?: number;
  /** Timeout applied to each outbound request, in milliseconds. */
  timeoutMs?: number;
  /** Custom fetch implementation, primarily for testing. */
  fetchImpl?: typeof fetch;
}

export interface CanvasUserProfile {
  id: number;
  name: string;
  short_name?: string;
  sortable_name?: string;
  primary_email?: string;
  login_id?: string;
}

export interface CanvasCourseSummary {
  id: number;
  name: string;
  course_code: string;
  workflow_state?: string;
}

export class CanvasHttpError extends Error {
  readonly status: number;
  readonly url: string;
  readonly bodySnippet?: string;

  constructor(message: string, status: number, url: string, bodySnippet?: string) {
    super(message);
    this.name = 'CanvasHttpError';
    this.status = status;
    this.url = url;
    this.bodySnippet = bodySnippet;
  }
}

export interface CanvasClient {
  /** Fetches the profile of the authenticated user. */
  getCurrentUser(): Promise<CanvasUserProfile>;
  /** Lists active courses for the authenticated user, including pagination. */
  listCourses(): Promise<CanvasCourseSummary[]>;
}

const API_PREFIX = '/api/v1';
const DEFAULT_RETRY_DELAY = 250;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_TIMEOUT = 10_000;
const ERROR_BODY_SNIPPET_LIMIT = 200;

function resolveDomain(rawDomain?: string): string {
  const domain = rawDomain ?? process.env.CANVAS_DOMAIN;

  if (!domain || domain.trim() === '') {
    throw new Error('Canvas domain was not provided. Set CANVAS_DOMAIN or pass the domain option.');
  }

  const normalized = domain.trim().replace(/^https?:\/\//i, '').replace(/\/?$/, '');
  return `https://${normalized}${API_PREFIX}`;
}

function resolveToken(rawToken?: string): string {
  const token = rawToken ?? process.env.CANVAS_API_TOKEN;

  if (!token || token.trim() === '') {
    throw new Error(
      'Canvas API token was not provided. Set CANVAS_API_TOKEN or pass the token option when creating the client.',
    );
  }

  return token.trim();
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) {
    return undefined;
  }

  const seconds = Number.parseFloat(header);
  if (!Number.isNaN(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const timestamp = Date.parse(header);
  if (!Number.isNaN(timestamp)) {
    const diff = timestamp - Date.now();
    return diff > 0 ? diff : undefined;
  }

  return undefined;
}

function calculateBackoff(baseDelay: number, attemptIndex: number, retryAfter?: number): number {
  if (typeof retryAfter === 'number') {
    return retryAfter;
  }

  if (attemptIndex <= 0) {
    return 0;
  }

  const backoff = baseDelay * Math.pow(2, attemptIndex - 1);
  const jitter = Math.random() * 0.25 * backoff;
  return backoff + jitter;
}

function extractSnippet(body: string | null): string | undefined {
  if (!body) {
    return undefined;
  }

  const trimmed = body.trim();
  if (trimmed.length <= ERROR_BODY_SNIPPET_LIMIT) {
    return trimmed;
  }

  return `${trimmed.slice(0, ERROR_BODY_SNIPPET_LIMIT)}…`;
}

function parseLinkHeader(header: string | null): Record<string, string> {
  if (!header) {
    return {};
  }

  return header.split(',').reduce<Record<string, string>>((acc, part) => {
    const segments = part.split(';').map((segment) => segment.trim());

    if (segments.length === 0) {
      return acc;
    }

    const urlPart = segments[0];
    if (!urlPart.startsWith('<') || !urlPart.endsWith('>')) {
      return acc;
    }

    const url = urlPart.slice(1, -1);

    for (let i = 1; i < segments.length; i += 1) {
      const [key, rawValue] = segments[i].split('=').map((value) => value.trim());

      if (key !== 'rel' || !rawValue) {
        continue;
      }

      const value = rawValue.replace(/^"/, '').replace(/"$/, '');
      acc[value] = url;
    }

    return acc;
  }, {});
}

async function readResponseBody(response: Response): Promise<string | null> {
  try {
    return await response.text();
  } catch (error) {
    if (error instanceof Error && error.name === 'TypeError') {
      return null;
    }

    throw error;
  }
}

interface InternalConfig {
  baseUrl: string;
  token: string;
  maxRetries: number;
  retryDelayMs: number;
  timeoutMs: number;
  fetchImpl: typeof fetch;
}

function buildConfig(options: CanvasClientOptions = {}): InternalConfig {
  return {
    baseUrl: resolveDomain(options.domain),
    token: resolveToken(options.token),
    maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
    retryDelayMs: options.retryDelayMs ?? DEFAULT_RETRY_DELAY,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT,
    fetchImpl: options.fetchImpl ?? fetch,
  };
}

function resolveUrl(baseUrl: string, path: string): URL {
  if (/^https?:\/\//i.test(path)) {
    return new URL(path);
  }

  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  return new URL(normalizedPath, normalizedBase);
}

export function createCanvasClient(options: CanvasClientOptions = {}): CanvasClient {
  const config = buildConfig(options);

  async function performRequest(path: string, init: RequestInit = {}): Promise<{ response: Response; url: string }> {
    const targetUrl = resolveUrl(config.baseUrl, path);
    const baseHeaders = new Headers(init.headers);
    baseHeaders.set('Accept', baseHeaders.get('Accept') ?? 'application/json');
    baseHeaders.set('Authorization', `Bearer ${config.token}`);

    for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = config.timeoutMs > 0 ? setTimeout(() => controller.abort(), config.timeoutMs) : null;

      try {
        const headers = new Headers(baseHeaders);
        const response = await config.fetchImpl(targetUrl, {
          ...init,
          method: init.method ?? 'GET',
          headers,
          signal: controller.signal,
        });

        if (response.ok) {
          return { response, url: targetUrl.toString() };
        }

        const shouldRetry =
          attempt < config.maxRetries && (response.status === 429 || response.status >= 500);

        if (!shouldRetry) {
          const body = await readResponseBody(response);
          const snippet = extractSnippet(body);
          const message = `Canvas request to ${targetUrl.toString()} failed with status ${response.status}.`;
          throw new CanvasHttpError(message, response.status, targetUrl.toString(), snippet);
        }

        const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
        const waitMs = calculateBackoff(config.retryDelayMs, attempt + 1, retryAfter);
        await delay(waitMs);
      } catch (error) {
        if (error instanceof CanvasHttpError) {
          throw error;
        }

        const isDomAbort = typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError';
        const aborted = isDomAbort || ((error as Error).name === 'AbortError');
        const shouldRetry = attempt < config.maxRetries;

        if (!shouldRetry) {
          const message = aborted
            ? `Canvas request to ${targetUrl.toString()} timed out after ${config.timeoutMs}ms.`
            : `Canvas request to ${targetUrl.toString()} failed: ${(error as Error).message}`;
          throw new CanvasHttpError(message, 0, targetUrl.toString());
        }

        const waitMs = calculateBackoff(config.retryDelayMs, attempt + 1);
        await delay(waitMs);
      } finally {
        if (timeout) {
          clearTimeout(timeout);
        }
      }
    }

    throw new CanvasHttpError(
      `Canvas request to ${new URL(path, config.baseUrl).toString()} failed after retries.`,
      0,
      new URL(path, config.baseUrl).toString(),
    );
  }

  async function authorizedGetJson<T>(path: string): Promise<{ data: T; linkHeader: string | null }> {
    const { response, url } = await performRequest(path, { method: 'GET' });
    const linkHeader = response.headers.get('link');
    const raw = await response.text();

    try {
      const parsed = raw.length === 0 ? ({} as T) : (JSON.parse(raw) as T);
      return { data: parsed, linkHeader };
    } catch (error) {
      throw new Error(
        `Failed to parse JSON from Canvas response at ${url}: ${(error as Error).message}. Raw snippet: ${raw.slice(0, ERROR_BODY_SNIPPET_LIMIT)}`,
      );
    }
  }

  return {
    async getCurrentUser(): Promise<CanvasUserProfile> {
      const { data } = await authorizedGetJson<CanvasUserProfile>('/users/self/profile');
      return data;
    },

    async listCourses(): Promise<CanvasCourseSummary[]> {
      const courses: CanvasCourseSummary[] = [];
      let nextUrl: string | undefined = '/courses?enrollment_state=active&per_page=50';

      while (nextUrl) {
        const { data, linkHeader } = await authorizedGetJson<CanvasCourseSummary[]>(nextUrl);
        courses.push(...data);

        const links = parseLinkHeader(linkHeader);

        if (links.next) {
          const next = new URL(links.next, config.baseUrl);
          nextUrl = next.pathname + next.search;
        } else {
          nextUrl = undefined;
        }
      }

      return courses;
    },
  };
}

let defaultClient: CanvasClient | null = null;

function getOrCreateDefaultClient(): CanvasClient {
  if (!defaultClient) {
    defaultClient = createCanvasClient();
  }

  return defaultClient;
}

export const canvasClient: CanvasClient = new Proxy({} as CanvasClient, {
  get(_target, property, receiver) {
    const client = getOrCreateDefaultClient();
    const value = Reflect.get(client as unknown as object, property, receiver);

    if (typeof value === 'function') {
      return value.bind(client);
    }

    return value;
  },
  has(_target, property) {
    const client = getOrCreateDefaultClient();
    return property in (client as unknown as object);
  },
  ownKeys() {
    const client = getOrCreateDefaultClient();
    return Reflect.ownKeys(client as unknown as object);
  },
  getOwnPropertyDescriptor(_target, property) {
    const client = getOrCreateDefaultClient();
    return Object.getOwnPropertyDescriptor(client as unknown as object, property);
  },
});
