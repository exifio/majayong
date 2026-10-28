import { expect, test } from '@jest/globals';
import {
  createReviewWorkflow,
  type ReviewRecord,
  type ReviewWorkflowPorts,
} from '../src/trade/review-workflow.ts';

type TestTransaction = {
  context: {
    contract: { id: string; status: 'COMPLETED' | 'ACTIVE'; completedAt: Date | null };
    participants: { clientId: string; supplierId: string };
  } | null;
  profiles: Record<string, { ratingAvg: number | null; reviewCount: number }>;
  reviews: ReviewRecord[];
  events: { type: 'REVIEW_SUBMITTED'; userId: string; payload: Record<string, string | number> }[];
};

const now = new Date('2026-10-27T13:00:00.000Z');

function fixture(options: { eventError?: Error } = {}) {
  let database: TestTransaction = {
    context: {
      contract: { id: 'contract-1', status: 'COMPLETED', completedAt: now },
      participants: { clientId: 'client-1', supplierId: 'supplier-1' },
    },
    profiles: { 'supplier-1': { ratingAvg: 4, reviewCount: 2 } },
    reviews: [],
    events: [],
  };

  const ports: ReviewWorkflowPorts<TestTransaction> = {
    transaction: async (work) => {
      const staged = structuredClone(database);
      const result = await work(staged);
      database = staged;
      return result;
    },
    findReviewContext: async (tx) => tx.context,
    listReviewerIds: async (tx) => tx.reviews.map((review) => review.reviewerId),
    findRevieweeProfileForUpdate: async (tx, revieweeId) => tx.profiles[revieweeId] ?? null,
    createReview: async (tx, input) => {
      const review = { id: `review-${tx.reviews.length + 1}`, ...input };
      tx.reviews.push(review);
      return review;
    },
    updateRevieweeProfile: async (tx, revieweeId, profile) => {
      tx.profiles[revieweeId] = profile;
    },
    recordReviewEvent: async (tx, event) => {
      if (options.eventError) throw options.eventError;
      tx.events.push(event);
    },
  };

  return { workflow: createReviewWorkflow(ports, () => now), state: () => database };
}

const reviewInput = {
  contractId: 'contract-1',
  actor: { userId: 'client-1', role: 'CLIENT' as const },
  rating: 5,
  comment: '좋았습니다.',
  tags: ['communication'],
};

test('리뷰·평점 캐시·이벤트를 하나의 트랜잭션으로 저장한다', async () => {
  const { workflow, state } = fixture();
  const result = await workflow.submit(reviewInput);

  expect(result.review).toMatchObject({
    id: 'review-1',
    contractId: 'contract-1',
    reviewerId: 'client-1',
    revieweeId: 'supplier-1',
    reviewerRole: 'CLIENT',
    rating: 5,
  });
  expect(state().profiles['supplier-1']).toEqual({ ratingAvg: 13 / 3, reviewCount: 3 });
  expect(state().reviews).toHaveLength(1);
  expect(state().events).toEqual([{
    type: 'REVIEW_SUBMITTED',
    userId: 'client-1',
    payload: { contractId: 'contract-1', revieweeId: 'supplier-1', rating: 5 },
  }]);
});

test('당사자 외 사용자는 쓰기를 만들지 못하고 작성자 중복도 막는다', async () => {
  const { workflow, state } = fixture();
  await expect(workflow.submit({
    ...reviewInput,
    actor: { userId: 'outsider', role: 'CLIENT' },
  })).rejects.toHaveProperty('code', 'REVIEW_FORBIDDEN');
  await expect(workflow.submit({
    ...reviewInput,
    actor: { userId: 'admin-1', role: 'ADMIN' },
  })).rejects.toHaveProperty('code', 'REVIEW_FORBIDDEN');

  await workflow.submit(reviewInput);
  await expect(workflow.submit(reviewInput)).rejects.toHaveProperty('code', 'REVIEW_ALREADY_SUBMITTED');
  expect(state().reviews).toHaveLength(1);
  expect(state().events).toHaveLength(1);
});

test('계약이 완료되지 않았거나 상대 프로필이 없으면 저장하지 않는다', async () => {
  const { workflow, state } = fixture();
  const context = state().context;
  if (context === null) throw new Error('fixture context missing');
  context.contract = { id: 'contract-1', status: 'ACTIVE', completedAt: null };
  await expect(workflow.submit(reviewInput)).rejects.toHaveProperty('code', 'CONTRACT_NOT_COMPLETED');
  expect(state().reviews).toHaveLength(0);

  context.contract = { id: 'contract-1', status: 'COMPLETED', completedAt: now };
  delete state().profiles['supplier-1'];
  await expect(workflow.submit(reviewInput)).rejects.toHaveProperty('code', 'REVIEW_PROFILE_NOT_FOUND');
  expect(state().reviews).toHaveLength(0);
});

test('이벤트 기록 실패 시 리뷰와 평점 갱신도 롤백된다', async () => {
  const { workflow, state } = fixture({ eventError: new Error('event write failed') });
  await expect(workflow.submit(reviewInput)).rejects.toThrow('event write failed');
  expect(state().reviews).toHaveLength(0);
  expect(state().profiles['supplier-1']).toEqual({ ratingAvg: 4, reviewCount: 2 });
  expect(state().events).toHaveLength(0);
});

test('누락 계약은 도메인 오류로 거부한다', async () => {
  const { workflow, state } = fixture();
  state().context = null;
  await expect(workflow.submit(reviewInput)).rejects.toHaveProperty('code', 'CONTRACT_NOT_FOUND');
});
