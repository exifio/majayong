import type { PrismaClient } from "@prisma/client";
import type { DbClient } from "../db.ts";
import { AppError } from "../shared/errors.ts";
import { logEvent } from "../shared/events.ts";

export interface BlockEstimate {
  blockId: string;
  isEstimable: boolean;
  estUnit: number | null;
  estMin: number | null;
  estMax: number | null;
}

export interface ClientEstimateSummary {
  estimableCount: number;
  unestimableCount: number;
  supplyAmount: number;
  minSupplyAmount: number;
  maxSupplyAmount: number;
  clientFee: number;
  totalWithFee: number;
}

export interface DraftBlockPriceSnapshot {
  blockId: string;
  isEstimable: boolean;
  estUnit: number | null;
  estMin: number | null;
  estMax: number | null;
}

export interface ReestimatedDraftBlock {
  blockId: string;
  previous: DraftBlockPriceSnapshot;
  current: BlockEstimate;
  changed: boolean;
}

export interface CreateSupplierRateInput {
  blockId: string;
  price?: number | null;
  isCapable?: boolean;
  isAvgReference?: boolean;
}

export interface UpdateSupplierRateInput {
  price?: number | null;
  isCapable?: boolean;
  isAvgReference?: boolean;
}

const MIN_ESTIMABLE_SUPPLIERS = 5;
const CLIENT_FEE_RATE = 0.05;

export function computeTrimmedEstimate(blockId: string, validPrices: number[]): BlockEstimate {
  if (validPrices.length < MIN_ESTIMABLE_SUPPLIERS) {
    return {
      blockId,
      isEstimable: false,
      estUnit: null,
      estMin: null,
      estMax: null,
    };
  }

  const sorted = [...validPrices].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const trimmed = sorted.filter((value) => value >= q1 && value <= q3);
  const sum = trimmed.reduce((acc, value) => acc + value, 0);

  return {
    blockId,
    isEstimable: true,
    estUnit: Math.round(sum / trimmed.length),
    estMin: trimmed[0] ?? null,
    estMax: trimmed[trimmed.length - 1] ?? null,
  };
}

// 정렬된 표본의 선형 보간 분위수 (위치 = (n - 1) × p)
function quantile(sorted: number[], p: number): number {
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function calculateClientEstimateSummary(
  estimates: BlockEstimate[],
): ClientEstimateSummary {
  let estimableCount = 0;
  let unestimableCount = 0;
  let supplyAmount = 0;
  let minSupplyAmount = 0;
  let maxSupplyAmount = 0;

  for (const est of estimates) {
    if (est.isEstimable && est.estUnit !== null && est.estMin !== null && est.estMax !== null) {
      estimableCount += 1;
      supplyAmount += est.estUnit;
      minSupplyAmount += est.estMin;
      maxSupplyAmount += est.estMax;
    } else {
      unestimableCount += 1;
    }
  }

  const clientFee = Math.floor(supplyAmount * CLIENT_FEE_RATE);
  return {
    estimableCount,
    unestimableCount,
    supplyAmount,
    minSupplyAmount,
    maxSupplyAmount,
    clientFee,
    totalWithFee: supplyAmount + clientFee,
  };
}

export async function estimateBlockPrices(
  db: DbClient,
  blockIds: string[],
): Promise<BlockEstimate[]> {
  const uniqueIds = Array.from(new Set(blockIds.map((id) => id.trim()).filter(Boolean)));
  if (uniqueIds.length === 0) {
    return [];
  }

  const rows = await db.supplierRate.findMany({
    where: {
      blockId: { in: uniqueIds },
      isCapable: true,
      isAvgReference: false,
      price: { not: null, gt: 0 },
    },
    select: {
      blockId: true,
      price: true,
    },
  });

  const pricesByBlock = new Map<string, number[]>();
  for (const row of rows) {
    if (row.price === null) continue;
    const bucket = pricesByBlock.get(row.blockId);
    if (bucket) {
      bucket.push(row.price);
    } else {
      pricesByBlock.set(row.blockId, [row.price]);
    }
  }

  const estimateByBlock = new Map<string, BlockEstimate>();
  for (const blockId of uniqueIds) {
    estimateByBlock.set(blockId, computeTrimmedEstimate(blockId, pricesByBlock.get(blockId) ?? []));
  }

  return blockIds
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => estimateByBlock.get(id) ?? computeTrimmedEstimate(id, []));
}

