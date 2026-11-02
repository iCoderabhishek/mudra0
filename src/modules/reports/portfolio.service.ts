import { Prisma, type LoanStatus, type Scheme } from "@prisma/client";
import { requireBranch, type AuthUser } from "../../middleware/auth";
import { fromDbDate } from "../../domain/dates";
import { simpleInterest } from "../../domain/interest";
import { clock } from "../../lib/clock";
import { prisma } from "../../lib/prisma";
import { currentRate } from "../gold-rates/gold-rates.service";
import { loanBalance, paymentOrder } from "../loans/loan-balance";

export interface PortfolioScope {
  branchId: string | null;
  from?: string;
  to?: string;
}

interface LoanRow {
  id: string;
  branchCode: string;
  customerName: string;
  scheme: Scheme;
  status: LoanStatus;
  disbursedOn: Date;
  maturityDate: Date;
  principalPaise: bigint;
  outstandingPrincipalPaise: bigint;
  annualRateBps: number;
  ltvCapBps: number;
  currentValuePaise: bigint;
}

export interface PortfolioRow extends LoanRow {
  interestTodayPaise: bigint;
  overdue: boolean;
  overdueAmountPaise: bigint;
  currentLtvBps: bigint | null;
  ltvBreach: boolean;
}

// Managers are pinned to their branch; admins may pick one or see all.
export function scopeFor(user: AuthUser, query: { branchId?: string; from?: string; to?: string }): PortfolioScope {
  const branchId = user.role === "MANAGER" ? requireBranch(user) : (query.branchId ?? null);
  return { branchId, from: query.from, to: query.to };
}

// One row per disbursed loan (active or closed) in scope. The dashboard, the CSV
// export and the LTV breach report are all built from these rows, so they reconcile.
export async function portfolioRows(scope: PortfolioScope): Promise<PortfolioRow[]> {
  const rate = (await currentRate()).ratePaisePerGram;
  const today = clock.today();

  const conditions = [Prisma.sql`l."disbursedOn" IS NOT NULL`, Prisma.sql`l.status IN ('ACTIVE', 'CLOSED')`];
  if (scope.branchId) conditions.push(Prisma.sql`l."branchId" = ${scope.branchId}`);
  if (scope.from) conditions.push(Prisma.sql`l."disbursedOn" >= ${scope.from}::date`);
  if (scope.to) conditions.push(Prisma.sql`l."disbursedOn" <= ${scope.to}::date`);

  // Current value re-appraises the pledged items at today's rate, rounded per item like the appraisal.
  const rows = await prisma.$queryRaw<LoanRow[]>`
    SELECT l.id, b.code AS "branchCode", c.name AS "customerName", l.scheme, l.status,
           l."disbursedOn", l."maturityDate", l."principalPaise", l."outstandingPrincipalPaise",
           l."annualRateBps", l."ltvCapBps",
           (SELECT COALESCE(SUM(ROUND(ai."netWeightMg"::numeric * ai.karat * ${rate}::numeric / 24000)), 0)
              FROM "AppraisalItem" ai WHERE ai."appraisalId" = l."appraisalId")::bigint AS "currentValuePaise"
      FROM "Loan" l
      JOIN "Customer" c ON c.id = l."customerId"
      JOIN "Branch" b ON b.id = l."branchId"
     WHERE ${Prisma.join(conditions, " AND ")}
     ORDER BY l."disbursedOn", l.id`;

  const isActive = (r: LoanRow) => r.status === "ACTIVE" && r.outstandingPrincipalPaise > 0n;
  const isOverdue = (r: LoanRow) => isActive(r) && today > fromDbDate(r.maturityDate);

  // Only overdue loans need a full replay (for the amount owed), which keeps this cheap.
  const overdueIds = rows.filter(isOverdue).map((r) => r.id);
  const payments = overdueIds.length
    ? await prisma.payment.findMany({ where: { loanId: { in: overdueIds } }, orderBy: paymentOrder })
    : [];

  return rows.map((r) => {
    const overdue = isOverdue(r);
    const overdueAmountPaise = overdue
      ? loanBalance(r, payments.filter((p) => p.loanId === r.id), today).totalDuePaise
      : 0n;
    const accruesToday = isActive(r) && fromDbDate(r.disbursedOn) < today;
    return {
      ...r,
      interestTodayPaise: accruesToday ? simpleInterest(r.outstandingPrincipalPaise, r.annualRateBps, 1) : 0n,
      overdue,
      overdueAmountPaise,
      currentLtvBps: r.currentValuePaise > 0n ? (r.outstandingPrincipalPaise * 10_000n) / r.currentValuePaise : null,
      ltvBreach: isActive(r) && r.outstandingPrincipalPaise * 10_000n > r.currentValuePaise * BigInt(r.ltvCapBps),
    };
  });
}

export function summarize(rows: PortfolioRow[]) {
  const active = rows.filter((r) => r.status === "ACTIVE" && r.outstandingPrincipalPaise > 0n);
  const sum = (list: PortfolioRow[], pick: (r: PortfolioRow) => bigint) => list.reduce((s, r) => s + pick(r), 0n);
  return {
    activeLoans: active.length,
    totalOutstandingPrincipalPaise: sum(active, (r) => r.outstandingPrincipalPaise),
    interestAccruedTodayPaise: sum(active, (r) => r.interestTodayPaise),
    overdueCount: rows.filter((r) => r.overdue).length,
    overdueAmountPaise: sum(rows, (r) => r.overdueAmountPaise),
    ltvBreachCount: rows.filter((r) => r.ltvBreach).length,
  };
}
