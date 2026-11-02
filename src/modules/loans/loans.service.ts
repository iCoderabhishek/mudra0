import type { Appraisal, Prisma } from "@prisma/client";
import { requireBranch, type AuthUser } from "../../middleware/auth";
import { toDbDate } from "../../domain/dates";
import { maturityDate, needsApproval, priceLoan } from "../../domain/loan-rules";
import { writeAudit } from "../../lib/audit";
import { clock } from "../../lib/clock";
import { conflict, forbidden, notFound, ruleViolation } from "../../lib/errors";
import { pageArgs, toPage } from "../../lib/pagination";
import { lockLoan, prisma, type Tx } from "../../lib/prisma";
import { isOverdue, loanBalance, paymentOrder } from "./loan-balance";
import type { CreateLoanInput, ListLoansInput, LoanTermsInput } from "./loans.schema";

// Shared with renewal so both paths apply exactly the same rules.
export async function insertLoan(
  tx: Tx,
  user: AuthUser,
  appraisal: Appraisal,
  terms: LoanTermsInput,
  renewal?: { fromLoanId: string; payoffPaise: bigint },
) {
  const priced = priceLoan({
    ...terms,
    appraisedValuePaise: appraisal.appraisedValuePaise,
    renewalPayoffPaise: renewal?.payoffPaise,
  });
  const inUse = await tx.loan.findFirst({
    where: { appraisalId: appraisal.id, status: { not: "REJECTED" } },
    select: { id: true },
  });
  if (inUse) throw conflict("APPRAISAL_IN_USE", "This appraisal already backs a loan");

  const today = clock.today();
  const pending = needsApproval(terms.principalPaise);
  const loan = await tx.loan.create({
    data: {
      branchId: appraisal.branchId,
      customerId: appraisal.customerId,
      appraisalId: appraisal.id,
      scheme: terms.scheme,
      principalPaise: terms.principalPaise,
      tenureMonths: terms.tenureMonths,
      ...priced,
      outstandingPrincipalPaise: terms.principalPaise,
      status: pending ? "PENDING_APPROVAL" : "ACTIVE",
      disbursedOn: pending ? null : toDbDate(today),
      maturityDate: pending ? null : toDbDate(maturityDate(today, terms.tenureMonths)),
      createdById: user.id,
      renewedFromId: renewal?.fromLoanId ?? null,
    },
  });
  await writeAudit(tx, {
    actorId: user.id,
    action: renewal ? "LOAN_RENEWED_INTO" : "LOAN_CREATED",
    entityType: "Loan",
    entityId: loan.id,
    branchId: loan.branchId,
    after: loan,
  });
  return loan;
}

export async function createLoan(user: AuthUser, input: CreateLoanInput) {
  const branchId = requireBranch(user);
  const { appraisalId, ...terms } = input;
  const appraisal = await prisma.appraisal.findUnique({ where: { id: appraisalId } });
  if (!appraisal || appraisal.branchId !== branchId) throw notFound("Appraisal");
  return prisma.$transaction((tx) => insertLoan(tx, user, appraisal, terms));
}

export async function listLoans(user: AuthUser, query: ListLoansInput) {
  const where: Prisma.LoanWhereInput = { branchId: requireBranch(user) };
  if (query.status) where.status = query.status;
  if (query.customerId) where.customerId = query.customerId;
  if (query.overdue) {
    where.status = "ACTIVE";
    where.maturityDate = { lt: toDbDate(clock.today()) };
    where.outstandingPrincipalPaise = { gt: 0 };
  }
  const rows = await prisma.loan.findMany({
    where,
    include: { customer: { select: { id: true, name: true, phone: true } } },
    ...pageArgs(query),
  });
  return toPage(rows, query.limit);
}

async function findInBranch(user: AuthUser, id: string) {
  const loan = await prisma.loan.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, phone: true, pan: true } },
      appraisal: { include: { items: true } },
      payments: { orderBy: paymentOrder },
      goldRelease: true,
    },
  });
  if (!loan || loan.branchId !== requireBranch(user)) throw notFound("Loan");
  return loan;
}

