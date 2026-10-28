import { Prisma, PrismaClient } from "@prisma/client";

export type DbTx = Prisma.TransactionClient;
export type DbClient = PrismaClient | DbTx;

export const prisma = new PrismaClient();
