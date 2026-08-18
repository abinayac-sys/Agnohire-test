import { Redis } from 'ioredis';
import { env } from './env.js';
import { logger } from './logger.js';

/** Shared Redis connection for caching. Bull creates its own connections. */
export const redis = new Redis(env.redisUrl, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
  // In dev, stop retrying immediately if Redis isn't up.
  retryStrategy: env.isProd
    ? (times) => Math.min(times * 200, 3000)
    : (times) => (times > 2 ? null : 200),
});

redis.on('error', (err) => {
  if (!redisAvailable) return; // suppress repeated errors after first failure
  logger.warn(`Redis unavailable — falling back to in-memory store (${err.message})`);
  redisAvailable = false;
});
redis.on('connect', () => {
  redisAvailable = true;
  logger.info('Redis connected');
});

let redisAvailable = false;
export function isRedisAvailable(): boolean {
  return redisAvailable;
}

/**
 * In-memory fallback for the token revocation list used during dev when Redis
 * is not running. NOT safe for production (single-process, no TTL enforcement).
 */
const memRevocationStore = new Map<string, number>(); // key → expiresAt (ms)

function memSet(key: string, _value: string, exSeconds: number): void {
  memRevocationStore.set(key, Date.now() + exSeconds * 1000);
}
function memGet(key: string): string | null {
  const exp = memRevocationStore.get(key);
  if (exp === undefined) return null;
  if (Date.now() > exp) {
    memRevocationStore.delete(key);
    return null;
  }
  return '1';
}
function memDel(key: string): void {
  memRevocationStore.delete(key);
}

/**
 * Thin proxy for Redis that falls back to the in-memory store when Redis is
 * down. Only implements the operations used by the server (get/set-with-EX/del).
 */
export const redisProxy = {
  async get(key: string): Promise<string | null> {
    if (redisAvailable) return redis.get(key);
    return memGet(key);
  },
  async set(key: string, value: string, mode: 'EX', seconds: number): Promise<void> {
    if (redisAvailable) {
      await redis.set(key, value, mode, seconds);
    } else {
      memSet(key, value, seconds);
    }
  },
  async del(key: string): Promise<void> {
    if (redisAvailable) await redis.del(key);
    else memDel(key);
  },
};

export async function connectRedis(): Promise<void> {
  try {
    if (redis.status === 'wait') await redis.connect();
    redisAvailable = true;
  } catch (err) {
    logger.warn(`Redis not available — in-memory fallback active (${(err as Error).message})`);
    redisAvailable = false;
  }
}
