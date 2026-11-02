import type { Role } from "@prisma/client";
import type { AuthUser } from "../../middleware/auth";
import { writeAudit } from "../../lib/audit";
import { badRequest, notFound } from "../../lib/errors";
import { pageArgs, toPage, type PageQuery } from "../../lib/pagination";
import { prisma } from "../../lib/prisma";

interface UserInput {
  email?: string;
  name?: string;
  role?: Role;
  branchId?: string | null;
  active?: boolean;
}

async function checkBranch(role: Role, branchId: string | null) {
  if (role === "ADMIN") return null;
  if (!branchId) throw badRequest("Staff and managers must belong to a branch");
  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  if (!branch) throw notFound("Branch");
  return branchId;
}

export async function listUsers(page: PageQuery) {
  const rows = await prisma.user.findMany(pageArgs(page));
  return toPage(rows, page.limit);
}

export async function createUser(actor: AuthUser, input: Required<Omit<UserInput, "active">>) {
  const branchId = await checkBranch(input.role, input.branchId);
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { ...input, branchId } });
    await writeAudit(tx, { actorId: actor.id, action: "USER_CREATED", entityType: "User", entityId: user.id, after: user });
    return user;
  });
}

export async function updateUser(actor: AuthUser, id: string, input: UserInput) {
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) throw notFound("User");
  if (existing.id === actor.id && (input.active === false || (input.role && input.role !== "ADMIN"))) {
    throw badRequest("Admins cannot deactivate or demote themselves");
  }
  const role = input.role ?? existing.role;
  const branchId = await checkBranch(role, input.branchId === undefined ? existing.branchId : input.branchId);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.update({ where: { id }, data: { ...input, branchId } });
    if (input.active === false || input.role || input.branchId !== undefined) {
      await tx.session.deleteMany({ where: { userId: id } });
    }
    await writeAudit(tx, { actorId: actor.id, action: "USER_UPDATED", entityType: "User", entityId: id, before: existing, after: user });
    return user;
  });
}
