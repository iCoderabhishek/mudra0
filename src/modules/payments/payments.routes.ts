import { Router } from "express";
import { z } from "zod";
import { currentUser, requireRole } from "../../middleware/auth";
import { idParams, paise } from "../../lib/validation";
import { recordPayment } from "./payments.service";

const paymentSchema = z.object({
  amountPaise: paise,
  mode: z.enum(["CASH", "UPI", "BANK_TRANSFER"]).default("CASH"),
});

const idempotencyKey = z
  .string({ required_error: "Idempotency-Key header is required" })
  .regex(/^[A-Za-z0-9_-]{8,100}$/, "Idempotency-Key must be 8-100 characters of A-Z, a-z, 0-9, _ or -");

export const paymentsRouter = Router();

paymentsRouter.post("/loans/:id/payments", requireRole("STAFF"), async (req, res) => {
  const { id } = idParams.parse(req.params);
  const body = paymentSchema.parse(req.body);
  const key = idempotencyKey.parse(req.header("Idempotency-Key"));
  const result = await recordPayment(currentUser(req), id, { ...body, idempotencyKey: key });
  res.status(result.replayed ? 200 : 201).json(result);
});
