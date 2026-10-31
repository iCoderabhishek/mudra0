import type { Prisma } from "@prisma/client";
import type { Tx } from "./prisma";

export interface AuditEntry {
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  branchId?: string | null;
  before?: unknown;
  after?: unknown;
}

const toJson = (value: unknown) =>
  value === undefined
    ? undefined
    : (JSON.parse(
        JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
      ) as Prisma.InputJsonValue);

export async function writeAudit(tx: Tx, entry: AuditEntry) {
  await tx.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      branchId: entry.branchId ?? null,
      before: toJson(entry.before),
      after: toJson(entry.after),
    },
  });
}
