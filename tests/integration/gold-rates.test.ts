import { beforeAll, describe, expect, test } from "bun:test";
import { rupees } from "../../src/domain/money";
import { clock } from "../../src/lib/clock";
import { auth, createLoan, goldItems, newApi, setupWorld, type World } from "./helpers";

let api: ReturnType<typeof newApi>;
let world: World;

const staff = () => auth(world.tokens.staff);
const admin = () => auth(world.tokens.admin);
const setRate = (rupeesPerGram: number) =>
  api.post("/gold-rates").set(admin()).send({ ratePaisePerGram: rupees(rupeesPerGram).toString() });

beforeAll(async () => {
  api = newApi();
  world = await setupWorld();
});

describe("gold rate history", () => {
  test("only admin sets the rate; history is newest first", async () => {
    expect((await api.post("/gold-rates").set(staff()).send({ ratePaisePerGram: "700000" })).status).toBe(403);
    expect((await api.post("/gold-rates").set(admin()).send({ ratePaisePerGram: "0" })).status).toBe(400);
    expect((await setRate(7_300)).status).toBe(201);
    const history = await api.get("/gold-rates").set(staff());
    expect(history.body.items.map((r: { ratePaisePerGram: string }) => r.ratePaisePerGram)).toEqual(["730000", "720000"]);
    expect((await api.get("/gold-rates/current").set(staff())).body.ratePaisePerGram).toBe("730000");
  });

  test("existing appraisals and loans keep the rate they were sanctioned at", async () => {
    clock.setToday("2026-01-01");
    const loan = await createLoan(api, world.tokens.staff, 20, 100_000);
    await setRate(6_000);
    const appraisal = await api.get(`/appraisals/${loan.appraisalId}`).set(staff());
    expect(appraisal.body.ratePaisePerGram).toBe("730000");
    expect(appraisal.body.appraisedValuePaise).toBe(rupees(146_000).toString());

    const fresh = await api.post("/appraisals").set(staff()).send({ customerId: loan.customerId, items: goldItems(20) });
    expect(fresh.body.ratePaisePerGram).toBe("600000");
  });
});
