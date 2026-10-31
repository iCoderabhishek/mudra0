import { ruleViolation } from "../lib/errors";
import { daysBetween } from "./dates";
import { divRoundHalfUp, minBig } from "./money";

export interface LoanTerms {
  principalPaise: bigint;
  annualRateBps: number;
  disbursedOn: string;
}

export interface PaymentEntry {
  paidOn: string;
  interestPaidPaise: bigint;
  principalPaidPaise: bigint;
}

export interface Balance {
  asOf: string;
  outstandingPrincipalPaise: bigint;
  accruedInterestPaise: bigint;
  totalDuePaise: bigint;
}

// Simple interest on a principal for a number of days, 365-day year, rounded half-up.
export const simpleInterest = (principalPaise: bigint, annualRateBps: number, days: number) =>
  divRoundHalfUp(principalPaise * BigInt(annualRateBps) * BigInt(days), 10_000n * 365n);

// Replays the payment history to get the balance on any date. Interest accrues
// in segments between payments (each segment rounded once), so a balance
// computed for a past date always matches what was charged at the time.
export function balanceAsOf(terms: LoanTerms, payments: PaymentEntry[], asOf: string): Balance {
  if (asOf < terms.disbursedOn) {
    throw ruleViolation("DATE_BEFORE_DISBURSAL", "Date is before the loan was disbursed");
  }
  let principal = terms.principalPaise;
  let unpaidInterest = 0n;
  let from = terms.disbursedOn;

  for (const p of payments) {
    if (p.paidOn > asOf) break;
    unpaidInterest += simpleInterest(principal, terms.annualRateBps, daysBetween(from, p.paidOn));
    unpaidInterest -= p.interestPaidPaise;
    principal -= p.principalPaidPaise;
    from = p.paidOn;
  }

  const accrued = unpaidInterest + simpleInterest(principal, terms.annualRateBps, daysBetween(from, asOf));
  return {
    asOf,
    outstandingPrincipalPaise: principal,
    accruedInterestPaise: accrued,
    totalDuePaise: principal + accrued,
  };
}

// Interest first, then principal. Anything above the total due is rejected.
export function allocatePayment(amountPaise: bigint, balance: Balance) {
  if (amountPaise <= 0n) throw ruleViolation("INVALID_AMOUNT", "Payment must be positive");
  if (amountPaise > balance.totalDuePaise) {
    throw ruleViolation("OVERPAYMENT", "Payment exceeds the total due", {
      totalDuePaise: balance.totalDuePaise.toString(),
    });
  }
  const interestPaidPaise = minBig(amountPaise, balance.accruedInterestPaise);
  return { interestPaidPaise, principalPaidPaise: amountPaise - interestPaidPaise };
}
