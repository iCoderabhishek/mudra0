import { z } from "zod";
import { addMonths } from "../../domain/dates";
import { clock } from "../../lib/clock";
import { pageQuery } from "../../lib/pagination";
import { isoDate } from "../../lib/validation";

export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export const createCustomerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().regex(/^[6-9]\d{9}$/, "Phone must be a 10-digit Indian mobile number"),
  dateOfBirth: isoDate.refine((dob) => addMonths(dob, 18 * 12) <= clock.today(), "Customer must be at least 18"),
  address: z.string().trim().min(5).max(500),
  pan: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .pipe(z.string().regex(PAN_PATTERN, "PAN must look like ABCDE1234F")),
  // Accepted for validation only; just the last 4 digits are stored.
  aadhaar: z.string().regex(/^\d{12}$/, "Aadhaar must be 12 digits"),
});

export const searchCustomersSchema = pageQuery.extend({
  q: z.string().trim().min(2).max(100).optional(),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type SearchCustomersInput = z.infer<typeof searchCustomersSchema>;
