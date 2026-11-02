import { Router } from "express";
import { z } from "zod";
import { fromDbDate } from "../../domain/dates";
import { currentUser, requireRole } from "../../middleware/auth";
import { clock } from "../../lib/clock";
import { isoDate } from "../../lib/validation";
import { currentRate } from "../gold-rates/gold-rates.service";
import { portfolioRows, scopeFor, summarize, type PortfolioRow } from "./portfolio.service";

const rangeSchema = z
  .object({
    branchId: z.string().min(1).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: "from must be on or before to", path: ["from"] });

const csvSchema = rangeSchema.refine((q) => q.from && q.to, { message: "from and to are required", path: ["from"] });

export const reportsRouter = Router();

reportsRouter.get("/reports/dashboard", requireRole("MANAGER", "ADMIN"), async (req, res) => {
  const scope = scopeFor(currentUser(req), rangeSchema.parse(req.query));
  const rate = await currentRate();
  res.json({ asOf: clock.today(), goldRatePaisePerGram: rate.ratePaisePerGram, scope, ...summarize(await portfolioRows(scope)) });
});

reportsRouter.get("/reports/ltv-breaches", requireRole("MANAGER", "ADMIN"), async (req, res) => {
  const scope = scopeFor(currentUser(req), rangeSchema.parse(req.query));
  const rate = await currentRate();
  const items = (await portfolioRows(scope)).filter((r) => r.ltvBreach);
  res.json({ asOf: clock.today(), goldRatePaisePerGram: rate.ratePaisePerGram, items });
});

const CSV_COLUMNS: [string, (r: PortfolioRow) => unknown][] = [
  ["loan_id", (r) => r.id],
  ["branch", (r) => r.branchCode],
  ["customer", (r) => r.customerName],
  ["scheme", (r) => r.scheme],
  ["status", (r) => r.status],
  ["disbursed_on", (r) => fromDbDate(r.disbursedOn)],
  ["maturity_date", (r) => fromDbDate(r.maturityDate)],
  ["principal_paise", (r) => r.principalPaise],
  ["outstanding_principal_paise", (r) => r.outstandingPrincipalPaise],
  ["interest_today_paise", (r) => r.interestTodayPaise],
  ["overdue", (r) => r.overdue],
  ["overdue_amount_paise", (r) => r.overdueAmountPaise],
  ["current_value_paise", (r) => r.currentValuePaise],
  ["current_ltv_bps", (r) => r.currentLtvBps ?? ""],
  ["ltv_cap_bps", (r) => r.ltvCapBps],
  ["ltv_breach", (r) => r.ltvBreach],
];

const csvCell = (value: unknown) => {
  const text = String(value);
  // Quote everything that needs it and neutralise spreadsheet formula injection.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) || safe !== text ? `"${safe.replace(/"/g, '""')}"` : safe;
};

reportsRouter.get("/reports/loans.csv", requireRole("MANAGER", "ADMIN"), async (req, res) => {
  const scope = scopeFor(currentUser(req), csvSchema.parse(req.query));
  const rows = await portfolioRows(scope);
  const totals = summarize(rows);

  const lines = [CSV_COLUMNS.map(([name]) => name).join(",")];
  for (const row of rows) lines.push(CSV_COLUMNS.map(([, pick]) => csvCell(pick(row))).join(","));
  lines.push("");
  lines.push("total,value");
  for (const [key, value] of Object.entries(totals)) lines.push(`${key},${value}`);

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="loans_${scope.from}_${scope.to}.csv"`);
  res.send(lines.join("\n"));
});
