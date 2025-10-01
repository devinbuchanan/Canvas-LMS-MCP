type FetchRequestInit = globalThis.RequestInit;
type FetchResponse = globalThis.Response;
type FetchHeadersInit = ConstructorParameters<typeof Headers>[0];

export interface CanvasClientOptions {
  /** Canvas instance domain, e.g. `canvas.instructure.com`. Pulled from CANVAS_DOMAIN when omitted. */
  domain?: string;
  /** API access token. Pulled from CANVAS_API_TOKEN when omitted. */
  token?: string;
  /** Maximum number of attempts when retrying failed requests. */
  maxAttempts?: number;
  /** Base delay in milliseconds used when calculating exponential backoff. */
  baseDelayMs?: number;
}

export interface CanvasCourse {
  id: number;
  name: string;
  course_code: string;
  workflow_state?: string;
  account_id?: number;
  term?: {
    id: number;
    name: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface CanvasUser {
  id: number;
  name: string;
  sortable_name?: string;
  short_name?: string;
  login_id?: string;
  email?: string;
  [key: string]: unknown;
}

export interface CanvasAssignment {
  id: number;
  name: string;
  description?: string;
  due_at?: string | null;
  points_possible?: number | null;
  course_id?: number;
  [key: string]: unknown;
}

export class CanvasAPIError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body: string;

  constructor(message: string, status: number, url: string, body: string) {
    super(message);
    this.name = 'CanvasAPIError';
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

interface InternalClientConfig {
  baseUrl: string;
  token: string;
  maxAttempts: number;
  baseDelayMs: number;
}

const API_PREFIX = '/api/v1';
const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 250;

function resolveBaseUrl(domain?: string): string {
  const resolvedDomain = domain ?? process.env.CANVAS_DOMAIN;

  if (!resolvedDomain) {
    throw new Error('Canvas domain was not provided. Set CANVAS_DOMAIN or pass the domain option.');
  }

  const trimmed = resolvedDomain.trim().replace(/\/$/, '');
  return `https://${trimmed}${API_PREFIX}`;
}

function resolveToken(token?: string): string {
  const resolvedToken = token ?? process.env.CANVAS_API_TOKEN;

  if (!resolvedToken) {
    throw new Error(
      'Canvas API token was not provided. Set CANVAS_API_TOKEN or pass the token option when creating the client.',
    );
  }

  return resolvedToken.trim();
}

function createConfig(options: CanvasClientOptions = {}): InternalClientConfig {
  return {
    baseUrl: resolveBaseUrl(options.domain),
    token: resolveToken(options.token),
    maxAttempts: options.maxAttempts ?? DEFAULT_ATTEMPTS,
    baseDelayMs: options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS,
  };
}

function buildUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${normalized}`;
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) {
    return undefined;
  }

  const seconds = Number.parseFloat(header);

  if (!Number.isNaN(seconds)) {
    return seconds * 1000;
  }

  const date = Date.parse(header);

  if (!Number.isNaN(date)) {
    const diff = date - Date.now();
    return diff > 0 ? diff : undefined;
  }

  return undefined;
}

function createDelay(baseDelayMs: number, attempt: number, retryAfter?: number): number {
  if (typeof retryAfter === 'number' && retryAfter > 0) {
    return retryAfter;
  }

  const exponential = baseDelayMs * Math.pow(2, attempt - 1);
  const jitter = Math.random() * 0.25 * exponential;
  return exponential + jitter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface CanvasClient {
  listCourses(perPage?: number): Promise<CanvasCourse[]>;
  getCourse(courseId: number | string): Promise<CanvasCourse>;
  listCourseAssignments(courseId: number | string, perPage?: number): Promise<CanvasAssignment[]>;
  listCourseUsers(
    courseId: number | string,
    options?: { enrollmentType?: string; perPage?: number },
  ): Promise<CanvasUser[]>;
}

export function createCanvasClient(options: CanvasClientOptions = {}): CanvasClient {
  const config = createConfig(options);

  async function _fetch(path: string, init: FetchRequestInit = {}): Promise<FetchResponse> {
    const url = buildUrl(config.baseUrl, path);
    const headers = new Headers(init.headers as FetchHeadersInit | undefined);
    headers.set('Authorization', `Bearer ${config.token}`);
    headers.set('Accept', headers.get('Accept') ?? 'application/json');

    const requestInit: FetchRequestInit = { ...init, headers };

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
      try {
        const response = await fetch(url, requestInit);

        if (response.ok) {
          return response;
        }

        if (attempt < config.maxAttempts && (response.status === 429 || response.status >= 500)) {
          const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
          const delay = createDelay(config.baseDelayMs, attempt, retryAfter);
          await sleep(delay);
          continue;
        }

        const body = await response.text();
        throw new CanvasAPIError(
          `Canvas request to ${url} failed with status ${response.status}.`,
          response.status,
          url,
          body,
        );
      } catch (error) {
        if (error instanceof CanvasAPIError) {
          throw error;
        }

        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt >= config.maxAttempts) {
          const message = `Canvas request to ${url} failed after ${config.maxAttempts} attempts.`;
          throw new CanvasAPIError(message, 0, url, lastError.message ?? '');
        }

        const delay = createDelay(config.baseDelayMs, attempt);
        await sleep(delay);
      }
    }

    const message = `Canvas request to ${buildUrl(config.baseUrl, path)} failed after retries.`;
    throw new CanvasAPIError(message, 0, buildUrl(config.baseUrl, path), lastError?.message ?? '');
  }

  async function parseJson<T>(response: Response): Promise<T> {
    const cloned = response.clone();

    try {
      return (await response.json()) as T;
    } catch (error) {
      const raw = await cloned.text();
      throw new Error(
        `Failed to parse Canvas response as JSON. Received: ${raw.substring(0, 200)}`,
      );
    }
  }

  return {
    async listCourses(perPage = 10): Promise<CanvasCourse[]> {
      const response = await _fetch(`/courses?per_page=${encodeURIComponent(perPage)}`);
      return parseJson<CanvasCourse[]>(response);
    },

    async getCourse(courseId: number | string): Promise<CanvasCourse> {
      const response = await _fetch(`/courses/${encodeURIComponent(courseId.toString())}`);
      return parseJson<CanvasCourse>(response);
    },

    async listCourseAssignments(courseId: number | string, perPage = 10): Promise<CanvasAssignment[]> {
      const response = await _fetch(
        `/courses/${encodeURIComponent(courseId.toString())}/assignments?per_page=${encodeURIComponent(perPage)}`,
      );
      return parseJson<CanvasAssignment[]>(response);
    },

    async listCourseUsers(
      courseId: number | string,
      options?: { enrollmentType?: string; perPage?: number },
    ): Promise<CanvasUser[]> {
      const searchParams = new URLSearchParams();
      const perPage = options?.perPage ?? 10;
      searchParams.set('per_page', perPage.toString());

      if (options?.enrollmentType) {
        searchParams.set('enrollment_type[]', options.enrollmentType);
      }

      const response = await _fetch(
        `/courses/${encodeURIComponent(courseId.toString())}/users?${searchParams.toString()}`,
      );
      return parseJson<CanvasUser[]>(response);
    },
  };
}

export const canvasClient = createCanvasClient();
