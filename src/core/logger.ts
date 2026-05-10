type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LOG_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

function resolveMinimumLogLevel(): LogLevel {
  const raw = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_LOG_LEVEL : undefined
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') {
    return raw
  }

  return 'warn'
}

const minimumLogLevel = resolveMinimumLogLevel()

function canLog(level: LogLevel): boolean {
  return LOG_PRIORITY[level] >= LOG_PRIORITY[minimumLogLevel]
}

function formatMessage(level: LogLevel, message: string): string {
  return `[GrayProtocol:${level.toUpperCase()}] ${message}`
}

function normalizeError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    }
  }

  return error
}

export const logger = {
  debug(message: string, context?: unknown): void {
    if (!canLog('debug')) {
      return
    }

    console.debug(formatMessage('debug', message), context)
  },
  info(message: string, context?: unknown): void {
    if (!canLog('info')) {
      return
    }

    console.info(formatMessage('info', message), context)
  },
  warn(message: string, context?: unknown): void {
    if (!canLog('warn')) {
      return
    }

    console.warn(formatMessage('warn', message), context)
  },
  error(message: string, error?: unknown): void {
    if (!canLog('error')) {
      return
    }

    console.error(formatMessage('error', message), normalizeError(error))
  },
}

