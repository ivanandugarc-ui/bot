/**
 * GUARDIAN BOT - Prisma Client
 * Singleton del cliente de base de datos
 */

import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'warn' },
    ],
    errorFormat: 'colorless',
  });

if (process.env['NODE_ENV'] !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Logs de Prisma
if (process.env['NODE_ENV'] === 'development') {
  prisma.$on('query', (e) => {
    if (e.duration > 500) {
      logger.warn(`[DB] Query lenta (${e.duration}ms): ${e.query}`);
    }
  });
}

prisma.$on('error', (e) => {
  logger.error('[DB] Error de Prisma:', e);
});

prisma.$on('warn', (e) => {
  logger.warn('[DB] Advertencia de Prisma:', e);
});

// Helper para transacciones
export async function withTransaction<T>(
  fn: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<T>
): Promise<T> {
  return prisma.$transaction(fn, {
    timeout: 10000,
    maxWait: 5000,
  });
}
