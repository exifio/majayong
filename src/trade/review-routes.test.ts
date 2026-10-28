import { expect, test } from '@jest/globals';
import { TradeError } from './errors.js';
import {
  registerReviewRoutes,
  type ReviewHttpRequest,
  type ReviewHttpResponse,
  type ReviewRequestHandler,
  type ReviewRouteRegistrar,
  type ReviewWorkflowService,
} from './review-routes.js';

function fixture(options: { submitError?: Error } = {}) {
  const handlers = new Map<string, ReviewRequestHandler<ReviewHttpRequest, ReviewHttpResponse>>();
  const submissions: Parameters<ReviewWorkflowService['submit']>[0][] = [];
  const workflow: ReviewWorkflowService = {
    submit: async (input) => {
      if (options.submitError) throw options.submitError;
      submissions.push(input);
      return {
        review: {
          id: 'review-1',
          contractId: input.contractId,
          reviewerId: input.actor.userId,
          revieweeId: 'supplier-1',
          reviewerRole: input.actor.role === 'SUPPLIER' ? 'SUPPLIER' : 'CLIENT',
          rating: input.rating,
          comment: input.comment,
          tags: input.tags,
          createdAt: new Date('2026-10-27T13:00:00Z'),
        },
        profile: { revieweeId: 'supplier-1', ratingAvg: 5, reviewCount: 1 },
      };
    },
  };
  const router: ReviewRouteRegistrar<ReviewHttpRequest, ReviewHttpResponse> = {
    post: (path, handler) => { handlers.set(path, handler); },
  };
  registerReviewRoutes(router, {
    workflow,
    getAuth: () => ({ userId: 'client-1', role: 'CLIENT' }),
    mapTradeError: (error) => ({ mapped: error.code }),
  });

  return { handlers, submissions };
}

async function callHandler(
  handler: ReviewRequestHandler<ReviewHttpRequest, ReviewHttpResponse> | undefined,
  request: ReviewHttpRequest,
) {
  let body: unknown;
  const errors: unknown[] = [];
  const response: ReviewHttpResponse = { json: (value) => { body = value; } };
  const next = (error?: unknown) => { if (error !== undefined) errors.push(error); };
  if (!handler) throw new Error('review handler was not registered');
  await handler(request, response, next);
  return { body, errors };
}

test('리뷰 route는 인증 actor와 body를 workflow에 전달하고 저장 결과를 응답한다', async () => {
  const { handlers, submissions } = fixture();
  const result = await callHandler(handlers.get('/:contractId/reviews'), {
    params: { contractId: 'contract-1' },
    body: { rating: 5, comment: '', tags: ['on-time'] },
  });

  expect(submissions).toEqual([{
    contractId: 'contract-1',
    actor: { userId: 'client-1', role: 'CLIENT' },
    rating: 5,
    comment: '',
    tags: ['on-time'],
  }]);
  expect(result.body).toMatchObject({ review: { id: 'review-1' }, profile: { ratingAvg: 5, reviewCount: 1 } });
  expect(result.errors).toEqual([]);
});

test('선택 필드는 빈 문자열과 빈 목록을 보존하고 누락 시 null·빈 목록으로 처리한다', async () => {
  const { handlers, submissions } = fixture();
  await callHandler(handlers.get('/:contractId/reviews'), {
    params: { contractId: 'contract-1' },
    body: { rating: 4 },
  });
  expect(submissions[0]).toMatchObject({ rating: 4, comment: null, tags: [] });
});

test('잘못된 path와 review body는 도메인 오류로 전달한다', async () => {
  const { handlers, submissions } = fixture();
  const handler = handlers.get('/:contractId/reviews');
  const missingId = await callHandler(handler, { params: {}, body: { rating: 5 } });
  const invalid = await callHandler(handler, { params: { contractId: 'contract-1' }, body: { rating: '5' } });
  expect(missingId.errors).toEqual([{ mapped: 'CONTRACT_ID_REQUIRED' }]);
  expect(invalid.errors).toEqual([{ mapped: 'INVALID_REVIEW_RATING' }]);
  expect(submissions).toHaveLength(0);
});

test('comment와 tags의 잘못된 타입은 저장 전에 거부한다', async () => {
  const { handlers, submissions } = fixture();
  const handler = handlers.get('/:contractId/reviews');
  const invalidComment = await callHandler(handler, {
    params: { contractId: 'contract-1' },
    body: { rating: 5, comment: 3 },
  });
  const invalidTags = await callHandler(handler, {
    params: { contractId: 'contract-1' },
    body: { rating: 5, tags: ['valid', 2] },
  });
  expect(invalidComment.errors).toEqual([{ mapped: 'INVALID_REVIEW_COMMENT' }]);
  expect(invalidTags.errors).toEqual([{ mapped: 'INVALID_REVIEW_TAGS' }]);
  expect(submissions).toHaveLength(0);
});

test('workflow 도메인 오류를 공통 mapper로 전달한다', async () => {
  const { handlers } = fixture({ submitError: new TradeError('REVIEW_FORBIDDEN') });
  const result = await callHandler(handlers.get('/:contractId/reviews'), {
    params: { contractId: 'contract-1' },
    body: { rating: 5 },
  });
  expect(result.errors).toEqual([{ mapped: 'REVIEW_FORBIDDEN' }]);
});
