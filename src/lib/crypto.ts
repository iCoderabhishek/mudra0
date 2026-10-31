import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { env } from "../config/env";

export const hmac = (value: string) =>
  createHmac("sha256", env.AUTH_SECRET).update(value).digest("hex");

export const safeEqual = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export const sixDigitCode = () => randomInt(0, 1_000_000).toString().padStart(6, "0");

export const randomToken = () => randomBytes(32).toString("base64url");
