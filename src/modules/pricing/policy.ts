export type PriceEstimateBlock = {
  blockId: string;
  name: string;
  status: "ADDED" | "REMOVED" | "SUGGESTED";
  unitPrice: number;
  priceBasis: string;
};

export type PriceEstimate = {
  subtotal: number;
  clientFee: number;
  estimatedTotal: number;
  pendingFeatureCount: number;
  items: Array<PriceEstimateBlock & { includedInEstimate: boolean; sharePercent: number }>;
};

const MAX_INT = 2_147_483_647;

export function calculatePriceEstimate(blocks: PriceEstimateBlock[], pendingFeatureCount: number): PriceEstimate {
  if (!Number.isSafeInteger(pendingFeatureCount) || pendingFeatureCount < 0) throw new RangeError("INVALID_PENDING_FEATURE_COUNT");
  for (const block of blocks) {
    if (!Number.isSafeInteger(block.unitPrice) || block.unitPrice < 0 || block.unitPrice > MAX_INT) {
      throw new RangeError("INVALID_SNAPSHOT_PRICE");
    }
  }

  const subtotalMinor = blocks.reduce((total, block) => total + (block.status === "ADDED" ? BigInt(block.unitPrice) : 0n), 0n);
  const clientFeeMinor = subtotalMinor * 5n / 100n;
  const estimatedTotalMinor = subtotalMinor + clientFeeMinor;
  if (estimatedTotalMinor > BigInt(MAX_INT)) throw new RangeError("ESTIMATE_OUT_OF_RANGE");
  const subtotal = Number(subtotalMinor);
  const clientFee = Number(clientFeeMinor);
  const estimatedTotal = Number(estimatedTotalMinor);

  return {
    subtotal,
    clientFee,
    estimatedTotal,
    pendingFeatureCount,
    items: blocks.map(block => ({
      ...block,
      includedInEstimate: block.status === "ADDED",
      sharePercent: block.status === "ADDED" && subtotalMinor > 0n
        ? Number(BigInt(block.unitPrice) * 1000n / subtotalMinor) / 10
        : 0,
    })),
  };
}
