import { createHttpServer } from './transports/httpServer';
import { logger } from './lib/logger';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const app = createHttpServer();

app.listen(port, () => {
  logger.info(`Canvas LMS MCP server listening on port ${port}`);
});
