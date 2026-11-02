import { beforeAll, describe, expect, test } from "bun:test";
import { rupees } from "../../src/domain/money";
import { clock } from "../../src/lib/clock";
import { prisma } from "../../src/lib/prisma";
import { auth, createLoan, newApi, setupWorld, type World } from "./helpers";

let api: ReturnType<typeof newApi>;
let world: World;

const staff = () => auth(world.tokens.staff);

beforeAll(async () => {
  api = newApi();
  world = await setupWorld();
});

describe("renewal", () => {
  const renew = (loanId: string, principalRupees: number, tenureMonths = 6) =>
    api.post(`/loans/${loanId}/renew`).set(staff()).send({ scheme: "STANDARD", tenureMonths, principalPaise: rupees(principalRupees).toString() });

  test("closes the old loan and opens a new one on the same gold in one step", async () => {
    clock.setToday("2026-01-01");
    const old = await createLoan(api, world.tokens.staff, 20, 100_000);
    clock.setToday("2026-01-31");

    const res = await renew(old.id, 110_000);
    expect(res.status).toBe(201);
    const payoff = rupees(100_000) + 147_945n;
    expect(res.body.payoffPaise).toBe(payoff.toString());
    expect(res.body.loan).toMatchObject({
      status: "ACTIVE",
      renewedFromId: old.id,
      processingFeePaise: rupees(1_100).toString(),
      renewalPayoffPaise: payoff.toString(),
      netDisbursalPaise: (rupees(110_000) - rupees(1_100) - payoff).toString(),
    });

    const closed = await prisma.loan.findUniqueOrThrow({ where: { id: old.id }, include: { payments: true, goldRelease: true } });
    expect(closed.status).toBe("CLOSED");
    expect(closed.outstandingPrincipalPaise).toBe(0n);
    expect(closed.goldRelease).toBeNull();
    expect(closed.payments.map((p) => p.mode)).toEqual(["RENEWAL"]);

    const newAppraisal = await prisma.appraisal.findUniqueOrThrow({ where: { id: res.body.loan.appraisalId }, include: { items: true } });
    expect(newAppraisal.id).not.toBe(old.appraisalId);
    expect(newAppraisal.items.map((i) => i.netWeightMg)).toEqual([20_000]);

    expect((await renew(old.id, 50_000)).status).toBe(409);
  });

  test("a failed rule leaves the old loan untouched", async () => {
    clock.setToday("2026-01-01");
    const old = await createLoan(api, world.tokens.staff, 20, 100_000);
    clock.setToday("2026-02-01");

    const tooBig = await renew(old.id, 120_000);
    expect(tooBig.body.error.code).toBe("LTV_EXCEEDED");
    const tooSmall = await renew(old.id, 50_000);
    expect(tooSmall.body.error.code).toBe("PRINCIPAL_TOO_SMALL");
    expect((await renew(old.id, 350_000)).body.error.code).toBe("RENEWAL_NEEDS_APPROVAL");

    const row = await prisma.loan.findUniqueOrThrow({ where: { id: old.id }, include: { payments: true } });
    expect(row.status).toBe("ACTIVE");
    expect(row.payments).toHaveLength(0);
    expect(await prisma.loan.count({ where: { renewedFromId: old.id } })).toBe(0);
  });

  test("two renewals at once: one wins", async () => {
    clock.setToday("2026-01-01");
    const old = await createLoan(api, world.tokens.staff, 20, 100_000);
    clock.setToday("2026-01-10");
    const results = await Promise.all([renew(old.id, 110_000), renew(old.id, 105_000)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.loan.count({ where: { renewedFromId: old.id } })).toBe(1);
  });
});
