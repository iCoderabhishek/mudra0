import { beforeAll, describe, expect, test } from "bun:test";
import { auth, createLoan, createCustomer, newApi, setupWorld, type World } from "./helpers";

let api: ReturnType<typeof newApi>;
let world: World;
let loanId: string;
let customerId: string;

beforeAll(async () => {
  world = await setupWorld();
  api = newApi();
  const loan = await createLoan(api, world.tokens.staff, 100, 350_000);
  loanId = loan.id;
  customerId = loan.customerId;
});

type Who = keyof World["tokens"];

const routes = () => [
  { method: "get", path: "/customers", allowed: ["staff", "manager"] },
  { method: "post", path: "/customers", allowed: ["staff"] },
  { method: "get", path: `/customers/${customerId}`, allowed: ["staff", "manager"] },
  { method: "post", path: "/appraisals", allowed: ["staff"] },
  { method: "get", path: "/loans", allowed: ["staff", "manager"] },
  { method: "post", path: "/loans", allowed: ["staff"] },
  { method: "get", path: `/loans/${loanId}`, allowed: ["staff", "manager"] },
  { method: "get", path: `/loans/${loanId}/due`, allowed: ["staff", "manager"] },
  { method: "post", path: `/loans/${loanId}/payments`, allowed: ["staff"] },
  { method: "post", path: `/loans/${loanId}/close`, allowed: ["staff", "manager"] },
  { method: "get", path: "/approvals", allowed: ["manager"] },
  { method: "post", path: `/loans/${loanId}/approve`, allowed: ["manager"] },
  { method: "post", path: `/loans/${loanId}/reject`, allowed: ["manager"] },
  { method: "get", path: "/users", allowed: ["admin"] },
  { method: "post", path: "/users", allowed: ["admin"] },
  { method: "get", path: "/audit", allowed: ["manager", "admin"] },
  { method: "get", path: "/gold-rates/current", allowed: ["staff", "manager", "admin"] },
];

const send = (method: string, path: string) =>
  method === "get" ? api.get(path) : api.post(path).send({});

describe("role checks on every endpoint", () => {
  test("no token is always 401", async () => {
    for (const r of routes()) {
      const res = await send(r.method, r.path);
      expect({ route: `${r.method} ${r.path}`, status: res.status }).toEqual({ route: `${r.method} ${r.path}`, status: 401 });
    }
  });

  test("roles outside the allow list get 403", async () => {
    const roles: Who[] = ["staff", "manager", "admin"];
    for (const r of routes()) {
      for (const who of roles.filter((x) => !r.allowed.includes(x))) {
        const res = await send(r.method, r.path).set(auth(world.tokens[who]));
        expect({ route: `${r.method} ${r.path}`, who, status: res.status }).toEqual({
          route: `${r.method} ${r.path}`,
          who,
          status: 403,
        });
      }
    }
  });

  test("garbage token is 401", async () => {
    expect((await api.get("/loans").set(auth("not-a-token"))).status).toBe(401);
  });
});

describe("branch isolation", () => {
  test("another branch cannot see or act on this branch's records", async () => {
    const t = world.tokens;
    expect((await api.get(`/loans/${loanId}`).set(auth(t.hwhStaff))).status).toBe(404);
    expect((await api.get(`/customers/${customerId}`).set(auth(t.hwhStaff))).status).toBe(404);
    expect((await api.post(`/loans/${loanId}/approve`).set(auth(t.hwhManager))).status).toBe(404);
    const list = await api.get("/loans").set(auth(t.hwhStaff));
    expect(list.body.items).toHaveLength(0);
  });

  test("staff cannot build a loan on another branch's customer", async () => {
    const hwhCustomer = await createCustomer(api, world.tokens.hwhStaff);
    const res = await api
      .post("/appraisals")
      .set(auth(world.tokens.staff))
      .send({ customerId: hwhCustomer.id, items: [{ description: "Ring", grossWeightMg: 5000, karat: 22 }] });
    expect(res.status).toBe(404);
  });
});
