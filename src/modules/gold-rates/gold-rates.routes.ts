import { Router } from "express";
import { requireRole } from "../../middleware/auth";
import { currentRate } from "./gold-rates.service";

export const goldRatesRouter = Router();

goldRatesRouter.get("/gold-rates/current", requireRole("STAFF", "MANAGER", "ADMIN"), async (_req, res) => {
  res.json(await currentRate());
});
