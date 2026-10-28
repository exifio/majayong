import { expect, test } from '@jest/globals';
import { TradeError } from '../src/trade/errors.ts';
import { planReview } from '../src/trade/review.ts';

const now = new Date('2026-10-27T13:00:00.000Z');
const base = {
  contract: { id: 'contract-1', status: 'COMPLETED' as const, completedAt: now },
  participants: { clientId: 'client-1', supplierId: 'supplier-1' },
  existingReviewerIds: ['previous-reviewer'],
  rating: 5,
  comment: '작업이 좋았습니다.',
  tags: ['communication', 'on-time'],
  createdAt: now,
};

const throwsCode = (fn: () => unknown, code: string) => {
  let thrown: unknown;
  try {
    fn();
  } catch (error: unknown) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(TradeError);
  expect(thrown).toHaveProperty('code', code);
};

test('완료 계약 당사자는 상대방을 한 번 평가하고 평균·개수 캐시를 갱신한다', () => {
  const result = planReview({
    ...base,
    actor: { userId: 'client-1', role: 'CLIENT' },
    revieweeProfile: { ratingAvg: 4, reviewCount: 2 },
  });

  expect(result.review).toEqual({
    contractId: 'contract-1',
    reviewerId: 'client-1',
    revieweeId: 'supplier-1',
    reviewerRole: 'CLIENT',
    rating: 5,
    comment: '작업이 좋았습니다.',
    tags: ['communication', 'on-time'],
    createdAt: now,
  });
  expect(result.profile.revieweeId).toBe('supplier-1');
  expect(result.profile.reviewCount).toBe(3);
  expect(result.profile.ratingAvg).toBeCloseTo(13 / 3);
  expect(result.event).toMatchObject({
    type: 'REVIEW_SUBMITTED',
    userId: 'client-1',
    payload: { contractId: 'contract-1', revieweeId: 'supplier-1', rating: 5 },
  });
});

test('공급자도 상대 의뢰인을 평가하고 첫 리뷰는 평균을 초기화한다', () => {
  const result = planReview({
    ...base,
    actor: { userId: 'supplier-1', role: 'SUPPLIER' },
    rating: 3,
    revieweeProfile: { ratingAvg: null, reviewCount: 0 },
  });
  expect(result.review).toMatchObject({ revieweeId: 'client-1', reviewerRole: 'SUPPLIER' });
  expect(result.profile).toEqual({ revieweeId: 'client-1', ratingAvg: 3, reviewCount: 1 });
});

test('미완료 계약·비당사자·중복·잘못된 별점과 프로필 캐시는 거부한다', () => {
  const valid = {
    ...base,
    actor: { userId: 'client-1', role: 'CLIENT' as const },
    revieweeProfile: { ratingAvg: null, reviewCount: 0 },
  };
  throwsCode(() => planReview({
    ...valid,
    contract: { id: 'contract-1', status: 'ACTIVE', completedAt: null },
  }), 'CONTRACT_NOT_COMPLETED');
  throwsCode(() => planReview({
    ...valid,
    actor: { userId: 'outsider', role: 'CLIENT' },
  }), 'REVIEW_FORBIDDEN');
  throwsCode(() => planReview({ ...valid, existingReviewerIds: ['client-1'] }), 'REVIEW_ALREADY_SUBMITTED');
  throwsCode(() => planReview({ ...valid, rating: 6 }), 'INVALID_REVIEW_RATING');
  throwsCode(() => planReview({
    ...valid,
    revieweeProfile: { ratingAvg: null, reviewCount: 1 },
  }), 'INVALID_RATING_CACHE');
});
