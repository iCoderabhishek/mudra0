import { Router } from "express";
import { currentUser, requireRole } from "../../middleware/auth";
import { idParams } from "../../lib/validation";
import { createLoanSchema, dueQuerySchema, listLoansSchema, rejectSchema } from "./loans.schema";
import {
  approvalQueue,
  approveLoan,
  closeLoan,
  createLoan,
  getDue,
  getLoan,
  listLoans,
  rejectLoan,
} from "./loans.service";

export const loansRouter = Router();

loansRouter.post("/loans", requireRole("STAFF"), async (req, res) => {
  res.status(201).json(await createLoan(currentUser(req), createLoanSchema.parse(req.body)));
});

loansRouter.get("/loans", requireRole("STAFF", "MANAGER"), async (req, res) => {
  res.json(await listLoans(currentUser(req), listLoansSchema.parse(req.query)));
});

loansRouter.get("/loans/:id", requireRole("STAFF", "MANAGER"), async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.json(await getLoan(currentUser(req), id));
});

loansRouter.get("/loans/:id/due", requireRole("STAFF", "MANAGER"), async (req, res) => {
  const { id } = idParams.parse(req.params);
  const { date } = dueQuerySchema.parse(req.query);
  res.json(await getDue(currentUser(req), id, date));
});

loansRouter.get("/approvals", requireRole("MANAGER"), async (req, res) => {
  res.json({ items: await approvalQueue(currentUser(req)) });
});

loansRouter.post("/loans/:id/approve", requireRole("MANAGER"), async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.json(await approveLoan(currentUser(req), id));
});

loansRouter.post("/loans/:id/reject", requireRole("MANAGER"), async (req, res) => {
  const { id } = idParams.parse(req.params);
  const { reason } = rejectSchema.parse(req.body);
  res.json(await rejectLoan(currentUser(req), id, reason));
});

loansRouter.post("/loans/:id/close", requireRole("STAFF", "MANAGER"), async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.json(await closeLoan(currentUser(req), id));
});
