import type { Scheme } from "@prisma/client";
import { ruleViolation } from "../lib/errors";
import { addMonths } from "./dates";
import { divRoundHalfUp, maxBig, rupees } from "./money";

export const SCHEMES: Record<Scheme, { annualRateBps: number; minTenure: number; maxTenure: number }> = {
  STANDARD: { annualRateBps: 1800, minTenure: 3, maxTenure: 12 },
  QUICK: { annualRateBps: 1200, minTenure: 1, maxTenure: 3 },
};

// Slab is chosen by the requested principal; upTo is inclusive.
const LTV_SLABS = [
  { upTo: rupees(200_000), capBps: 8000n },
  { upTo: rupees(500_000), capBps: 7500n },
  { upTo: null, capBps: 7000n },
] as const;

export const APPROVAL_THRESHOLD = rupees(300_000);
export const MIN_PRINCIPAL = rupees(5_000);
const MIN_PROCESSING_FEE = rupees(500);

export function ltvCapBps(principalPaise: bigint): bigint {
  const slab = LTV_SLABS.find((s) => s.upTo === null || principalPaise <= s.upTo);
  return slab!.capBps;
}

export const isWithinLtv = (principalPaise: bigint, valuePaise: bigint) =>
  principalPaise * 10_000n <= valuePaise * ltvCapBps(principalPaise);

// Largest principal that satisfies the cap of its own slab. This is not
// monotonic in the slab percentage: ₹2,60,000 of gold allows ₹2,00,000
// (slab 1 capped at its upper bound), not 75% = ₹1,95,000.
export function maxLoanFor(valuePaise: bigint): bigint {
  let best = 0n;
  let slabFloor = 0n;
  for (const slab of LTV_SLABS) {
    let cap = (valuePaise * slab.capBps) / 10_000n;
    if (slab.upTo !== null && cap > slab.upTo) cap = slab.upTo;
    if (cap > slabFloor && cap > best) best = cap;
    if (slab.upTo !== null) slabFloor = slab.upTo;
  }
  return best;
}

export const processingFee = (principalPaise: bigint) =>
  maxBig(divRoundHalfUp(principalPaise, 100n), MIN_PROCESSING_FEE);

export const needsApproval = (principalPaise: bigint) => principalPaise > APPROVAL_THRESHOLD;

export const maturityDate = (disbursedOn: string, tenureMonths: number) =>
  addMonths(disbursedOn, tenureMonths);

export interface LoanRequest {
  scheme: Scheme;
  principalPaise: bigint;
  tenureMonths: number;
  appraisedValuePaise: bigint;
  renewalPayoffPaise?: bigint;
}

export function priceLoan(req: LoanRequest) {
  const scheme = SCHEMES[req.scheme];
  if (req.tenureMonths < scheme.minTenure || req.tenureMonths > scheme.maxTenure) {
    throw ruleViolation(
      "INVALID_TENURE",
      `${req.scheme} tenure must be ${scheme.minTenure} to ${scheme.maxTenure} months`,
    );
  }
  if (req.principalPaise < MIN_PRINCIPAL) {
    throw ruleViolation("PRINCIPAL_TOO_SMALL", `Minimum principal is ${MIN_PRINCIPAL} paise`);
  }
  if (!isWithinLtv(req.principalPaise, req.appraisedValuePaise)) {
    throw ruleViolation("LTV_EXCEEDED", "Principal exceeds the LTV cap for its slab", {
      ltvCapBps: Number(ltvCapBps(req.principalPaise)),
      maxLoanPaise: maxLoanFor(req.appraisedValuePaise).toString(),
    });
  }
  const processingFeePaise = processingFee(req.principalPaise);
  const renewalPayoffPaise = req.renewalPayoffPaise ?? 0n;
  const netDisbursalPaise = req.principalPaise - processingFeePaise - renewalPayoffPaise;
  if (netDisbursalPaise < 0n) {
    throw ruleViolation("PRINCIPAL_TOO_SMALL", "Principal does not cover the fee and payoff");
  }
  return {
    annualRateBps: scheme.annualRateBps,
    ltvCapBps: Number(ltvCapBps(req.principalPaise)),
    processingFeePaise,
    renewalPayoffPaise,
    netDisbursalPaise,
  };
}
