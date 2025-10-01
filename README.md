# Canvas LMS MCP Server

A Node.js + TypeScript Model Context Protocol (MCP) server that integrates with the Canvas LMS REST API. The server currently exposes:

- `GET /health` for liveness checks.
- `POST /mcp` to receive JSON-RPC 2.0 requests.
- `GET /mcp/stream` as a placeholder for future Server-Sent Events (SSE) streaming.

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- [npm](https://www.npmjs.com/)

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
  changes while ignoring `node_modules`. The command expects a TypeScript
  entry point at `src/index.ts` and relies on the ambient types supplied by
  the `@types/node` and `@types/express` development dependencies.

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
