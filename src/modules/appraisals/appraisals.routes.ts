import { Router } from "express";
import { z } from "zod";
import { ACCEPTED_KARATS } from "../../domain/gold";
import { currentUser, requireRole } from "../../middleware/auth";
import { idParams } from "../../lib/validation";
import { createAppraisal, getAppraisal } from "./appraisals.service";

const weightMg = z.number().int().nonnegative().max(10_000_000);

const itemSchema = z
  .object({
    description: z.string().trim().min(2).max(200),
    grossWeightMg: weightMg.positive(),
    stoneWeightMg: weightMg.default(0),
    karat: z.number().int().refine((k) => (ACCEPTED_KARATS as readonly number[]).includes(k), {
      message: `Karat must be one of ${ACCEPTED_KARATS.join(", ")}`,
    }),
  })
  .refine((i) => i.stoneWeightMg < i.grossWeightMg, {
    message: "Stone weight must be less than gross weight",
    path: ["stoneWeightMg"],
  });

const createSchema = z.object({
  customerId: z.string().min(1),
  items: z.array(itemSchema).min(1).max(50),
});

export const appraisalsRouter = Router();

appraisalsRouter.post("/appraisals", requireRole("STAFF"), async (req, res) => {
  const body = createSchema.parse(req.body);
  res.status(201).json(await createAppraisal(currentUser(req), body.customerId, body.items));
});

appraisalsRouter.get("/appraisals/:id", requireRole("STAFF", "MANAGER"), async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.json(await getAppraisal(currentUser(req), id));
});
