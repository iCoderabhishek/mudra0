import type { Prisma } from "@prisma/client";
import { requireBranch, type AuthUser } from "../../middleware/auth";
import { toDbDate } from "../../domain/dates";
import { writeAudit } from "../../lib/audit";
import { notFound } from "../../lib/errors";
import { pageArgs, toPage } from "../../lib/pagination";
import { prisma } from "../../lib/prisma";
import type { CreateCustomerInput, SearchCustomersInput } from "./customers.schema";

export async function createCustomer(user: AuthUser, input: CreateCustomerInput) {
  const branchId = requireBranch(user);
  const { aadhaar, dateOfBirth, ...rest } = input;

  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.create({
      data: {
        ...rest,
        dateOfBirth: toDbDate(dateOfBirth),
        aadhaarLast4: aadhaar.slice(-4),
        branchId,
        createdById: user.id,
      },
    });
    await writeAudit(tx, {
      actorId: user.id,
      action: "CUSTOMER_CREATED",
      entityType: "Customer",
      entityId: customer.id,
      branchId,
      after: customer,
    });
    return customer;
  });
}

export async function searchCustomers(user: AuthUser, query: SearchCustomersInput) {
  const where: Prisma.CustomerWhereInput = { branchId: requireBranch(user) };
  if (query.q) {
    where.OR = [
      { name: { contains: query.q, mode: "insensitive" } },
      { phone: { startsWith: query.q } },
      { pan: query.q.toUpperCase() },
    ];
  }
  const rows = await prisma.customer.findMany({ where, ...pageArgs(query) });
  return toPage(rows, query.limit);
}

export async function getCustomer(user: AuthUser, id: string) {
  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      appraisals: { orderBy: { createdAt: "desc" }, take: 20 },
      loans: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!customer || customer.branchId !== requireBranch(user)) throw notFound("Customer");
  return customer;
}
