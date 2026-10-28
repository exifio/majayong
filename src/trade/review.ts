import type { ContractStatus } from './contract.js';
import { TradeError } from './errors.js';

export type ReviewActor = { userId: string; role: 'CLIENT' | 'SUPPLIER' | 'ADMIN' };
type ReviewableContract = { status: ContractStatus; completedAt: Date | null };

export function assertReviewableContract(contract: ReviewableContract): void {
  if (
    contract.status !== 'COMPLETED' ||
    contract.completedAt === null ||
    Number.isNaN(contract.completedAt.getTime())
  ) {
    throw new TradeError('CONTRACT_NOT_COMPLETED');
  }
}

export function getReviewParty(
  actor: ReviewActor,
  participants: { clientId: string; supplierId: string },
): { reviewerRole: 'CLIENT' | 'SUPPLIER'; revieweeId: string } {
  if (actor.role === 'CLIENT' && actor.userId === participants.clientId) {
    return { reviewerRole: 'CLIENT', revieweeId: participants.supplierId };
  }
  if (actor.role === 'SUPPLIER' && actor.userId === participants.supplierId) {
    return { reviewerRole: 'SUPPLIER', revieweeId: participants.clientId };
  }
  throw new TradeError('REVIEW_FORBIDDEN');
}

export function planReview(input: {
  actor: ReviewActor;
  contract: { id: string; status: ContractStatus; completedAt: Date | null };
  participants: { clientId: string; supplierId: string };
  existingReviewerIds: string[];
  revieweeProfile: { ratingAvg: number | null; reviewCount: number };
  rating: number;
  comment: string | null;
  tags: string[];
  createdAt: Date;
}) {
  assertReviewableContract(input.contract);

  const { revieweeId, reviewerRole } = getReviewParty(input.actor, input.participants);
  if (input.existingReviewerIds.includes(input.actor.userId)) {
    throw new TradeError('REVIEW_ALREADY_SUBMITTED');
  }
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    throw new TradeError('INVALID_REVIEW_RATING');
  }
  if (Number.isNaN(input.createdAt.getTime())) throw new TradeError('INVALID_REVIEW_TIME');

  const { ratingAvg, reviewCount } = input.revieweeProfile;
  if (
    !Number.isInteger(reviewCount) ||
    reviewCount < 0 ||
    (reviewCount === 0 && ratingAvg !== null) ||
    (reviewCount > 0 && (ratingAvg === null || !Number.isFinite(ratingAvg) || ratingAvg < 1 || ratingAvg > 5))
  ) {
    throw new TradeError('INVALID_RATING_CACHE');
  }

  const nextCount = reviewCount + 1;
  const nextAverage = ((ratingAvg ?? 0) * reviewCount + input.rating) / nextCount;
  return {
    review: {
      contractId: input.contract.id,
      reviewerId: input.actor.userId,
      revieweeId,
      reviewerRole,
      rating: input.rating,
      comment: input.comment,
      tags: input.tags,
      createdAt: input.createdAt,
    },
    profile: { revieweeId, ratingAvg: nextAverage, reviewCount: nextCount },
    event: {
      type: 'REVIEW_SUBMITTED' as const,
      userId: input.actor.userId,
      payload: { contractId: input.contract.id, revieweeId, rating: input.rating },
    },
  };
}
