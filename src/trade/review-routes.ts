import { TradeError } from './errors.ts';
import type { ReviewActor } from './review.ts';
import type { ReviewRecord } from './review-workflow.ts';

export interface ReviewHttpRequest {
  params: { contractId?: string };
  body: unknown;
}

export interface ReviewHttpResponse {
  json(body: unknown): unknown;
}

export type ReviewRequestHandler<Request, Response> = (
  request: Request,
  response: Response,
  next: (error?: unknown) => void,
) => void | Promise<void>;

export interface ReviewRouteRegistrar<Request, Response> {
  post(path: string, handler: ReviewRequestHandler<Request, Response>): unknown;
}

export interface ReviewWorkflowService {
  submit(input: {
    contractId: string;
    actor: ReviewActor;
    rating: number;
    comment: string | null;
    tags: string[];
  }): Promise<{
    review: ReviewRecord;
    profile: { revieweeId: string; ratingAvg: number; reviewCount: number };
  }>;
}

export function registerReviewRoutes<Request extends ReviewHttpRequest, Response extends ReviewHttpResponse>(
  router: ReviewRouteRegistrar<Request, Response>,
  options: {
    workflow: ReviewWorkflowService;
    getAuth: (request: Request) => ReviewActor;
    mapTradeError: (error: TradeError) => unknown;
  },
): void {
  router.post('/:contractId/reviews', async (request, response, next) => {
    try {
      const contractId = getContractId(request);
      const review = getReviewInput(request.body);
      const result = await options.workflow.submit({
        contractId,
        actor: options.getAuth(request),
        ...review,
      });
      response.json(result);
    } catch (error: unknown) {
      next(error instanceof TradeError ? options.mapTradeError(error) : error);
    }
  });
}

function getContractId(request: ReviewHttpRequest): string {
  const contractId = request.params.contractId;
  if (!contractId?.trim()) throw new TradeError('CONTRACT_ID_REQUIRED');
  return contractId;
}

function getReviewInput(body: unknown): { rating: number; comment: string | null; tags: string[] } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new TradeError('INVALID_REVIEW_BODY');
  }
  if (!('rating' in body) || typeof body.rating !== 'number') {
    throw new TradeError('INVALID_REVIEW_RATING');
  }

  let comment: string | null = null;
  if ('comment' in body) {
    if (body.comment === null) comment = null;
    else if (typeof body.comment === 'string') comment = body.comment;
    else throw new TradeError('INVALID_REVIEW_COMMENT');
  }

  let tags: string[] = [];
  if ('tags' in body) {
    if (!isStringArray(body.tags)) throw new TradeError('INVALID_REVIEW_TAGS');
    tags = body.tags;
  }
  return { rating: body.rating, comment, tags };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === 'string');
}
