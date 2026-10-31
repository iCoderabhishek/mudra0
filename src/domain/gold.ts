import { ruleViolation } from "../lib/errors";
import { maxLoanFor } from "./loan-rules";
import { divRoundHalfUp } from "./money";

export const ACCEPTED_KARATS = [18, 20, 22, 24] as const;

export interface GoldItemInput {
  description: string;
  grossWeightMg: number;
  stoneWeightMg: number;
  karat: number;
}

export interface AppraisedItem extends GoldItemInput {
  netWeightMg: number;
  valuePaise: bigint;
}

// value = net grams × (karat / 24) × rate per gram, rounded half-up to the paisa per item.
export function appraiseItem(item: GoldItemInput, ratePaisePerGram: bigint): AppraisedItem {
  if (!ACCEPTED_KARATS.includes(item.karat as (typeof ACCEPTED_KARATS)[number])) {
    throw ruleViolation("INVALID_KARAT", `Karat must be one of ${ACCEPTED_KARATS.join(", ")}`);
  }
  const netWeightMg = item.grossWeightMg - item.stoneWeightMg;
  if (item.stoneWeightMg < 0 || netWeightMg <= 0) {
    throw ruleViolation("INVALID_WEIGHT", "Stone weight must be less than gross weight");
  }
  const valuePaise = divRoundHalfUp(
    BigInt(netWeightMg) * BigInt(item.karat) * ratePaisePerGram,
    24n * 1000n,
  );
  return { ...item, netWeightMg, valuePaise };
}

export function appraise(items: GoldItemInput[], ratePaisePerGram: bigint) {
  const appraised = items.map((item) => appraiseItem(item, ratePaisePerGram));
  const appraisedValuePaise = appraised.reduce((sum, i) => sum + i.valuePaise, 0n);
  return {
    items: appraised,
    totalNetWeightMg: appraised.reduce((sum, i) => sum + i.netWeightMg, 0),
    appraisedValuePaise,
    maxLoanPaise: maxLoanFor(appraisedValuePaise),
  };
}
