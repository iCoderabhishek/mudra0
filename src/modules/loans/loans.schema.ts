import { z } from "zod";
import { pageQuery } from "../../lib/pagination";
import { isoDate, paise } from "../../lib/validation";

export const loanTermsSchema = z.object({
  scheme: z.enum(["STANDARD", "QUICK"]),
  principalPaise: paise,
  tenureMonths: z.number().int().min(1).max(12),
});

export const createLoanSchema = loanTermsSchema.extend({
  appraisalId: z.string().min(1),
});

export const listLoansSchema = pageQuery.extend({
  status: z.enum(["PENDING_APPROVAL", "ACTIVE", "REJECTED", "CLOSED"]).optional(),
  customerId: z.string().min(1).optional(),
  overdue: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
});

export const dueQuerySchema = z.object({ date: isoDate.optional() });

export const rejectSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export type LoanTermsInput = z.infer<typeof loanTermsSchema>;
export type CreateLoanInput = z.infer<typeof createLoanSchema>;
export type ListLoansInput = z.infer<typeof listLoansSchema>;
