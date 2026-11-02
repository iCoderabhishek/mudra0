import { Redis } from "ioredis";
import { env } from "../config/env";
import { logger } from "./logger";

export const redis = env.REDIS_URL ? new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 }) : null;

redis?.on("error", (err) => logger.warn({ err: err.message }, "redis error"));

export const cache = {
  async get<T>(key: string): Promise<T | null> {
    if (!redis) return null;
    try {
      const raw = await redis.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  async set(key: string, value: unknown, ttlSeconds: number) {
    if (!redis) return;
    try {
      await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
    } catch {
      // Cache is best effort; the database stays the source of truth.
    }
  },
  async del(key: string) {
    if (!redis) return;
    try {
      await redis.del(key);
    } catch {}
  },
};
