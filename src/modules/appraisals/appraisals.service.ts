import { requireBranch, type AuthUser } from "../../middleware/auth";
import { appraise, type GoldItemInput } from "../../domain/gold";
import { writeAudit } from "../../lib/audit";
import { notFound } from "../../lib/errors";
import { prisma, type Tx } from "../../lib/prisma";
import { currentRate } from "../gold-rates/gold-rates.service";

// Shared with renewal, which re-appraises the same items inside its own transaction.
export async function insertAppraisal(
  tx: Tx,
  user: AuthUser,
  customerId: string,
  branchId: string,
  items: GoldItemInput[],
) {
  const rate = await currentRate();
  const result = appraise(items, rate.ratePaisePerGram);
  const appraisal = await tx.appraisal.create({
    data: {
      customerId,
      branchId,
      goldRateId: rate.id,
      ratePaisePerGram: rate.ratePaisePerGram,
      totalNetWeightMg: result.totalNetWeightMg,
      appraisedValuePaise: result.appraisedValuePaise,
      maxLoanPaise: result.maxLoanPaise,
      createdById: user.id,
      items: { create: result.items },
    },
    include: { items: true },
  });
  await writeAudit(tx, {
    actorId: user.id,
    action: "APPRAISAL_CREATED",
    entityType: "Appraisal",
    entityId: appraisal.id,
    branchId,
    after: appraisal,
  });
  return appraisal;
}

export async function createAppraisal(user: AuthUser, customerId: string, items: GoldItemInput[]) {
  const branchId = requireBranch(user);
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer || customer.branchId !== branchId) throw notFound("Customer");
  return prisma.$transaction((tx) => insertAppraisal(tx, user, customerId, branchId, items));
}

export async function getAppraisal(user: AuthUser, id: string) {
  const appraisal = await prisma.appraisal.findUnique({
    where: { id },
    include: { items: true, loans: { select: { id: true, status: true } } },
  });
  if (!appraisal || appraisal.branchId !== requireBranch(user)) throw notFound("Appraisal");
  return appraisal;
}
