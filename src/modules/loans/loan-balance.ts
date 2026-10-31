import type { Loan, Payment } from "@prisma/client";
import { fromDbDate } from "../../domain/dates";
import { balanceAsOf, type Balance } from "../../domain/interest";
import { conflict } from "../../lib/errors";

type LoanTermsRow = Pick<Loan, "status" | "principalPaise" | "annualRateBps" | "disbursedOn">;
type PaymentRow = Pick<Payment, "paidOn" | "interestPaidPaise" | "principalPaidPaise">;

// Payments must be passed in the order they were recorded (paidOn, then createdAt).
export function loanBalance(loan: LoanTermsRow, payments: PaymentRow[], asOf: string): Balance {
  if (!loan.disbursedOn) throw conflict("NOT_DISBURSED", `Loan is ${loan.status} and has no balance`);
  return balanceAsOf(
    { principalPaise: loan.principalPaise, annualRateBps: loan.annualRateBps, disbursedOn: fromDbDate(loan.disbursedOn) },
    payments.map((p) => ({
      paidOn: fromDbDate(p.paidOn),
      interestPaidPaise: p.interestPaidPaise,
      principalPaidPaise: p.principalPaidPaise,
    })),
    asOf,
  );
}

export const paymentOrder = [{ paidOn: "asc" as const }, { createdAt: "asc" as const }];

export function isOverdue(loan: Pick<Loan, "status" | "maturityDate">, balance: Balance, today: string) {
  return (
    loan.status === "ACTIVE" &&
    loan.maturityDate !== null &&
    today > fromDbDate(loan.maturityDate) &&
    balance.totalDuePaise > 0n
  );
}
