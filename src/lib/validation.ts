import { z } from "zod";
import { isValidDate } from "../domain/dates";

export const isoDate = z.string().refine(isValidDate, "Expected a date as YYYY-MM-DD");

// Money in the API is integer paise, sent as a JSON integer or a digit string.
export const paise = z
  .union([z.string().regex(/^\d{1,15}$/), z.number().int().nonnegative().safe()])
  .transform((v) => BigInt(v));

export const idParams = z.object({ id: z.string().min(1).max(64) });

export const email = z.string().trim().toLowerCase().email().max(254);
