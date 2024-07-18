import type { TransformableInfo } from 'logform';
import type { Logger } from 'winston';
import { createLogger, format, transports } from 'winston';

export const LOG_LEVELS = [ 'error', 'warn', 'info', 'verbose', 'debug', 'silly' ] as const;

/**
 * Different log levels, from most important to least important.
 */
export type LogLevel = typeof LOG_LEVELS[number];

const loggers: Logger[] = [];

// eslint-disable-next-line import/no-mutable-exports
export let GLOBAL_LOG_LEVEL: LogLevel = 'info';
export function setLogLevel(level: LogLevel): void {
  GLOBAL_LOG_LEVEL = level;
  for (const logger of loggers) {
    logger.level = level;
  }
}

export function getLogger(label: string): Logger {
  const logger = createLogger({
    level: GLOBAL_LOG_LEVEL,
    format: format.combine(
      format.label({ label }),
      format.colorize(),
      format.timestamp(),
      format.metadata({ fillExcept: [ 'level', 'label', 'message' ]}),
      format.printf(
        ({ level: levelInner, message, label: labelInner }: TransformableInfo): string =>
          `[${labelInner}] ${levelInner}: ${message}`,
      ),
    ),
    transports: [ new transports.Console() ],
  });

  loggers.push(logger);

  return logger;
}
