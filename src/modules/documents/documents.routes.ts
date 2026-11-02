import { Router } from "express";
import { currentUser, requireRole } from "../../middleware/auth";
import { idParams } from "../../lib/validation";
import { loanStatementHtml, paymentReceiptHtml } from "./documents.service";

export const documentsRouter = Router();

documentsRouter.get("/loans/:id/statement", requireRole("STAFF", "MANAGER"), async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.type("html").send(await loanStatementHtml(currentUser(req), id));
});

documentsRouter.get("/payments/:id/receipt", requireRole("STAFF", "MANAGER"), async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.type("html").send(await paymentReceiptHtml(currentUser(req), id));
});
