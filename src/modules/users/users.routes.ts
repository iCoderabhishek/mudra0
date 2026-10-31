import { Router } from "express";
import { z } from "zod";
import { currentUser, requireRole } from "../../middleware/auth";
import { pageQuery } from "../../lib/pagination";
import { email, idParams } from "../../lib/validation";
import { createUser, listUsers, updateUser } from "./users.service";

const role = z.enum(["STAFF", "MANAGER", "ADMIN"]);

const createSchema = z.object({
  email,
  name: z.string().trim().min(2).max(120),
  role,
  branchId: z.string().min(1).nullable().default(null),
});

const updateSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    role,
    branchId: z.string().min(1).nullable(),
    active: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Provide at least one field to update");

export const usersRouter = Router();

usersRouter.get("/users", requireRole("ADMIN"), async (req, res) => {
  res.json(await listUsers(pageQuery.parse(req.query)));
});

usersRouter.post("/users", requireRole("ADMIN"), async (req, res) => {
  res.status(201).json(await createUser(currentUser(req), createSchema.parse(req.body)));
});

usersRouter.patch("/users/:id", requireRole("ADMIN"), async (req, res) => {
  const { id } = idParams.parse(req.params);
  res.json(await updateUser(currentUser(req), id, updateSchema.parse(req.body)));
});
