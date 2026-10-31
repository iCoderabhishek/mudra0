import { requireBranch, type AuthUser } from "../../middleware/auth";
import { needsApproval } from "../../domain/loan-rules";
import { writeAudit } from "../../lib/audit";
import { clock } from "../../lib/clock";
import { conflict, notFound, ruleViolation } from "../../lib/errors";
import { lockLoan, prisma } from "../../lib/prisma";
import { insertAppraisal } from "../appraisals/appraisals.service";
import { insertPayment } from "../payments/payments.service";
import { loanBalance, paymentOrder } from "./loan-balance";
import type { LoanTermsInput } from "./loans.schema";
import { insertLoan } from "./loans.service";

// One transaction: settle the old loan from the new principal, close it, re-appraise
// the same items at today's rate and open the new loan. Any rule failure rolls back all of it.
export async function renewLoan(user: AuthUser, loanId: string, terms: LoanTermsInput) {
  const branchId = requireBranch(user);
  if (needsApproval(terms.principalPaise)) {
    throw ruleViolation("RENEWAL_NEEDS_APPROVAL", "Renewals above ₹3,00,000 are not supported; close the loan and create a new one");
  }

  return prisma.$transaction(async (tx) => {
    await lockLoan(tx, loanId);
    const old = await tx.loan.findUnique({
      where: { id: loanId },
      include: { payments: { orderBy: paymentOrder }, appraisal: { include: { items: true } } },
    });
    if (!old || old.branchId !== branchId) throw notFound("Loan");
    if (old.status !== "ACTIVE") throw conflict("INVALID_STATE", `Loan is ${old.status}`);

    const payoffPaise = loanBalance(old, old.payments, clock.today()).totalDuePaise;
    if (payoffPaise > 0n) {
      await insertPayment(tx, user, old.id, {
        amountPaise: payoffPaise,
        mode: "RENEWAL",
        idempotencyKey: `renewal-${old.id}`,
      });
    }

    const items = old.appraisal.items.map(({ description, grossWeightMg, stoneWeightMg, karat }) => ({
      description,
      grossWeightMg,
      stoneWeightMg,
      karat,
    }));
    const appraisal = await insertAppraisal(tx, user, old.customerId, branchId, items);
    const loan = await insertLoan(tx, user, appraisal, terms, { fromLoanId: old.id, payoffPaise });

    await tx.loan.update({ where: { id: old.id }, data: { status: "CLOSED", closedById: user.id, closedAt: new Date() } });
    await writeAudit(tx, {
      actorId: user.id,
      action: "LOAN_RENEWED",
      entityType: "Loan",
      entityId: old.id,
      branchId,
      before: { status: old.status },
      after: { status: "CLOSED", renewedIntoId: loan.id, payoffPaise, goldCarriedToAppraisalId: appraisal.id },
    });
    return { closedLoanId: old.id, payoffPaise, loan };
  });
}
