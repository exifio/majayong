import { TradeError } from './errors.js';
import type { DepositStatus, OperatorDepositDecision } from './payment.js';
import type { PaymentActor } from './payment-workflow.js';
import type { PaymentStatus } from './settlement.js';

export interface PaymentHttpRequest {
  params: { contractId?: string; depositId?: string };
  body: unknown;
}

export interface PaymentHttpResponse {
  json(body: unknown): unknown;
}

export type PaymentRequestHandler<Request, Response> = (
  request: Request,
  response: Response,
  next: (error?: unknown) => void,
) => void | Promise<void>;

export interface PaymentRouteRegistrar<Request, Response> {
  post(path: string, handler: PaymentRequestHandler<Request, Response>): unknown;
}

// B createPaymentWorkflow가 제공하는 메서드와 같은 모양이다. A는 Prisma adapter를 붙여 이 서비스를 만든다.
export interface PaymentWorkflowService {
  startDeposit(input: {
    contractId: string;
    actor: PaymentActor;
    idempotencyKey: string;
  }): Promise<{
    depositId: string;
    orderId: string;
    amount: number;
    status: DepositStatus;
    paymentStatus: PaymentStatus;
    replayed: boolean;
  }>;
  confirmDeposit(input: {
    contractId: string;
    depositId: string;
    actor: PaymentActor;
    paymentKey: string;
    orderId: string;
    returnedAmount: number;
  }): Promise<{
    depositStatus: DepositStatus;
    paymentStatus: PaymentStatus;
    creditedAmount: number;
    replayed: boolean;
  }>;
  reviewHeldDeposit(input: {
    contractId: string;
    depositId: string;
    actor: PaymentActor;
    decision: OperatorDepositDecision;
    reason: string;
  }): Promise<{
    depositStatus: DepositStatus;
    paymentStatus: PaymentStatus;
    creditedAmount: number;
  }>;
}

// A의 /api/contracts router 아래에 붙이는 상대 경로다.
export function registerPaymentRoutes<Request extends PaymentHttpRequest, Response extends PaymentHttpResponse>(
  router: PaymentRouteRegistrar<Request, Response>,
  options: {
    workflow: PaymentWorkflowService;
    getAuth: (request: Request) => PaymentActor;
    mapTradeError: (error: TradeError) => unknown;
  },
): void {
  router.post('/:contractId/deposits', async (request, response, next) => {
    try {
      const contractId = getParam(request.params.contractId, 'CONTRACT_ID_REQUIRED');
      const { idempotencyKey } = getIdempotencyBody(request.body);
      const result = await options.workflow.startDeposit({
        contractId,
        actor: options.getAuth(request),
        idempotencyKey,
      });
      response.json(result);
    } catch (error: unknown) {
      next(error instanceof TradeError ? options.mapTradeError(error) : error);
    }
  });

  router.post('/:contractId/deposits/:depositId/confirm', async (request, response, next) => {
    try {
      const contractId = getParam(request.params.contractId, 'CONTRACT_ID_REQUIRED');
      const depositId = getParam(request.params.depositId, 'DEPOSIT_ID_REQUIRED');
      const confirmation = getConfirmationBody(request.body);
      const result = await options.workflow.confirmDeposit({
        contractId,
        depositId,
        actor: options.getAuth(request),
        ...confirmation,
      });
      response.json(result);
    } catch (error: unknown) {
      next(error instanceof TradeError ? options.mapTradeError(error) : error);
    }
  });

  router.post('/:contractId/deposits/:depositId/operator-review', async (request, response, next) => {
    try {
      const contractId = getParam(request.params.contractId, 'CONTRACT_ID_REQUIRED');
      const depositId = getParam(request.params.depositId, 'DEPOSIT_ID_REQUIRED');
      const review = getOperatorReviewBody(request.body);
      const result = await options.workflow.reviewHeldDeposit({
        contractId,
        depositId,
        actor: options.getAuth(request),
        ...review,
      });
      response.json(result);
    } catch (error: unknown) {
      next(error instanceof TradeError ? options.mapTradeError(error) : error);
    }
  });
}

function getParam(value: string | undefined, code: string): string {
  if (!value?.trim()) throw new TradeError(code);
  return value;
}

function getIdempotencyBody(body: unknown): { idempotencyKey: string } {
  if (!isRecord(body) || typeof body.idempotencyKey !== 'string' || !body.idempotencyKey.trim()) {
    throw new TradeError('IDEMPOTENCY_KEY_REQUIRED');
  }
  return { idempotencyKey: body.idempotencyKey };
}

function getConfirmationBody(body: unknown): {
  paymentKey: string;
  orderId: string;
  returnedAmount: number;
} {
  if (!isRecord(body)) throw new TradeError('INVALID_DEPOSIT_CONFIRMATION_BODY');
  if (typeof body.paymentKey !== 'string' || !body.paymentKey.trim()) {
    throw new TradeError('TOSS_PAYMENT_KEY_INVALID');
  }
  if (typeof body.orderId !== 'string' || !body.orderId.trim()) {
    throw new TradeError('PAYMENT_ORDER_ID_REQUIRED');
  }
  if (typeof body.returnedAmount !== 'number' || !Number.isSafeInteger(body.returnedAmount) || body.returnedAmount <= 0) {
    throw new TradeError('TOSS_AMOUNT_MISMATCH');
  }
  return { paymentKey: body.paymentKey, orderId: body.orderId, returnedAmount: body.returnedAmount };
}

function getOperatorReviewBody(body: unknown): {
  decision: OperatorDepositDecision;
  reason: string;
} {
  if (!isRecord(body)) throw new TradeError('INVALID_OPERATOR_REVIEW_BODY');
  if (body.decision !== 'COMPLETE' && body.decision !== 'FAIL') {
    throw new TradeError('INVALID_OPERATOR_REVIEW_DECISION');
  }
  if (typeof body.reason !== 'string' || !body.reason.trim()) {
    throw new TradeError('OPERATOR_REVIEW_REASON_REQUIRED');
  }
  return { decision: body.decision, reason: body.reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
