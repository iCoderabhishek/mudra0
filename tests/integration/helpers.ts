import type { Role, User } from "@prisma/client";
import supertest from "supertest";
import { createApp } from "../../src/app";
import { rupees } from "../../src/domain/money";
import { hmac, randomToken } from "../../src/lib/crypto";
import { clock } from "../../src/lib/clock";
import { prisma } from "../../src/lib/prisma";

export const RATE = rupees(7_200);

export const newApi = () => supertest(createApp());

export async function resetDb() {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL must be set; refusing to wipe another database");
  clock.setToday(null);
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(
    `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`,
  );
}

export interface World {
  kol: string;
  hwh: string;
  users: Record<"admin" | "staff" | "staff2" | "manager" | "manager2" | "hwhStaff" | "hwhManager", User>;
  tokens: Record<keyof World["users"], string>;
}

async function user(email: string, role: Role, branchId: string | null) {
  return prisma.user.create({ data: { email, name: email.split("@")[0]!, role, branchId } });
}

export async function tokenFor(userId: string) {
  const token = randomToken();
  await prisma.session.create({
    data: { tokenHash: hmac(token), userId, expiresAt: new Date(Date.now() + 3_600_000) },
  });
  return token;
}

export async function setupWorld(): Promise<World> {
  await resetDb();
  const kol = (await prisma.branch.create({ data: { code: "KOL01", name: "Kolkata" } })).id;
  const hwh = (await prisma.branch.create({ data: { code: "HWH01", name: "Howrah" } })).id;
  const users = {
    admin: await user("admin@test.in", "ADMIN", null),
    staff: await user("staff@test.in", "STAFF", kol),
    staff2: await user("staff2@test.in", "STAFF", kol),
    manager: await user("manager@test.in", "MANAGER", kol),
    manager2: await user("manager2@test.in", "MANAGER", kol),
    hwhStaff: await user("staff@hwh.test.in", "STAFF", hwh),
    hwhManager: await user("manager@hwh.test.in", "MANAGER", hwh),
  };
  await prisma.goldRate.create({
    data: { ratePaisePerGram: RATE, effectiveDate: new Date("2026-01-01"), setById: users.admin.id },
  });
  const tokens = {} as World["tokens"];
  for (const [key, u] of Object.entries(users)) tokens[key as keyof World["users"]] = await tokenFor(u.id);
  return { kol, hwh, users, tokens };
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

let panCounter = 1000;
export const nextPan = () => `ABCDE${panCounter++}F`;

export const customerBody = () => ({
  name: "Mita Das",
  phone: "9830012345",
  dateOfBirth: "1985-04-12",
  address: "12 College Street, Kolkata",
  pan: nextPan(),
  aadhaar: "123456789012",
});

// 24K, net grams given → value = grams × ₹7,200
export const goldItems = (grams: number) => [
  { description: "Necklace", grossWeightMg: grams * 1000 + 500, stoneWeightMg: 500, karat: 24 },
];

export async function createCustomer(api: ReturnType<typeof newApi>, token: string) {
  const res = await api.post("/customers").set(auth(token)).send(customerBody());
  if (res.status !== 201) throw new Error(`customer: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

export async function createAppraisal(api: ReturnType<typeof newApi>, token: string, customerId: string, grams: number) {
  const res = await api.post("/appraisals").set(auth(token)).send({ customerId, items: goldItems(grams) });
  if (res.status !== 201) throw new Error(`appraisal: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

export async function createLoan(
  api: ReturnType<typeof newApi>,
  token: string,
  grams: number,
  principalRupees: number,
  scheme: "STANDARD" | "QUICK" = "STANDARD",
  tenureMonths = 6,
) {
  const customer = await createCustomer(api, token);
  const appraisal = await createAppraisal(api, token, customer.id, grams);
  const res = await api
    .post("/loans")
    .set(auth(token))
    .send({ appraisalId: appraisal.id, scheme, principalPaise: rupees(principalRupees).toString(), tenureMonths });
  if (res.status !== 201) throw new Error(`loan: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}
