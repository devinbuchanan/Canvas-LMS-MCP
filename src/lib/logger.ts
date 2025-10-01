export type LogLevel = 'info' | 'warn' | 'error';

function formatMessage(level: LogLevel, message: string): string {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
}

export const logger = {
  info(message: string, meta?: Record<string, unknown>): void {
    if (meta) {
      console.log(formatMessage('info', message), meta);
    } else {
      console.log(formatMessage('info', message));
    }
  },
  warn(message: string, meta?: Record<string, unknown>): void {
    if (meta) {
      console.warn(formatMessage('warn', message), meta);
    } else {
      console.warn(formatMessage('warn', message));
    }
  },
  error(message: string, meta?: Record<string, unknown>): void {
    if (meta) {
      console.error(formatMessage('error', message), meta);
    } else {
      console.error(formatMessage('error', message));
    }
  },
};