export async function estimateBlockPrice(
  db: DbClient,
  blockId: string,
): Promise<BlockEstimate> {
  const trimmedId = blockId.trim();
  if (!trimmedId) {
    throw new AppError(400, "VALIDATION_ERROR", "블록 ID가 필요합니다.");
  }
  const [estimate] = await estimateBlockPrices(db, [trimmedId]);
  return estimate ?? computeTrimmedEstimate(trimmedId, []);
}

export async function reestimateForDraftRestore(
  db: DbClient,
  snapshots: DraftBlockPriceSnapshot[],
): Promise<{ items: ReestimatedDraftBlock[]; summary: ClientEstimateSummary }> {
  const currentList = await estimateBlockPrices(
    db,
    snapshots.map((s) => s.blockId),
  );
  const currentByBlock = new Map(currentList.map((item) => [item.blockId, item]));

  const items: ReestimatedDraftBlock[] = snapshots.map((prev) => {
    const current = currentByBlock.get(prev.blockId) ?? computeTrimmedEstimate(prev.blockId, []);
    const changed =
      prev.isEstimable !== current.isEstimable ||
      prev.estUnit !== current.estUnit ||
      prev.estMin !== current.estMin ||
      prev.estMax !== current.estMax;
    return {
      blockId: prev.blockId,
      previous: prev,
      current,
      changed,
    };
  });

  return {
    items,
    summary: calculateClientEstimateSummary(items.map((item) => item.current)),
  };
}

function normalizeRatePayload(
  isCapable: boolean,
  price: number | null | undefined,
  isAvgReference: boolean,
): { isCapable: boolean; price: number | null; isAvgReference: boolean } {
  if (!isCapable) {
    if (price !== undefined && price !== null) {
      throw new AppError(400, "VALIDATION_ERROR", "수행 불가 블록에는 단가를 입력할 수 없습니다.");
    }
    return { isCapable: false, price: null, isAvgReference: false };
  }
  if (typeof price !== "number" || !Number.isInteger(price) || price <= 0) {
    throw new AppError(400, "VALIDATION_ERROR", "수행 가능한 블록의 단가는 1원 이상의 정수여야 합니다.");
  }
  return { isCapable: true, price, isAvgReference };
}

export async function listMySupplierRates(db: DbClient, supplierId: string) {
  const profile = await db.supplierProfile.findUnique({
    where: { userId: supplierId },
    select: { userId: true, rateCompleted: true, rateCheckedAt: true },
  });
  if (!profile) {
    throw new AppError(404, "NOT_FOUND", "공급자 프로필을 찾을 수 없습니다.");
  }

  const rates = await db.supplierRate.findMany({
    where: { supplierId },
    include: {
      block: {
        select: {
          id: true,
          code: true,
          name: true,
          industryCode: true,
          isActive: true,
          sortOrder: true,
        },
      },
    },
    orderBy: [{ block: { sortOrder: "asc" } }, { createdAt: "asc" }],
  });

  return {
    rateCompleted: profile.rateCompleted,
    rateCheckedAt: profile.rateCheckedAt,
    items: rates.map((rate) => ({
      id: rate.id,
      blockId: rate.blockId,
      blockCode: rate.block.code,
      blockName: rate.block.name,
      industryCode: rate.block.industryCode,
      price: rate.price,
      isCapable: rate.isCapable,
      isAvgReference: rate.isAvgReference,
      createdAt: rate.createdAt,
      updatedAt: rate.updatedAt,
    })),
  };
}

