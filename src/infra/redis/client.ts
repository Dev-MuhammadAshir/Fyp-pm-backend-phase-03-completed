import Redis from "ioredis";
import { env } from "../../config/env.js";

/**
 * Main app Redis client — sessions (auth:refresh:*) + general use.
 * DB: REDIS_DB (default 0).
 */
export const redis = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  db: env.REDIS_DB,
  ...(env.REDIS_TLS ? { tls: {} } : {}),
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
});

/**
 * Pub/Sub publisher — publishes to rt:events channel.
 * DB: REDIS_DB (default 0).
 */
export const redisPublisher = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  db: env.REDIS_DB,
  ...(env.REDIS_TLS ? { tls: {} } : {}),
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
});

/**
 * Pub/Sub subscriber — subscribes to rt:events channel.
 * DB: REDIS_DB (default 0).
 */
export const redisSubscriber = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  db: env.REDIS_DB,
  ...(env.REDIS_TLS ? { tls: {} } : {}),
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
});

/**
 * JTI blacklist Redis client (R1 / audit NEW-6) — separate DB for eviction
 * isolation. Revoked JTI keys must NEVER be evictable; sharing DB with
 * sessions risks LRU eviction silently re-enabling revoked tokens.
 *
 * Same host/port/password/TLS as `redis`, different `db` index (REDIS_JTI_DB,
 * default 1). Do NOT share with sessions.
 */
export const redisJti = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  db: env.REDIS_JTI_DB,
  ...(env.REDIS_TLS ? { tls: {} } : {}),
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
});

// Attach error handlers so ECONNREFUSED/network errors do not emit uncaught exceptions
const noopErrorHandler = () => {};
redis.on("error", noopErrorHandler);
redisPublisher.on("error", noopErrorHandler);
redisSubscriber.on("error", noopErrorHandler);
redisJti.on("error", noopErrorHandler);
