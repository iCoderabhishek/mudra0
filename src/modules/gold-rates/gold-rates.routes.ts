import { Router } from "express";
import { z } from "zod";
import { rupees } from "../../domain/money";
import { currentUser, requireRole } from "../../middleware/auth";
import { pageQuery } from "../../lib/pagination";
import { paise } from "../../lib/validation";
import { currentRate, rateHistory, setRate } from "./gold-rates.service";

const setRateSchema = z.object({
  ratePaisePerGram: paise.refine((v) => v > 0n && v <= rupees(1_000_000), "Rate must be between 1 paisa and ₹10,00,000 per gram"),
});

export const goldRatesRouter = Router();

goldRatesRouter.get("/gold-rates/current", requireRole("STAFF", "MANAGER", "ADMIN"), async (_req, res) => {
  res.json(await currentRate());
});

goldRatesRouter.get("/gold-rates", requireRole("STAFF", "MANAGER", "ADMIN"), async (req, res) => {
  res.json(await rateHistory(pageQuery.parse(req.query)));
});

goldRatesRouter.post("/gold-rates", requireRole("ADMIN"), async (req, res) => {
  const { ratePaisePerGram } = setRateSchema.parse(req.body);
  res.status(201).json(await setRate(currentUser(req), ratePaisePerGram));
});
