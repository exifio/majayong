import { Prisma, PrismaClient } from "@prisma/client";

export async function seedBlockCatalog(
  db: PrismaClient,
  blocks: Prisma.BlockCatalogCreateManyInput[],
): Promise<number> {
  const result = await db.blockCatalog.createMany({ data: blocks, skipDuplicates: true });
  return result.count;
}
