import { describe, expect, test } from "bun:test";
import { appraise, appraiseItem } from "../../src/domain/gold";
import {
  isWithinLtv,
  ltvCapBps,
  maturityDate,
  maxLoanFor,
  needsApproval,
  priceLoan,
  processingFee,
} from "../../src/domain/loan-rules";
import { divRoundHalfUp, formatRupees, rupees } from "../../src/domain/money";

const RATE = rupees(7_200);

describe("gold appraisal", () => {
  test("net weight × purity × rate, per item", () => {
    const item = appraiseItem(
      { description: "Chain", grossWeightMg: 10_000, stoneWeightMg: 500, karat: 22 },
      RATE,
    );
    expect(item.netWeightMg).toBe(9_500);
    expect(item.valuePaise).toBe(rupees(62_700));
  });

  test("sums items and derives the max loan", () => {
    const result = appraise(
      [
        { description: "Ring", grossWeightMg: 5_000, stoneWeightMg: 0, karat: 24 },
        { description: "Bangle", grossWeightMg: 20_000, stoneWeightMg: 1_000, karat: 18 },
      ],
      RATE,
    );
    expect(result.totalNetWeightMg).toBe(24_000);
    expect(result.appraisedValuePaise).toBe(rupees(36_000 + 102_600));
    expect(result.maxLoanPaise).toBe((rupees(138_600) * 80n) / 100n);
  });

  test("rejects unsupported karat and impossible weights", () => {
    const base = { description: "x", grossWeightMg: 1_000, stoneWeightMg: 0, karat: 22 };
    expect(() => appraiseItem({ ...base, karat: 14 }, RATE)).toThrow("Karat");
    expect(() => appraiseItem({ ...base, stoneWeightMg: 1_000 }, RATE)).toThrow("Stone");
    expect(() => appraiseItem({ ...base, stoneWeightMg: -1 }, RATE)).toThrow("Stone");
  });
});

describe("LTV slabs", () => {
  test("slab is chosen by principal, boundaries inclusive", () => {
    expect(ltvCapBps(rupees(200_000))).toBe(8000n);
    expect(ltvCapBps(rupees(200_000) + 1n)).toBe(7500n);
    expect(ltvCapBps(rupees(500_000))).toBe(7500n);
    expect(ltvCapBps(rupees(500_000) + 1n)).toBe(7000n);
  });

  test("principal must fit the cap of its own slab", () => {
    expect(isWithinLtv(rupees(200_000), rupees(250_000))).toBe(true);
    expect(isWithinLtv(rupees(200_001), rupees(266_667))).toBe(false);
    expect(isWithinLtv(rupees(210_000), rupees(280_000))).toBe(true);
  });

  test.each([
    [100_000, 80_000],
    [260_000, 200_000],
    [270_000, 202_500],
    [680_000, 500_000],
    [1_000_000, 700_000],
  ])("max loan for value ₹%d is ₹%d", (value, expected) => {
    const max = maxLoanFor(rupees(value));
    expect(max).toBe(rupees(expected));
    expect(isWithinLtv(max, rupees(value))).toBe(true);
  });
});

describe("loan pricing", () => {
  const value = rupees(1_000_000);

  test("fee is 1% with a ₹500 minimum, deducted from disbursal", () => {
    expect(processingFee(rupees(40_000))).toBe(rupees(500));
    expect(processingFee(rupees(100_000))).toBe(rupees(1_000));
    const priced = priceLoan({ scheme: "STANDARD", principalPaise: rupees(100_000), tenureMonths: 6, appraisedValuePaise: value });
    expect(priced.netDisbursalPaise).toBe(rupees(99_000));
    expect(priced.annualRateBps).toBe(1800);
  });

  test("scheme tenure rules", () => {
    const req = { principalPaise: rupees(100_000), appraisedValuePaise: value };
    expect(() => priceLoan({ ...req, scheme: "STANDARD", tenureMonths: 2 })).toThrow("tenure");
    expect(() => priceLoan({ ...req, scheme: "STANDARD", tenureMonths: 13 })).toThrow("tenure");
    expect(() => priceLoan({ ...req, scheme: "QUICK", tenureMonths: 4 })).toThrow("tenure");
    expect(priceLoan({ ...req, scheme: "QUICK", tenureMonths: 3 }).annualRateBps).toBe(1200);
  });

  test("rejects principal over the LTV cap", () => {
    expect(() =>
      priceLoan({ scheme: "STANDARD", principalPaise: rupees(210_000), tenureMonths: 6, appraisedValuePaise: rupees(260_000) }),
    ).toThrow("LTV");
  });

  test("approval needed only above ₹3,00,000", () => {
    expect(needsApproval(rupees(300_000))).toBe(false);
    expect(needsApproval(rupees(300_000) + 1n)).toBe(true);
  });

  test("maturity adds calendar months and clamps month end", () => {
    expect(maturityDate("2026-01-31", 1)).toBe("2026-02-28");
    expect(maturityDate("2026-10-15", 3)).toBe("2027-01-15");
  });
});

describe("money helpers", () => {
  test("half-up rounding", () => {
    expect(divRoundHalfUp(5n, 2n)).toBe(3n);
    expect(divRoundHalfUp(4n, 3n)).toBe(1n);
    expect(divRoundHalfUp(5n, 3n)).toBe(2n);
  });

  test("Indian number formatting", () => {
    expect(formatRupees(rupees(250_000) + 5n)).toBe("₹2,50,000.05");
    expect(formatRupees(99n)).toBe("₹0.99");
  });
});
