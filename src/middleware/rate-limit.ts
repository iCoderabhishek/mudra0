import { rateLimit } from "express-rate-limit";
import { RedisStore, type RedisReply } from "rate-limit-redis";
import { redis } from "../lib/redis";

const MINUTE = 60_000;

// Uses Redis when available so limits hold across API instances;
// falls back to the in-process store (tests, local runs without Redis).
function store(prefix: string) {
  if (!redis) return undefined;
  const client = redis;
  return new RedisStore({
    prefix: `rl:${prefix}:`,
    sendCommand: (command: string, ...args: string[]) =>
      client.call(command, args) as Promise<RedisReply>,
  });
}

function limiter(prefix: string, windowMs: number, limit: number, keyGenerator?: (req: any) => string) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    store: store(prefix),
    ...(keyGenerator ? { keyGenerator } : {}),
    handler: (_req, res) => {
      res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many requests, try again later" } });
    },
  });
}

const emailKey = (req: { body?: { email?: unknown } }) =>
  `email:${String(req.body?.email ?? "").trim().toLowerCase()}`;

// Created per app instance so each test app starts with clean counters.
export function createLimiters() {
  return {
    api: limiter("api", MINUTE, 300),
    codeRequestByIp: limiter("code-ip", 15 * MINUTE, 20),
    codeRequestByEmail: limiter("code-email", 15 * MINUTE, 3, emailKey),
    codeVerifyByIp: limiter("verify-ip", 15 * MINUTE, 30),
  };
}
