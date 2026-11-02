import { conflict } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { cache } from "../../lib/redis";

const CACHE_KEY = "gold-rate:current";

export interface CurrentRate {
  id: string;
  ratePaisePerGram: bigint;
  effectiveDate: Date;
}

// The latest rate is read on every appraisal and report, so it is cached in Redis
// and dropped from the cache whenever an admin sets a new rate.
export async function currentRate(): Promise<CurrentRate> {
  const cached = await cache.get<{ id: string; ratePaisePerGram: string; effectiveDate: string }>(CACHE_KEY);
  if (cached) {
    return { ...cached, ratePaisePerGram: BigInt(cached.ratePaisePerGram), effectiveDate: new Date(cached.effectiveDate) };
  }
  const rate = await prisma.goldRate.findFirst({ orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  if (!rate) throw conflict("NO_GOLD_RATE", "No gold rate has been set yet");
  await cache.set(
    CACHE_KEY,
    { id: rate.id, ratePaisePerGram: rate.ratePaisePerGram.toString(), effectiveDate: rate.effectiveDate.toISOString() },
    300,
  );
  return { id: rate.id, ratePaisePerGram: rate.ratePaisePerGram, effectiveDate: rate.effectiveDate };
}

export const invalidateCurrentRate = () => cache.del(CACHE_KEY);
