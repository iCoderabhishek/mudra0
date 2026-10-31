import type { PaymentMode } from "@prisma/client";
import { requireBranch, type AuthUser } from "../../middleware/auth";
import { toDbDate } from "../../domain/dates";
import { allocatePayment } from "../../domain/interest";
import { writeAudit } from "../../lib/audit";
import { clock } from "../../lib/clock";
import { conflict, notFound } from "../../lib/errors";
import { lockLoan, prisma, type Tx } from "../../lib/prisma";
import { loanBalance, paymentOrder } from "../loans/loan-balance";

export interface PaymentInput {
  amountPaise: bigint;
  mode: PaymentMode;
  idempotencyKey: string;
}

// Caller must hold the loan row lock. Shared with renewal.
export async function insertPayment(tx: Tx, user: AuthUser, loanId: string, input: PaymentInput) {
  const loan = await tx.loan.findUnique({ where: { id: loanId }, include: { payments: { orderBy: paymentOrder } } });
  if (!loan || loan.branchId !== requireBranch(user)) throw notFound("Loan");

  const existing = loan.payments.find((p) => p.idempotencyKey === input.idempotencyKey);
  if (existing) {
    if (existing.amountPaise !== input.amountPaise || existing.mode !== input.mode) {
      throw conflict("IDEMPOTENCY_KEY_REUSED", "This idempotency key was used for a different payment");
    }
    return { payment: existing, replayed: true, balance: loanBalance(loan, loan.payments, clock.today()) };
  }
  if (loan.status !== "ACTIVE") throw conflict("INVALID_STATE", `Loan is ${loan.status}`);

  const today = clock.today();
  const before = loanBalance(loan, loan.payments, today);
  const split = allocatePayment(input.amountPaise, before);

  const payment = await tx.payment.create({
    data: {
      loanId,
      amountPaise: input.amountPaise,
      ...split,
      mode: input.mode,
      paidOn: toDbDate(today),
      idempotencyKey: input.idempotencyKey,
      recordedById: user.id,
    },
  });
  await tx.loan.update({
    where: { id: loanId },
    data: { outstandingPrincipalPaise: before.outstandingPrincipalPaise - split.principalPaidPaise },
  });
  const after = loanBalance(loan, [...loan.payments, payment], today);
  await writeAudit(tx, {
    actorId: user.id,
    action: "PAYMENT_RECORDED",
    entityType: "Payment",
    entityId: payment.id,
    branchId: loan.branchId,
    before: { loanId, balance: before },
    after: { payment, balance: after },
  });
  return { payment, replayed: false, balance: after };
}

export async function recordPayment(user: AuthUser, loanId: string, input: PaymentInput) {
  return prisma.$transaction(async (tx) => {
    await lockLoan(tx, loanId);
    return insertPayment(tx, user, loanId, input);
  });
}