export async function createSupplierRate(
  prismaClient: PrismaClient,
  supplierId: string,
  input: CreateSupplierRateInput,
  sessionId?: string,
) {
  const blockId = typeof input.blockId === "string" ? input.blockId.trim() : "";
  if (!blockId) {
    throw new AppError(400, "VALIDATION_ERROR", "블록 ID가 필요합니다.");
  }
  if (input.isCapable !== undefined && typeof input.isCapable !== "boolean") {
    throw new AppError(400, "VALIDATION_ERROR", "수행 가능 여부는 boolean이어야 합니다.");
  }
  if (input.isAvgReference !== undefined && typeof input.isAvgReference !== "boolean") {
    throw new AppError(400, "VALIDATION_ERROR", "평균 참고 여부는 boolean이어야 합니다.");
  }

  const normalized = normalizeRatePayload(
    input.isCapable ?? true,
    input.price,
    input.isAvgReference ?? false,
  );

  return prismaClient.$transaction(async (tx) => {
    const profile = await tx.supplierProfile.findUnique({
      where: { userId: supplierId },
      select: { userId: true, rateCompleted: true },
    });
    if (!profile) {
      throw new AppError(404, "NOT_FOUND", "공급자 프로필을 찾을 수 없습니다.");
    }

    const block = await tx.blockCatalog.findUnique({
      where: { id: blockId },
      select: { id: true, isActive: true },
    });
    if (!block || !block.isActive) {
      throw new AppError(404, "NOT_FOUND", "활성 상태의 블록을 찾을 수 없습니다.");
    }

    const existingCount = await tx.supplierRate.count({ where: { supplierId } });
    const existingSameBlock = await tx.supplierRate.findUnique({
      where: { supplierId_blockId: { supplierId, blockId } },
      select: { id: true },
    });
    if (existingSameBlock) {
      throw new AppError(409, "CONFLICT", "이미 등록된 블록 단가입니다. 수정 API를 사용해 주세요.");
    }

    if (existingCount === 0) {
      await logEvent(tx, {
        type: "SUPPLIER_RATE_STARTED",
        userId: supplierId,
        sessionId: sessionId ?? null,
      });
    }

    const created = await tx.supplierRate.create({
      data: {
        supplierId,
        blockId,
        price: normalized.price,
        isCapable: normalized.isCapable,
        isAvgReference: normalized.isAvgReference,
      },
    });

    const capableCount = await tx.supplierRate.count({
      where: { supplierId, isCapable: true, price: { gt: 0 } },
    });
    const rateCompleted = capableCount > 0;
    const now = new Date();

    await tx.supplierProfile.update({
      where: { userId: supplierId },
      data: { rateCompleted, rateCheckedAt: now },
    });

    if (!profile.rateCompleted && rateCompleted) {
      await logEvent(tx, {
        type: "SUPPLIER_RATE_COMPLETED",
        userId: supplierId,
        sessionId: sessionId ?? null,
      });
    }

    return {
      rate: {
        id: created.id,
        blockId: created.blockId,
        price: created.price,
        isCapable: created.isCapable,
        isAvgReference: created.isAvgReference,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      },
      rateCompleted,
    };
  });
}

export async function updateSupplierRate(
  prismaClient: PrismaClient,
  supplierId: string,
  blockId: string,
  input: UpdateSupplierRateInput,
  sessionId?: string,
) {
  const trimmedBlockId = blockId.trim();
  if (!trimmedBlockId) {
    throw new AppError(400, "VALIDATION_ERROR", "블록 ID가 필요합니다.");
  }
  if (input.isCapable !== undefined && typeof input.isCapable !== "boolean") {
    throw new AppError(400, "VALIDATION_ERROR", "수행 가능 여부는 boolean이어야 합니다.");
  }
  if (input.isAvgReference !== undefined && typeof input.isAvgReference !== "boolean") {
    throw new AppError(400, "VALIDATION_ERROR", "평균 참고 여부는 boolean이어야 합니다.");
  }

  return prismaClient.$transaction(async (tx) => {
    const profile = await tx.supplierProfile.findUnique({
      where: { userId: supplierId },
      select: { userId: true, rateCompleted: true },
    });
    if (!profile) {
      throw new AppError(404, "NOT_FOUND", "공급자 프로필을 찾을 수 없습니다.");
    }

    const existing = await tx.supplierRate.findUnique({
      where: { supplierId_blockId: { supplierId, blockId: trimmedBlockId } },
    });
    if (!existing) {
      throw new AppError(404, "NOT_FOUND", "등록된 블록 단가를 찾을 수 없습니다.");
    }

    const nextCapable = input.isCapable ?? existing.isCapable;
    const rawPrice =
      !nextCapable ? input.price : input.price !== undefined ? input.price : existing.price;
    const nextAvgRef = input.isAvgReference ?? existing.isAvgReference;
    const normalized = normalizeRatePayload(nextCapable, rawPrice, nextAvgRef);

    const updated = await tx.supplierRate.update({
      where: { id: existing.id },
      data: {
        price: normalized.price,
        isCapable: normalized.isCapable,
        isAvgReference: normalized.isAvgReference,
      },
    });

    const capableCount = await tx.supplierRate.count({
      where: { supplierId, isCapable: true, price: { gt: 0 } },
    });
    const rateCompleted = capableCount > 0;
    const now = new Date();

    await tx.supplierProfile.update({
      where: { userId: supplierId },
      data: { rateCompleted, rateCheckedAt: now },
    });

    if (!profile.rateCompleted && rateCompleted) {
      await logEvent(tx, {
        type: "SUPPLIER_RATE_COMPLETED",
        userId: supplierId,
        sessionId: sessionId ?? null,
      });
    }

    return {
      rate: {
        id: updated.id,
        blockId: updated.blockId,
        price: updated.price,
        isCapable: updated.isCapable,
        isAvgReference: updated.isAvgReference,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
      rateCompleted,
    };
  });
}
