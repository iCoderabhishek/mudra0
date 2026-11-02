import { Router } from "express";
import { currentUser, requireRole } from "../../middleware/auth";
import { idParams } from "../../lib/validation";
import { createCustomerSchema, searchCustomersSchema } from "./customers.schema";
import { createCustomer, getCustomer, searchCustomers } from "./customers.service";

export const customersRouter = Router();

customersRouter.post("/customers", requireRole("STAFF"), async (req, res) => {
  res.status(201).json(await createCustomer(currentUser(req), createCustomerSchema.parse(req.body)));
});

customersRouter.get("/customers", requireRole("STAFF", "MANAGER"), async (req, res) => {
  res.json(await searchCustomers(currentUser(req), searchCustomersSchema.parse(req.query)));
});

customersRouter.get("/customers/:id", requireRole("STAFF", "MANAGER"), async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.json(await getCustomer(currentUser(req), id));
});
