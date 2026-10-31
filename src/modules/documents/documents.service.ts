import { requireBranch, type AuthUser } from "../../middleware/auth";
import { fromDbDate } from "../../domain/dates";
import { clock } from "../../lib/clock";
import { notFound } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { loanBalance, paymentOrder } from "../loans/loan-balance";
import { getLoan } from "../loans/loans.service";
import { esc, facts, grams, money, page, table } from "./html";

const day = (d: Date | null) => (d ? fromDbDate(d) : "–");
const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;

export async function loanStatementHtml(user: AuthUser, loanId: string) {
  const loan = await getLoan(user, loanId);
  const paymentRows = loan.payments.map((p, i) => {
    const after = loanBalance(loan, loan.payments.slice(0, i + 1), fromDbDate(p.paidOn));
    return [
      esc(fromDbDate(p.paidOn)),
      esc(p.id),
      esc(p.mode),
      money(p.amountPaise),
      money(p.interestPaidPaise),
      money(p.principalPaidPaise),
      money(after.outstandingPrincipalPaise),
    ];
  });

  const body = `
<p class="muted">Loan statement generated on ${esc(clock.today())}</p>
${facts([
  ["Loan", esc(loan.id)],
  ["Customer", `${esc(loan.customer.name)} (${esc(loan.customer.phone)})`],
  ["Status", esc(loan.overdue ? `${loan.status} (OVERDUE)` : loan.status)],
  ["Scheme", `${esc(loan.scheme)}, ${pct(loan.annualRateBps)} p.a. simple, ${loan.tenureMonths} months`],
  ["Disbursed on / maturity", `${esc(day(loan.disbursedOn))} / ${esc(day(loan.maturityDate))}`],
  ["Principal", money(loan.principalPaise)],
  ["Processing fee", money(loan.processingFeePaise)],
  ...(loan.renewalPayoffPaise > 0n ? [["Paid to previous loan", money(loan.renewalPayoffPaise)] as [string, string]] : []),
  ["Net disbursed", money(loan.netDisbursalPaise)],
  ["Gold rate used", `${money(loan.appraisal.ratePaisePerGram)} per gram (24K)`],
  ["Appraised value", money(loan.appraisal.appraisedValuePaise)],
])}
<h2>Pledged items</h2>
${table(
  ["Description", "Gross", "Stone", "Net", "Karat", "Value"],
  loan.appraisal.items.map((i) => [esc(i.description), grams(i.grossWeightMg), grams(i.stoneWeightMg), grams(i.netWeightMg), `${i.karat}K`, money(i.valuePaise)]),
)}
<h2>Repayments</h2>
${table(["Date", "Receipt", "Mode", "Amount", "To interest", "To principal", "Principal after"], paymentRows)}
<h2>Balance as of ${esc(clock.today())}</h2>
${
  loan.balance
    ? facts([
        ["Outstanding principal", money(loan.balance.outstandingPrincipalPaise)],
        ["Accrued interest", money(loan.balance.accruedInterestPaise)],
        ["Total due", `<strong>${money(loan.balance.totalDuePaise)}</strong>`],
      ])
    : "<p>Not disbursed.</p>"
}
${loan.goldRelease ? `<p>Gold released on ${esc(loan.goldRelease.releasedAt.toISOString())}.</p>` : ""}`;

  return page(`Statement ${loan.id}`, body);
}

export async function paymentReceiptHtml(user: AuthUser, paymentId: string) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      loan: {
        include: {
          customer: { select: { name: true, phone: true } },
          branch: { select: { name: true } },
          payments: { orderBy: paymentOrder },
        },
      },
    },
  });
  if (!payment || payment.loan.branchId !== requireBranch(user)) throw notFound("Payment");

  const { loan } = payment;
  const upToThis = loan.payments.slice(0, loan.payments.findIndex((p) => p.id === payment.id) + 1);
  const after = loanBalance(loan, upToThis, fromDbDate(payment.paidOn));

  const body = `
<p class="muted">Payment receipt – ${esc(loan.branch.name)}</p>
${facts([
  ["Receipt no.", esc(payment.id)],
  ["Date", esc(fromDbDate(payment.paidOn))],
  ["Customer", `${esc(loan.customer.name)} (${esc(loan.customer.phone)})`],
  ["Loan", esc(loan.id)],
  ["Mode", esc(payment.mode)],
  ["Amount received", `<strong>${money(payment.amountPaise)}</strong>`],
  ["Applied to interest", money(payment.interestPaidPaise)],
  ["Applied to principal", money(payment.principalPaidPaise)],
  ["Outstanding principal after", money(after.outstandingPrincipalPaise)],
  ["Total due after (same day)", money(after.totalDuePaise)],
])}`;

  return page(`Receipt ${payment.id}`, body);
}
