import { beforeAll, describe, expect, test } from "bun:test";
import { rupees } from "../../src/domain/money";
import { clock } from "../../src/lib/clock";
import { auth, customerBody, goldItems, newApi, setupWorld, type World } from "./helpers";

let api: ReturnType<typeof newApi>;
let world: World;

const staff = () => auth(world.tokens.staff);
const pay = (loanId: string, amountPaise: bigint | string, key: string) =>
  api.post(`/loans/${loanId}/payments`).set(staff()).set("Idempotency-Key", key).send({ amountPaise: amountPaise.toString() });

beforeAll(async () => {
  api = newApi();
  world = await setupWorld();
});

describe("statement and receipt", () => {
  test("printable statement and receipt with escaped content", async () => {
    clock.setToday("2026-01-01");
    const customer = (
      await api.post("/customers").set(staff()).send({ ...customerBody(), name: "<script>x</script> Roy" })
    ).body;
    const appraisal = (await api.post("/appraisals").set(staff()).send({ customerId: customer.id, items: goldItems(20) })).body;
    const loan = (
      await api.post("/loans").set(staff()).send({ appraisalId: appraisal.id, scheme: "STANDARD", tenureMonths: 6, principalPaise: "10000000" })
    ).body;
    clock.setToday("2026-01-31");
    const payment = (await pay(loan.id, rupees(2_000), "receipt-0001")).body.payment;

    const statement = await api.get(`/loans/${loan.id}/statement`).set(staff());
    expect(statement.headers["content-type"]).toContain("text/html");
    expect(statement.text).toContain("&lt;script&gt;");
    expect(statement.text).not.toContain("<script>x");
    expect(statement.text).toContain("₹1,00,000.00");
    expect(statement.text).toContain("₹1,479.45");

    const receipt = await api.get(`/payments/${payment.id}/receipt`).set(staff());
    expect(receipt.text).toContain("₹2,000.00");
    expect(receipt.text).toContain("₹99,479.45");

    expect((await api.get(`/payments/${payment.id}/receipt`).set(auth(world.tokens.hwhStaff))).status).toBe(404);
  });
});
