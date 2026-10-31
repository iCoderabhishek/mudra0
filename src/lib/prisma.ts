import { Prisma, PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

export type Tx = Prisma.TransactionClient;

export async function lockLoan(tx: Tx, loanId: string) {
  await tx.$queryRaw`SELECT id FROM "Loan" WHERE id = ${loanId} FOR UPDATE`;
}
