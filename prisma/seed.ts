import type { User } from "@prisma/client";
import { addDays, toDbDate } from "../src/domain/dates";
import { rupees } from "../src/domain/money";
import type { AuthUser } from "../src/middleware/auth";
import { clock } from "../src/lib/clock";
import { prisma } from "../src/lib/prisma";
import { redis } from "../src/lib/redis";
import { createAppraisal } from "../src/modules/appraisals/appraisals.service";
import { createCustomer } from "../src/modules/customers/customers.service";
import { invalidateCurrentRate, setRate } from "../src/modules/gold-rates/gold-rates.service";
import { closeLoan, createLoan, getDue } from "../src/modules/loans/loans.service";
import { recordPayment } from "../src/modules/payments/payments.service";

// All people, PANs and Aadhaar numbers below are fictional.
const asActor = ({ id, email, name, role, branchId }: User): AuthUser => ({ id, email, name, role, branchId });

async function main() {
  if ((await prisma.user.count()) > 0) {
    console.log("Seed: data already present, skipping");
    return;
  }
  const realToday = clock.today();
  const daysAgo = (n: number) => addDays(realToday, -n);

  const kol = await prisma.branch.create({ data: { code: "KOL01", name: "Kolkata - College Street" } });
  const hwh = await prisma.branch.create({ data: { code: "HWH01", name: "Howrah - Shibpur" } });

  const mk = (email: string, name: string, role: User["role"], branchId: string | null) =>
    prisma.user.create({ data: { email, name, role, branchId } });
  const admin = await mk("admin@swarnsathi.test", "Asha Admin", "ADMIN", null);
  const manager = asActor(await mk("manager.kolkata@swarnsathi.test", "Biswajit Manager", "MANAGER", kol.id));
  const staff = asActor(await mk("staff.kolkata@swarnsathi.test", "Chandana Staff", "STAFF", kol.id));
  await mk("manager.howrah@swarnsathi.test", "Debasish Manager", "MANAGER", hwh.id);
  const hwhStaff = asActor(await mk("staff.howrah@swarnsathi.test", "Esha Staff", "STAFF", hwh.id));

  const rateHistory = [7_050, 7_080, 7_120, 7_100, 7_150, 7_200];
  for (const [i, rate] of rateHistory.entries()) {
    await prisma.goldRate.create({
      data: {
        ratePaisePerGram: rupees(rate),
        effectiveDate: toDbDate(daysAgo(rateHistory.length - i)),
        setById: admin.id,
      },
    });
  }
  await invalidateCurrentRate();

  const customer = (user: AuthUser, name: string, phone: string, pan: string, aadhaar: string) =>
    createCustomer(user, { name, phone, dateOfBirth: "1980-06-15", address: `${name} residence, West Bengal`, pan, aadhaar });
  const item = (description: string, grams: number, karat: number) => ({
    description,
    grossWeightMg: grams * 1000 + 300,
    stoneWeightMg: 300,
    karat,
  });
  const loanOn = async (user: AuthUser, date: string, customerId: string, items: ReturnType<typeof item>[], principal: number, scheme: "STANDARD" | "QUICK", tenureMonths: number) => {
    clock.setToday(date);
    const appraisal = await createAppraisal(user, customerId, items);
    return createLoan(user, { appraisalId: appraisal.id, scheme, principalPaise: rupees(principal), tenureMonths });
  };
  const payOn = (date: string, loanId: string, amount: bigint, key: string) => {
    clock.setToday(date);
    return recordPayment(staff, loanId, { amountPaise: amount, mode: "CASH", idempotencyKey: key });
  };

  const mita = await customer(staff, "Mita Das", "9830011111", "AAAPD1234K", "111122223333");
  const rahul = await customer(staff, "Rahul Sen", "9830022222", "BBBPS2345L", "222233334444");
  const priya = await customer(staff, "Priya Ghosh", "9830033333", "CCCPG3456M", "333344445555");
  const anil = await customer(staff, "Anil Roy", "9830044444", "DDDPR4567N", "444455556666");
  const sima = await customer(hwhStaff, "Sima Paul", "9830055555", "EEEPP5678P", "555566667777");

  const active = await loanOn(staff, daysAgo(90), mita.id, [item("Gold chain", 30, 22)], 150_000, "STANDARD", 6);
  await payOn(daysAgo(60), active.id, rupees(10_000), "seed-mita-1");
  await payOn(daysAgo(30), active.id, rupees(5_000), "seed-mita-2");

  await loanOn(staff, daysAgo(75), rahul.id, [item("Bangles (pair)", 12, 22)], 60_000, "QUICK", 2);

  const settled = await loanOn(staff, daysAgo(40), anil.id, [item("Ring", 8, 22)], 40_000, "QUICK", 1);
  clock.setToday(daysAgo(20));
  const due = await getDue(staff, settled.id);
  await payOn(daysAgo(20), settled.id, due.totalDuePaise, "seed-anil-1");
  await closeLoan(staff, settled.id);

  await loanOn(staff, realToday, priya.id, [item("Necklace set", 70, 24)], 350_000, "STANDARD", 12);
  await loanOn(hwhStaff, daysAgo(10), sima.id, [item("Earrings", 16, 22)], 80_000, "STANDARD", 3);

  // Today's rate drops, which pushes two active loans over their LTV cap for the breach report.
  clock.setToday(null);
  await setRate(asActor(admin), rupees(6_800));
  console.log(`Seed complete. Logins: ${admin.email}, ${manager.email}, ${staff.email}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await redis?.quit();
  });
