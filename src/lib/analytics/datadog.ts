import { isDev } from '@/constants/networks';

/**
 * Console-backed logger with the same surface the app used for its
 * hosted log sink. Context properties are kept so log lines can carry them.
 */
type LogContext = Record<string, unknown>;

const context: LogContext = { 'instance-id': crypto.randomUUID() };

const emit = (
  level: 'info' | 'warn' | 'error',
  message: string,
  metadata?: object,
  error?: Error
) => {
  if (!isDev && level === 'info') return;
  // eslint-disable-next-line no-console
  console[level](message, { ...context, ...(metadata ?? {}) }, error ?? '');
};

export const dd = {
  setContextProperty: (key: string, value: unknown) => {
    context[key] = value;
  },
  getContext: (): LogContext => ({ ...context }),
  info: (message: string, metadata?: object) => emit('info', message, metadata),
  warn: (message: string, metadata?: object, error?: Error) =>
    emit('warn', message, metadata, error),
  error: (message: string, metadata?: object, error?: Error) =>
    emit('error', message, metadata, error),
};
