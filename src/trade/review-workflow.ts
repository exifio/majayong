import type { ContractStatus } from './contract.js';
import { TradeError } from './errors.js';
import { assertReviewableContract, getReviewParty, planReview, type ReviewActor } from './review.js';

type ReviewDraft = ReturnType<typeof planReview>['review'];
type ReviewEvent = ReturnType<typeof planReview>['event'];

export type ReviewRecord = ReviewDraft & { id: string };

export interface ReviewWorkflowPorts<Tx> {
  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T>;
  findReviewContext(tx: Tx, contractId: string): Promise<{
    contract: { id: string; status: ContractStatus; completedAt: Date | null };
    participants: { clientId: string; supplierId: string };
  } | null>;
  listReviewerIds(tx: Tx, contractId: string): Promise<string[]>;
  findRevieweeProfileForUpdate(
    tx: Tx,
    revieweeId: string,
  ): Promise<{ ratingAvg: number | null; reviewCount: number } | null>;
  createReview(tx: Tx, review: ReviewDraft): Promise<ReviewRecord>;
  updateRevieweeProfile(
    tx: Tx,
    revieweeId: string,
    profile: { ratingAvg: number; reviewCount: number },
  ): Promise<void>;
  recordReviewEvent(tx: Tx, event: ReviewEvent): Promise<void>;
}

export function createReviewWorkflow<Tx>(ports: ReviewWorkflowPorts<Tx>, now: () => Date = () => new Date()) {
  return {
    submit(input: {
      contractId: string;
      actor: ReviewActor;
      rating: number;
      comment: string | null;
      tags: string[];
    }): Promise<{ review: ReviewRecord; profile: { revieweeId: string; ratingAvg: number; reviewCount: number } }> {
      return ports.transaction(async (tx) => {
        const context = await ports.findReviewContext(tx, input.contractId);
        if (!context) throw new TradeError('CONTRACT_NOT_FOUND');
        assertReviewableContract(context.contract);
        const { revieweeId } = getReviewParty(input.actor, context.participants);

        // Lock the profile row so simultaneous reviews cannot overwrite each other's average.
        const revieweeProfile = await ports.findRevieweeProfileForUpdate(tx, revieweeId);
        if (!revieweeProfile) throw new TradeError('REVIEW_PROFILE_NOT_FOUND');

        const plan = planReview({
          ...input,
          contract: context.contract,
          participants: context.participants,
          existingReviewerIds: await ports.listReviewerIds(tx, input.contractId),
          revieweeProfile,
          createdAt: now(),
        });
        const review = await ports.createReview(tx, plan.review);
        await ports.updateRevieweeProfile(tx, revieweeId, {
          ratingAvg: plan.profile.ratingAvg,
          reviewCount: plan.profile.reviewCount,
        });
        await ports.recordReviewEvent(tx, plan.event);
        return { review, profile: plan.profile };
      });
    },
  };
}
