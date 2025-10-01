# Canvas LMS MCP Server

A Node.js + TypeScript Model Context Protocol (MCP) server that integrates with the Canvas LMS REST API. The server currently exposes:

- `GET /health` for liveness checks.
- `POST /mcp` to receive JSON-RPC 2.0 requests.
- `GET /mcp/stream` to open a Server-Sent Events (SSE) connection. The endpoint currently
  emits heartbeat pings every 15 seconds and should be treated as a placeholder; clients
  that do not need streaming updates can safely ignore it for now.

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- [npm](https://www.npmjs.com/)

## Environment configuration

Copy the provided `.env.example` file to `.env` and fill in the required values before starting the server:

```bash
cp .env.example .env
```

- **Local development** – keep the `.env` file outside of version control (it's ignored by `.gitignore`) and load the variables when starting the server. You can do this by exporting them in your shell (for example, `set -a && source .env && npm run dev && set +a`) or by using a tool such as [`dotenv-cli`](https://www.npmjs.com/package/dotenv-cli) (`npx dotenv -e .env -- npm run dev`). Store the `.env` file securely and restrict filesystem permissions so only your user can read it.
- **Production** – configure secrets in your process manager, container orchestrator, or hosting platform (for example, systemd units, Docker secrets, or managed secret stores). Avoid committing secrets to the repository or baking them into images; inject them as environment variables at deployment time instead.

### Transport security and rate limiting

The HTTP transport exposes a built-in per-IP rate limiter and an optional shared-secret guard that protects `/mcp` and `/mcp/stream` at the transport layer. Both features are controlled through environment variables so they can be tailored for local development, staging, and production:

| Variable | Default | Description |
| --- | --- | --- |
| `MCP_RATE_LIMIT_ENABLED` | `true` | Enables the in-memory rate limiter. Set to `false` to turn it off entirely. |
| `MCP_RATE_LIMIT_MAX_REQUESTS` | `120` | Maximum requests an individual IP can make within the configured window. |
| `MCP_RATE_LIMIT_WINDOW_MS` | `60000` | Duration of the sliding window, in milliseconds. |
| `MCP_RATE_LIMIT_BYPASS` | `false` | When set to `true`, disables the rate limiter without changing other thresholds—useful for local development. |
| `MCP_TRANSPORT_SECRET` | _(unset)_ | Optional shared secret that clients must present via the transport header. Omit to disable the guard. |
| `MCP_TRANSPORT_SECRET_HEADER` | `x-mcp-transport-secret` | Header name that carries the shared secret when `MCP_TRANSPORT_SECRET` is set. |
| `MCP_TRANSPORT_SECRET_BYPASS` | `false` | Set to `true` to bypass the shared-secret guard even when `MCP_TRANSPORT_SECRET` is defined (for example, during development). |

**Local development** – keep defaults generous by enabling the bypass variables:

```bash
# .env (development)
MCP_RATE_LIMIT_BYPASS=true
MCP_TRANSPORT_SECRET_BYPASS=true
```

With these values, the server skips both the rate limiter and the shared-secret guard so interactive testing is frictionless.

**Production** – leave the bypass flags unset (or `false`) and provide a high-entropy shared secret so only trusted clients can invoke transport endpoints:

```bash
# Environment variables for production deployment
MCP_RATE_LIMIT_ENABLED=true
MCP_RATE_LIMIT_MAX_REQUESTS=300
MCP_RATE_LIMIT_WINDOW_MS=60000
MCP_TRANSPORT_SECRET_HEADER=x-mcp-transport-secret
MCP_TRANSPORT_SECRET=generate-a-random-string-here
```

When the guard is active, requests missing the configured header—or presenting an incorrect value—receive an HTTP 401 response. Exceeding the rate limiter returns HTTP 429 with a `Retry-After` hint so clients can back off gracefully.

## Project Initialization Commands

```bash
npm init -y
npm install express
npm install -D typescript ts-node-dev @types/express @types/node
npx tsc --init --rootDir src --outDir dist --esModuleInterop --module commonjs --resolveJsonModule --strict
mkdir -p src/transports src/tools src/lib .vscode
```

These commands were executed to scaffold the project.

## Development Scripts

- **Install dependencies**

  ```bash
  npm install
  ```

- **Start the development server** (with automatic reloads)

  ```bash
  npm run dev
  ```

  Runs `ts-node-dev` against `src/index.ts`, watching the `src` tree for
  changes and automatically reloading on edits. The command expects a
  TypeScript entry point at `src/index.ts` and relies on the ambient types
  supplied by the `@types/node` and `@types/express` development
  dependencies.

- **Build the project**

  ```bash
  npm run build
  ```

  Compiles the TypeScript sources using the settings in `tsconfig.json`,
  emitting JavaScript to the `dist/` directory. The command assumes the
  TypeScript configuration file is present and that source files live under
  `src/`.

- **Run the compiled server**

  ```bash
  npm start
  ```

  Launches Node.js with the compiled entry point at `dist/index.js`. Run the
  build command first to ensure the `dist/` output exists before starting the
  server in production mode.

- **Run placeholder tests**

  ```bash
  npm test
  ```

## Docker

Build the production image with the included multi-stage Dockerfile. The build
stage compiles the TypeScript sources into `dist/`, and the runtime stage copies
those compiled assets and installs only production dependencies.

```bash
docker build -t canvas-lms-mcp .
```

Run the container by providing the required Canvas credentials as environment
variables. The image launches the compiled server from `dist/index.js` and
listens on port 3000 by default.

```bash
docker run -p 3000:3000 \
  -e CANVAS_DOMAIN=example.instructure.com \
  -e CANVAS_API_TOKEN=your-token \
  canvas-lms-mcp
```

## Project Structure

```
src/
  index.ts           # Entry point
  lib/               # Shared utilities
  tools/             # Future MCP tool registrations
  transports/        # HTTP server implementation
.vscode/             # Editor configuration
```

## Next Steps

- Implement Canvas LMS REST API client tooling under `src/tools`.
- Add SSE support for `/mcp/stream` to push real-time updates.
- Introduce automated tests and linting.
