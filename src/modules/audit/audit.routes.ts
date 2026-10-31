import type { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { currentUser, requireRole } from "../../middleware/auth";
import { prisma } from "../../lib/prisma";

const querySchema = z.object({
  entityType: z.string().max(50).optional(),
  entityId: z.string().max(64).optional(),
  cursor: z.string().regex(/^\d+$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// Read-only by design: there are no write routes, and DB triggers block UPDATE/DELETE.
export const auditRouter = Router();

auditRouter.get("/audit", requireRole("MANAGER", "ADMIN"), async (req, res) => {
  const user = currentUser(req);
  const q = querySchema.parse(req.query);
  const where: Prisma.AuditLogWhereInput = {
    ...(user.role === "MANAGER" ? { branchId: user.branchId } : {}),
    ...(q.entityType ? { entityType: q.entityType } : {}),
    ...(q.entityId ? { entityId: q.entityId } : {}),
    ...(q.cursor ? { id: { lt: BigInt(q.cursor) } } : {}),
  };
  const rows = await prisma.auditLog.findMany({ where, orderBy: { id: "desc" }, take: q.limit + 1 });
  const items = rows.slice(0, q.limit);
  res.json({ items, nextCursor: rows.length > q.limit ? items[items.length - 1]!.id.toString() : null });
});
