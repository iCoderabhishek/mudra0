import { describe, expect, test } from "bun:test";
import { allocatePayment, balanceAsOf, simpleInterest } from "../../src/domain/interest";
import { rupees } from "../../src/domain/money";

const terms = { principalPaise: rupees(100_000), annualRateBps: 1800, disbursedOn: "2026-01-01" };

describe("simple interest", () => {
  test("18% on ₹1,00,000 for 30 days, 365-day year", () => {
    // 1,00,00,000 × 0.18 × 30 / 365 = 1,47,945.205 paise → 1,47,945
    expect(simpleInterest(rupees(100_000), 1800, 30)).toBe(147_945n);
  });

  test("full year is exactly the annual rate", () => {
    expect(simpleInterest(rupees(100_000), 1800, 365)).toBe(rupees(18_000));
  });

  test("no interest on the day of disbursal", () => {
    expect(balanceAsOf(terms, [], "2026-01-01").totalDuePaise).toBe(rupees(100_000));
  });
});

describe("balance replay", () => {
  test("accrues on outstanding principal only", () => {
    const payments = [{ paidOn: "2026-01-31", interestPaidPaise: 147_945n, principalPaidPaise: 52_055n }];
    const b = balanceAsOf(terms, payments, "2026-03-02");
    expect(b.outstandingPrincipalPaise).toBe(9_947_945n);
    expect(b.accruedInterestPaise).toBe(147_175n);
  });

  test("unpaid interest carries forward", () => {
    const payments = [{ paidOn: "2026-01-31", interestPaidPaise: 100_000n, principalPaidPaise: 0n }];
    const b = balanceAsOf(terms, payments, "2026-03-02");
    expect(b.outstandingPrincipalPaise).toBe(rupees(100_000));
    expect(b.accruedInterestPaise).toBe(47_945n + 147_945n);
  });

  test("ignores payments after the as-of date", () => {
    const payments = [{ paidOn: "2026-02-15", interestPaidPaise: 1n, principalPaidPaise: 1n }];
    expect(balanceAsOf(terms, payments, "2026-01-31").accruedInterestPaise).toBe(147_945n);
  });

  test("rejects dates before disbursal", () => {
    expect(() => balanceAsOf(terms, [], "2025-12-31")).toThrow("before");
  });
});

describe("payment allocation", () => {
  const balance = balanceAsOf(terms, [], "2026-01-31");

  test("clears interest first", () => {
    expect(allocatePayment(100_000n, balance)).toEqual({ interestPaidPaise: 100_000n, principalPaidPaise: 0n });
  });

  test("remainder goes to principal", () => {
    expect(allocatePayment(rupees(2_000), balance)).toEqual({
      interestPaidPaise: 147_945n,
      principalPaidPaise: rupees(2_000) - 147_945n,
    });
  });

  test("exact total due settles everything", () => {
    const split = allocatePayment(balance.totalDuePaise, balance);
    expect(split.principalPaidPaise).toBe(rupees(100_000));
  });

  test("rejects overpayment and non-positive amounts", () => {
    expect(() => allocatePayment(balance.totalDuePaise + 1n, balance)).toThrow("exceeds");
    expect(() => allocatePayment(0n, balance)).toThrow("positive");
  });
});
