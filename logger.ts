/**
 * GUARDIAN BOT - Logger
 * Sistema de logs con Winston + rotación de archivos
 */

import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';

const { combine, timestamp, colorize, printf, errors, json } = winston.format;

const isDev = process.env['NODE_ENV'] !== 'production';

// Formato para consola (legible)
const consoleFormat = printf(({ level, message, timestamp: ts, stack, ...meta }) => {
  let log = `${ts} [${level}]: ${message}`;
  if (stack) log += `\n${stack}`;
  if (Object.keys(meta).length > 0) log += `\n${JSON.stringify(meta, null, 2)}`;
  return log;
});

// Transports
const transports: winston.transport[] = [
  new winston.transports.Console({
    format: combine(
      colorize({ all: true }),
      timestamp({ format: 'HH:mm:ss' }),
      consoleFormat
    ),
    level: isDev ? 'debug' : 'info',
  }),
];

// Logs en archivo en producción
if (process.env['LOG_TO_FILE'] === 'true' || !isDev) {
  const logsDir = path.join(process.cwd(), 'logs');

  transports.push(
    new DailyRotateFile({
      dirname: logsDir,
      filename: 'guardian-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: process.env['LOG_MAX_SIZE'] ?? '10m',
      maxFiles: process.env['LOG_MAX_FILES'] ?? '7d',
      level: 'info',
      format: combine(timestamp(), errors({ stack: true }), json()),
    }),
    new DailyRotateFile({
      dirname: logsDir,
      filename: 'guardian-error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: process.env['LOG_MAX_SIZE'] ?? '10m',
      maxFiles: process.env['LOG_MAX_FILES'] ?? '30d',
      level: 'error',
      format: combine(timestamp(), errors({ stack: true }), json()),
    })
  );
}

export const logger = winston.createLogger({
  level: process.env['LOG_LEVEL'] ?? 'info',
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' })
  ),
  transports,
  exitOnError: false,
});

// Helper para logs específicos de módulos
export function createModuleLogger(module: string) {
  return {
    debug: (msg: string, meta?: object) => logger.debug(`[${module}] ${msg}`, meta),
    info: (msg: string, meta?: object) => logger.info(`[${module}] ${msg}`, meta),
    warn: (msg: string, meta?: object) => logger.warn(`[${module}] ${msg}`, meta),
    error: (msg: string, error?: unknown, meta?: object) => {
      if (error instanceof Error) {
        logger.error(`[${module}] ${msg}`, { error: error.message, stack: error.stack, ...meta });
      } else {
        logger.error(`[${module}] ${msg}`, { error, ...meta });
      }
    },
  };
}