export async function getLoan(user: AuthUser, id: string) {
  const loan = await findInBranch(user, id);
  const today = clock.today();
  if (!loan.disbursedOn) return { ...loan, balance: null, overdue: false };
  const balance = loanBalance(loan, loan.payments, today);
  return { ...loan, balance, overdue: isOverdue(loan, balance, today) };
}

export async function getDue(user: AuthUser, id: string, date?: string) {
  const loan = await findInBranch(user, id);
  return loanBalance(loan, loan.payments, date ?? clock.today());
}

export async function approvalQueue(user: AuthUser) {
  return prisma.loan.findMany({
    where: { branchId: requireBranch(user), status: "PENDING_APPROVAL" },
    include: { customer: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
}

async function lockPendingLoan(tx: Tx, user: AuthUser, id: string) {
  await lockLoan(tx, id);
  const loan = await tx.loan.findUnique({ where: { id } });
  if (!loan || loan.branchId !== requireBranch(user)) throw notFound("Loan");
  if (loan.status !== "PENDING_APPROVAL") throw conflict("INVALID_STATE", `Loan is already ${loan.status}`);
  if (loan.createdById === user.id) throw forbidden("You cannot decide on a loan you created");
  return loan;
}

export async function approveLoan(user: AuthUser, id: string) {
  return prisma.$transaction(async (tx) => {
    const loan = await lockPendingLoan(tx, user, id);
    const today = clock.today();
    const updated = await tx.loan.update({
      where: { id },
      data: {
        status: "ACTIVE",
        approvedById: user.id,
        approvedAt: new Date(),
        disbursedOn: toDbDate(today),
        maturityDate: toDbDate(maturityDate(today, loan.tenureMonths)),
      },
    });
    await writeAudit(tx, {
      actorId: user.id,
      action: "LOAN_APPROVED",
      entityType: "Loan",
      entityId: id,
      branchId: loan.branchId,
      before: { status: loan.status },
      after: { status: updated.status, disbursedOn: today, maturityDate: updated.maturityDate },
    });
    return updated;
  });
}

export async function rejectLoan(user: AuthUser, id: string, reason: string) {
  return prisma.$transaction(async (tx) => {
    const loan = await lockPendingLoan(tx, user, id);
    const updated = await tx.loan.update({
      where: { id },
      data: { status: "REJECTED", approvedById: user.id, approvedAt: new Date(), rejectedReason: reason },
    });
    await writeAudit(tx, {
      actorId: user.id,
      action: "LOAN_REJECTED",
      entityType: "Loan",
      entityId: id,
      branchId: loan.branchId,
      before: { status: loan.status },
      after: { status: updated.status, reason },
    });
    return updated;
  });
}

// Closing marks the loan settled and records which pledged items went back to the customer.
export async function closeLoan(user: AuthUser, id: string) {
  const branchId = requireBranch(user);
  return prisma.$transaction(async (tx) => {
    await lockLoan(tx, id);
    const loan = await tx.loan.findUnique({
      where: { id },
      include: { payments: { orderBy: paymentOrder }, appraisal: { include: { items: true } } },
    });
    if (!loan || loan.branchId !== branchId) throw notFound("Loan");
    if (loan.status !== "ACTIVE") throw conflict("INVALID_STATE", `Loan is ${loan.status}`);

    const balance = loanBalance(loan, loan.payments, clock.today());
    if (balance.totalDuePaise !== 0n) {
      throw ruleViolation("OUTSTANDING_NOT_ZERO", "Loan can only be closed when nothing is outstanding", balance);
    }
    const items = loan.appraisal.items.map(({ id, description, netWeightMg, karat }) => ({
      id,
      description,
      netWeightMg,
      karat,
    }));
    const closed = await tx.loan.update({
      where: { id },
      data: { status: "CLOSED", closedById: user.id, closedAt: new Date() },
    });
    const release = await tx.goldRelease.create({ data: { loanId: id, releasedById: user.id, items } });
    await writeAudit(tx, {
      actorId: user.id,
      action: "LOAN_CLOSED",
      entityType: "Loan",
      entityId: id,
      branchId,
      before: { status: loan.status },
      after: { status: closed.status, goldRelease: release },
    });
    return { ...closed, goldRelease: release };
  });
}
