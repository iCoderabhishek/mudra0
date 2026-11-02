import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { rupees } from "../../src/domain/money";
import { clock } from "../../src/lib/clock";
import { prisma } from "../../src/lib/prisma";
import {
  auth,
  createAppraisal,
  createCustomer,
  createLoan,
  customerBody,
  newApi,
  RATE,
  setupWorld,
  type World,
} from "./helpers";

let api: ReturnType<typeof newApi>;
let world: World;

beforeAll(async () => {
  world = await setupWorld();
  api = newApi();
});

beforeEach(() => clock.setToday("2026-01-01"));

const staff = () => auth(world.tokens.staff);
const pay = (loanId: string, amountPaise: bigint | string, key: string) =>
  api.post(`/loans/${loanId}/payments`).set(staff()).set("Idempotency-Key", key).send({ amountPaise: amountPaise.toString() });

describe("customers", () => {
  test("stores only the last 4 Aadhaar digits", async () => {
    const res = await api.post("/customers").set(staff()).send({ ...customerBody(), aadhaar: "987654321234" });
    expect(res.status).toBe(201);
    expect(res.body.aadhaarLast4).toBe("1234");
    expect(JSON.stringify(res.body)).not.toContain("987654321234");
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: res.body.id } });
    expect(JSON.stringify(audit.after)).not.toContain("987654321234");
  });

  test("validates PAN and rejects duplicates", async () => {
    const bad = await api.post("/customers").set(staff()).send({ ...customerBody(), pan: "ABC1234567" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details[0].path).toBe("pan");

    const body = { ...customerBody(), pan: "pqrst9876z" };
    expect((await api.post("/customers").set(staff()).send(body)).status).toBe(201);
    expect((await api.post("/customers").set(staff()).send(body)).status).toBe(409);
  });

  test("search by partial name and phone, paginated", async () => {
    await api.post("/customers").set(staff()).send({ ...customerBody(), name: "Subhankar Ghosh", phone: "9123456789" });
    const byName = await api.get("/customers?q=ankar").set(staff());
    expect(byName.body.items.map((c: { name: string }) => c.name)).toContain("Subhankar Ghosh");
    const byPhone = await api.get("/customers?q=91234").set(staff());
    expect(byPhone.body.items).toHaveLength(1);

    const page = await api.get("/customers?limit=1").set(staff());
    expect(page.body.items).toHaveLength(1);
    const next = await api.get(`/customers?limit=1&cursor=${page.body.nextCursor}`).set(staff());
    expect(next.body.items[0].id).not.toBe(page.body.items[0].id);
  });
});

