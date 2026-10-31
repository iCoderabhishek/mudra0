import { beforeAll, describe, expect, test } from "bun:test";
import { rupees } from "../../src/domain/money";
import { clock } from "../../src/lib/clock";
import { auth, createLoan, newApi, setupWorld, type World } from "./helpers";

let api: ReturnType<typeof newApi>;
let world: World;

const staff = () => auth(world.tokens.staff);
const manager = () => auth(world.tokens.manager);
const admin = () => auth(world.tokens.admin);
const setRate = (rupeesPerGram: number) =>
  api.post("/gold-rates").set(admin()).send({ ratePaisePerGram: rupees(rupeesPerGram).toString() });

beforeAll(async () => {
  api = newApi();
  world = await setupWorld();
});

describe("LTV breach report", () => {
  test("flags active loans whose current LTV exceeds their slab cap", async () => {
    clock.setToday("2026-01-01");
    const atCap = await createLoan(api, world.tokens.staff, 20, 115_200);
    const safe = await createLoan(api, world.tokens.staff, 20, 60_000);

    expect((await api.get("/reports/ltv-breaches").set(manager())).body.items).toHaveLength(0);
    await setRate(7_000);

    const report = await api.get("/reports/ltv-breaches").set(manager());
    expect(report.body.items.map((r: { id: string }) => r.id)).toEqual([atCap.id]);
    expect(report.body.items[0]).toMatchObject({ currentValuePaise: rupees(140_000).toString(), ltvCapBps: 8000 });
    expect(report.body.items.map((r: { id: string }) => r.id)).not.toContain(safe.id);

    const dash = await api.get("/reports/dashboard").set(manager());
    expect(dash.body.ltvBreachCount).toBe(1);
    expect((await api.get("/reports/ltv-breaches").set(staff())).status).toBe(403);
  });
});
