import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { simpleInterest } from "../../src/domain/interest";
import { rupees } from "../../src/domain/money";
import { clock } from "../../src/lib/clock";
import { prisma } from "../../src/lib/prisma";
import { auth, createLoan, newApi, setupWorld, type World } from "./helpers";

let api: ReturnType<typeof newApi>;
let world: World;

const staff = () => auth(world.tokens.staff);
const manager = () => auth(world.tokens.manager);
const admin = () => auth(world.tokens.admin);
const pay = (loanId: string, amountPaise: bigint | string, key: string) =>
  api.post(`/loans/${loanId}/payments`).set(staff()).set("Idempotency-Key", key).send({ amountPaise: amountPaise.toString() });

beforeAll(async () => {
  api = newApi();
  world = await setupWorld();
});

describe("portfolio dashboard and CSV reconcile with the loans", () => {
  let overdueLoanId: string;

  beforeAll(async () => {
    clock.setToday("2026-01-01");
    await createLoan(api, world.tokens.staff, 20, 100_000);
    overdueLoanId = (await createLoan(api, world.tokens.staff, 20, 50_000, "QUICK", 1)).id;
    const closed = await createLoan(api, world.tokens.staff, 10, 40_000, "QUICK", 1);
    clock.setToday("2026-01-15");
    const due = await api.get(`/loans/${closed.id}/due`).set(staff());
    await pay(closed.id, due.body.totalDuePaise, "close-it-0001");
    await api.post(`/loans/${closed.id}/close`).set(staff());
    await pay(overdueLoanId, rupees(5_000), "partial-0001");
    await createLoan(api, world.tokens.hwhStaff, 20, 70_000);
  });

  beforeEach(() => clock.setToday("2026-03-01"));

  test("dashboard numbers match the underlying loan rows", async () => {
    const dash = (await api.get("/reports/dashboard").set(manager())).body;
    const active = await prisma.loan.findMany({ where: { branchId: world.kol, status: "ACTIVE" } });

    expect(dash.activeLoans).toBe(active.length);
    expect(dash.activeLoans).toBe(2);
    expect(BigInt(dash.totalOutstandingPrincipalPaise)).toBe(active.reduce((s, l) => s + l.outstandingPrincipalPaise, 0n));
    expect(BigInt(dash.interestAccruedTodayPaise)).toBe(
      active.reduce((s, l) => s + simpleInterest(l.outstandingPrincipalPaise, l.annualRateBps, 1), 0n),
    );

    const overdueDue = (await api.get(`/loans/${overdueLoanId}/due`).set(staff())).body;
    expect(dash.overdueCount).toBe(1);
    expect(dash.overdueAmountPaise).toBe(overdueDue.totalDuePaise);
  });

  test("admin sees all branches; manager only their own", async () => {
    const all = (await api.get("/reports/dashboard").set(admin())).body;
    const kol = (await api.get("/reports/dashboard").set(manager())).body;
    const hwh = (await api.get("/reports/dashboard").set(auth(world.tokens.hwhManager))).body;
    expect(all.activeLoans).toBe(kol.activeLoans + hwh.activeLoans);
    expect(BigInt(all.totalOutstandingPrincipalPaise)).toBe(
      BigInt(kol.totalOutstandingPrincipalPaise) + BigInt(hwh.totalOutstandingPrincipalPaise),
    );
    const forced = (await api.get(`/reports/dashboard?branchId=${world.hwh}`).set(manager())).body;
    expect(forced.activeLoans).toBe(kol.activeLoans);
  });

  test("CSV rows and totals equal the dashboard for the same range", async () => {
    const range = "from=2026-01-01&to=2026-03-01";
    const dash = (await api.get(`/reports/dashboard?${range}`).set(manager())).body;
    const res = await api.get(`/reports/loans.csv?${range}`).set(manager());
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");

    const [table, footer] = res.text.split("\n\n");
    const [header, ...rows] = table!.split("\n").map((l) => l.split(","));
    expect(rows).toHaveLength(3);
    const col = (name: string) => header!.indexOf(name);
    const active = rows.filter((r) => r[col("status")] === "ACTIVE");
    expect(active.reduce((s, r) => s + BigInt(r[col("outstanding_principal_paise")]!), 0n).toString()).toBe(
      dash.totalOutstandingPrincipalPaise,
    );

    const totals = Object.fromEntries(footer!.split("\n").slice(1).map((l) => l.split(",")));
    for (const key of ["activeLoans", "totalOutstandingPrincipalPaise", "interestAccruedTodayPaise", "overdueCount", "overdueAmountPaise", "ltvBreachCount"]) {
      expect({ key, value: totals[key] }).toEqual({ key, value: String(dash[key]) });
    }
  });

  test("CSV needs a valid range", async () => {
    expect((await api.get("/reports/loans.csv").set(manager())).status).toBe(400);
    expect((await api.get("/reports/loans.csv?from=2026-03-01&to=2026-01-01").set(manager())).status).toBe(400);
  });
});