describe("appraisal", () => {
  test("snapshots values and the rate used", async () => {
    const customer = await createCustomer(api, world.tokens.staff);
    const res = await api
      .post("/appraisals")
      .set(staff())
      .send({
        customerId: customer.id,
        items: [
          { description: "Chain", grossWeightMg: 10_000, stoneWeightMg: 500, karat: 22 },
          { description: "Ring", grossWeightMg: 5_000, karat: 24 },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.ratePaisePerGram).toBe(RATE.toString());
    expect(res.body.totalNetWeightMg).toBe(14_500);
    expect(res.body.appraisedValuePaise).toBe(rupees(62_700 + 36_000).toString());
    expect(res.body.maxLoanPaise).toBe(((rupees(98_700) * 8n) / 10n).toString());
  });

  test("rejects bad karat and stone heavier than gross", async () => {
    const customer = await createCustomer(api, world.tokens.staff);
    const send = (item: object) => api.post("/appraisals").set(staff()).send({ customerId: customer.id, items: [item] });
    expect((await send({ description: "Ring", grossWeightMg: 5000, karat: 14 })).status).toBe(400);
    expect((await send({ description: "Ring", grossWeightMg: 5000, stoneWeightMg: 5000, karat: 22 })).status).toBe(400);
  });

  test("is immutable in the database", async () => {
    const customer = await createCustomer(api, world.tokens.staff);
    const appraisal = await createAppraisal(api, world.tokens.staff, customer.id, 10);
    await expect(Promise.resolve(prisma.appraisal.update({ where: { id: appraisal.id }, data: { maxLoanPaise: 1n } }))).rejects.toThrow();
    await expect(Promise.resolve(prisma.appraisalItem.deleteMany({ where: { appraisalId: appraisal.id } }))).rejects.toThrow();
  });
});

describe("loan sanction", () => {
  test("small loan is active at once with fee deducted", async () => {
    const loan = await createLoan(api, world.tokens.staff, 20, 100_000);
    expect(loan.status).toBe("ACTIVE");
    expect(loan.processingFeePaise).toBe(rupees(1_000).toString());
    expect(loan.netDisbursalPaise).toBe(rupees(99_000).toString());
    expect(loan.ltvCapBps).toBe(8000);
    expect(loan.maturityDate.slice(0, 10)).toBe("2026-07-01");
  });

  test("enforces LTV, scheme tenure and one loan per appraisal", async () => {
    const customer = await createCustomer(api, world.tokens.staff);
    const appraisal = await createAppraisal(api, world.tokens.staff, customer.id, 20);
    const send = (body: object) =>
      api.post("/loans").set(staff()).send({ appraisalId: appraisal.id, scheme: "STANDARD", tenureMonths: 6, ...body });

    const over = await send({ principalPaise: rupees(115_201).toString() });
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe("LTV_EXCEEDED");

    const quick = await send({ scheme: "QUICK", tenureMonths: 4, principalPaise: rupees(50_000).toString() });
    expect(quick.body.error.code).toBe("INVALID_TENURE");

    expect((await send({ principalPaise: rupees(115_200).toString() })).status).toBe(201);
    const again = await send({ principalPaise: rupees(10_000).toString() });
    expect(again.status).toBe(409);
  });
});

describe("approvals", () => {
  test("loan above ₹3,00,000 waits for a manager", async () => {
    const loan = await createLoan(api, world.tokens.staff, 100, 350_000);
    expect(loan.status).toBe("PENDING_APPROVAL");
    expect(loan.disbursedOn).toBeNull();

    const queue = await api.get("/approvals").set(auth(world.tokens.manager));
    expect(queue.body.items.map((l: { id: string }) => l.id)).toContain(loan.id);
    expect((await pay(loan.id, 100n, "pending-key-1")).status).toBe(409);

    clock.setToday("2026-01-05");
    const approved = await api.post(`/loans/${loan.id}/approve`).set(auth(world.tokens.manager));
    expect(approved.status).toBe(200);
    expect(approved.body.disbursedOn.slice(0, 10)).toBe("2026-01-05");
    expect((await api.post(`/loans/${loan.id}/approve`).set(auth(world.tokens.manager2))).status).toBe(409);
  });

  test("two managers approving at once: exactly one wins", async () => {
    const loan = await createLoan(api, world.tokens.staff, 100, 320_000);
    const results = await Promise.all([
      api.post(`/loans/${loan.id}/approve`).set(auth(world.tokens.manager)),
      api.post(`/loans/${loan.id}/approve`).set(auth(world.tokens.manager2)),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const approvals = await prisma.auditLog.count({ where: { entityId: loan.id, action: "LOAN_APPROVED" } });
    expect(approvals).toBe(1);
  });

  test("the creator cannot approve their own loan", async () => {
    const loan = await createLoan(api, world.tokens.staff, 100, 320_000);
    await prisma.loan.update({ where: { id: loan.id }, data: { createdById: world.users.manager.id } });
    const res = await api.post(`/loans/${loan.id}/approve`).set(auth(world.tokens.manager));
    expect(res.status).toBe(403);
  });

  test("rejection frees the appraisal for a new loan", async () => {
    const loan = await createLoan(api, world.tokens.staff, 100, 320_000);
    const rejected = await api.post(`/loans/${loan.id}/reject`).set(auth(world.tokens.manager)).send({ reason: "Documents incomplete" });
    expect(rejected.body.status).toBe("REJECTED");
    const retry = await api
      .post("/loans")
      .set(staff())
      .send({ appraisalId: loan.appraisalId, scheme: "STANDARD", tenureMonths: 6, principalPaise: rupees(200_000).toString() });
    expect(retry.status).toBe(201);
  });
});

describe("repayment and closure", () => {
  test("full lifecycle: interest first, idempotent retry, closure with gold release", async () => {
    const loan = await createLoan(api, world.tokens.staff, 20, 100_000);

    clock.setToday("2026-01-31");
    const due = await api.get(`/loans/${loan.id}/due`).set(staff());
    expect(due.body).toMatchObject({ accruedInterestPaise: "147945", outstandingPrincipalPaise: "10000000" });

    const first = await pay(loan.id, rupees(2_000), "pay-0001-abc");
    expect(first.status).toBe(201);
    expect(first.body.payment).toMatchObject({ interestPaidPaise: "147945", principalPaidPaise: "52055" });

    const retry = await pay(loan.id, rupees(2_000), "pay-0001-abc");
    expect(retry.status).toBe(200);
    expect(retry.body.payment.id).toBe(first.body.payment.id);
    expect((await pay(loan.id, rupees(3_000), "pay-0001-abc")).status).toBe(409);
    expect(await prisma.payment.count({ where: { loanId: loan.id } })).toBe(1);

    const past = await api.get(`/loans/${loan.id}/due?date=2026-01-15`).set(staff());
    expect(past.body).toMatchObject({ accruedInterestPaise: "69041", outstandingPrincipalPaise: "10000000" });

    clock.setToday("2026-03-02");
    const detail = await api.get(`/loans/${loan.id}`).set(staff());
    expect(detail.body.balance.accruedInterestPaise).toBe("147175");
    expect(detail.body.payments).toHaveLength(1);

    const total = BigInt(detail.body.balance.totalDuePaise);
    const over = await pay(loan.id, total + 1n, "pay-0002-abc");
    expect(over.body.error.code).toBe("OVERPAYMENT");

    const early = await api.post(`/loans/${loan.id}/close`).set(staff());
    expect(early.body.error.code).toBe("OUTSTANDING_NOT_ZERO");

    expect((await pay(loan.id, total, "pay-0003-abc")).status).toBe(201);
    const closed = await api.post(`/loans/${loan.id}/close`).set(staff());
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe("CLOSED");
    expect(closed.body.goldRelease.releasedById).toBe(world.users.staff.id);
    expect(closed.body.goldRelease.items).toHaveLength(1);

    expect((await pay(loan.id, 100n, "pay-0004-abc")).status).toBe(409);
    expect((await api.post(`/loans/${loan.id}/close`).set(staff())).status).toBe(409);

    const actions = (await prisma.auditLog.findMany({ where: { branchId: world.kol } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["CUSTOMER_CREATED", "APPRAISAL_CREATED", "LOAN_CREATED", "PAYMENT_RECORDED", "LOAN_CLOSED"]));
  });

  test("overdue once past maturity with money still owed", async () => {
    const loan = await createLoan(api, world.tokens.staff, 20, 50_000, "QUICK", 1);
    clock.setToday("2026-02-01");
    expect((await api.get(`/loans/${loan.id}`).set(staff())).body.overdue).toBe(false);
    clock.setToday("2026-02-02");
    expect((await api.get(`/loans/${loan.id}`).set(staff())).body.overdue).toBe(true);
    const list = await api.get("/loans?overdue=true").set(staff());
    expect(list.body.items.map((l: { id: string }) => l.id)).toContain(loan.id);
  });
});

describe("concurrency", () => {
  test("same idempotency key sent five times at once records one payment", async () => {
    const loan = await createLoan(api, world.tokens.staff, 20, 100_000);
    clock.setToday("2026-01-10");
    const results = await Promise.all(Array.from({ length: 5 }, () => pay(loan.id, rupees(1_000), "double-click-1")));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.every((r) => r.status === 201 || r.status === 200)).toBe(true);
    expect(await prisma.payment.count({ where: { loanId: loan.id } })).toBe(1);
  });

  test("two clerks settling the same loan at once cannot overpay it", async () => {
    const loan = await createLoan(api, world.tokens.staff, 20, 100_000);
    clock.setToday("2026-01-20");
    const due = await api.get(`/loans/${loan.id}/due`).set(staff());
    const total = due.body.totalDuePaise;
    const results = await Promise.all([
      pay(loan.id, total, "clerk-a-0001"),
      api.post(`/loans/${loan.id}/payments`).set(auth(world.tokens.staff2)).set("Idempotency-Key", "clerk-b-0001").send({ amountPaise: total }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
    const row = await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } });
    expect(row.outstandingPrincipalPaise).toBe(0n);
  });

  test("payment requires an idempotency key", async () => {
    const loan = await createLoan(api, world.tokens.staff, 20, 100_000);
    const res = await api.post(`/loans/${loan.id}/payments`).set(staff()).send({ amountPaise: "1000" });
    expect(res.status).toBe(400);
  });
});

describe("audit trail", () => {
  test("cannot be edited or deleted, even directly in the database", async () => {
    await createCustomer(api, world.tokens.staff);
    await expect(Promise.resolve(prisma.auditLog.updateMany({ data: { action: "TAMPERED" } }))).rejects.toThrow();
    await expect(Promise.resolve(prisma.auditLog.deleteMany({}))).rejects.toThrow();
  });

  test("manager sees only their branch", async () => {
    await createCustomer(api, world.tokens.hwhStaff);
    const res = await api.get("/audit?limit=100").set(auth(world.tokens.manager));
    expect(res.status).toBe(200);
    expect(res.body.items.every((a: { branchId: string }) => a.branchId === world.kol)).toBe(true);
  });
});

describe("error responses", () => {
  test("malformed JSON gets a clean 400 without internals", async () => {
    const res = await api.post("/customers").set(staff()).set("Content-Type", "application/json").send("{bad");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_JSON");
    expect(JSON.stringify(res.body)).not.toContain("at ");
  });
});
