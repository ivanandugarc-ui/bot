/**
 * GUARDIAN BOT - Redis Client
 * Conexión y utilidades de caché
 */

import { Redis } from 'ioredis';
import { logger } from '../utils/logger';

// ================================
// CLIENTE REDIS
// ================================

export const redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
  password: process.env['REDIS_PASSWORD'] ?? undefined,
  tls: process.env['REDIS_TLS'] === 'true' ? {} : undefined,
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => {
    if (times > 10) {
      logger.error('[Redis] No se puede conectar después de 10 intentos');
      return null;
    }
    return Math.min(times * 200, 2000);
  },
  enableOfflineQueue: true,
  lazyConnect: false,
});

redis.on('connect', () => logger.info('[Redis] Conectado'));
redis.on('error', (err) => logger.error('[Redis] Error:', err));
redis.on('reconnecting', () => logger.warn('[Redis] Reconectando...'));

// ================================
// HELPERS TIPADOS
// ================================

const DEFAULT_TTL = parseInt(process.env['CACHE_TTL'] ?? '300');

/**
 * Guardar en caché con TTL automático
 */
export async function cacheSet<T>(
  key: string,
  value: T,
  ttl: number = DEFAULT_TTL
): Promise<void> {
  await redis.setex(key, ttl, JSON.stringify(value));
}

/**
 * Obtener de caché (retorna null si no existe)
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const data = await redis.get(key);
  if (!data) return null;
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

/**
 * Eliminar de caché
 */
export async function cacheDel(...keys: string[]): Promise<void> {
  if (keys.length > 0) await redis.del(...keys);
}

/**
 * Invalidar claves por patrón
 */
export async function cacheInvalidate(pattern: string): Promise<void> {
  const keys = await redis.keys(pattern);
  if (keys.length > 0) await redis.del(...keys);
}

/**
 * Caché con fallback (cache-aside pattern)
 */
export async function cacheWithFallback<T>(
  key: string,
  fallback: () => Promise<T>,
  ttl: number = DEFAULT_TTL
): Promise<T> {
  const cached = await cacheGet<T>(key);
  if (cached !== null) return cached;

  const value = await fallback();
  await cacheSet(key, value, ttl);
  return value;
}

// ================================
// RATE LIMITING EN REDIS
// ================================

/**
 * Incrementa un contador con TTL (para rate limiting)
 * Retorna el número actual de requests
 */
export async function incrementCounter(
  key: string,
  window: number // segundos
): Promise<number> {
  const pipeline = redis.pipeline();
  pipeline.incr(key);
  pipeline.expire(key, window);
  const results = await pipeline.exec();
  return (results?.[0]?.[1] as number) ?? 0;
}

// ================================
// LLAVE PATTERNS
// ================================

export const CacheKeys = {
  guildConfig: (guildId: string) => `config:${guildId}`,
  automodConfig: (guildId: string) => `automod:${guildId}`,
  antiRaidConfig: (guildId: string) => `antiraid:${guildId}`,
  ticketConfig: (guildId: string) => `ticket_config:${guildId}`,
  logConfig: (guildId: string) => `log_config:${guildId}`,
  welcomeConfig: (guildId: string) => `welcome:${guildId}`,
  verificationConfig: (guildId: string) => `verification:${guildId}`,
  userWarnings: (guildId: string, userId: string) => `warnings:${guildId}:${userId}`,
  memberSpam: (guildId: string, userId: string) => `spam:${guildId}:${userId}`,
  memberFlood: (guildId: string, userId: string) => `flood:${guildId}:${userId}`,
  memberMentions: (guildId: string, userId: string) => `mentions:${guildId}:${userId}`,
  raidDetection: (guildId: string) => `raid:${guildId}`,
  commandCooldown: (userId: string, command: string) => `cooldown:${userId}:${command}`,
} as const;
