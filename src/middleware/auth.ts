import type { Role } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import { hmac } from "../lib/crypto";
import { forbidden, unauthorized } from "../lib/errors";
import { prisma } from "../lib/prisma";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  branchId: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw unauthorized();

  const session = await prisma.session.findUnique({
    where: { tokenHash: hmac(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt <= new Date() || !session.user.active) {
    throw unauthorized("Session is invalid or expired");
  }
  const { id, email, name, role, branchId } = session.user;
  req.user = { id, email, name, role, branchId };
  next();
}

export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw unauthorized();
    if (!roles.includes(req.user.role)) throw forbidden();
    next();
  };

export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

// Staff and managers only ever act inside their own branch.
export function requireBranch(user: AuthUser): string {
  if (!user.branchId) throw forbidden("This action requires a branch user");
  return user.branchId;
}
