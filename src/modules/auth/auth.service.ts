import { env } from "../../config/env";
import { hmac, randomToken, safeEqual, sixDigitCode } from "../../lib/crypto";
import { AppError } from "../../lib/errors";
import { mailer } from "../../lib/mailer";
import { prisma } from "../../lib/prisma";

export const CODE_TTL_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 5;

const invalidCode = () => new AppError(400, "INVALID_CODE", "The code is invalid or has expired");
const hashCode = (email: string, code: string) => hmac(`login:${email}:${code}`);

// Always succeeds from the caller's view so the endpoint does not reveal which emails exist.
export async function requestCode(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user?.active) return;

  const code = sixDigitCode();
  await prisma.$transaction([
    prisma.loginCode.updateMany({ where: { email, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.loginCode.create({
      data: { email, codeHash: hashCode(email, code), expiresAt: new Date(Date.now() + CODE_TTL_MS) },
    }),
  ]);

  await mailer.send({
    to: email,
    subject: "Your Swarn Sathi sign-in code",
    text: `Your sign-in code is ${code}. It expires in 10 minutes and can be used once.`,
  });
}

export async function verifyCode(email: string, code: string) {
  const now = new Date();
  const record = await prisma.loginCode.findFirst({
    where: { email, usedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
  });
  if (!record) throw invalidCode();

  // Count the attempt atomically before comparing, so parallel guesses cannot exceed the limit.
  const slot = await prisma.loginCode.updateMany({
    where: { id: record.id, usedAt: null, attempts: { lt: MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (slot.count === 0 || !safeEqual(record.codeHash, hashCode(email, code))) throw invalidCode();

  const claimed = await prisma.loginCode.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: now },
  });
  if (claimed.count === 0) throw invalidCode();

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user?.active) throw invalidCode();

  const token = randomToken();
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 3_600_000);
  await prisma.session.create({ data: { tokenHash: hmac(token), userId: user.id, expiresAt } });

  return {
    token,
    expiresAt,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, branchId: user.branchId },
  };
}

export async function logout(token: string) {
  await prisma.session.deleteMany({ where: { tokenHash: hmac(token) } });
}
