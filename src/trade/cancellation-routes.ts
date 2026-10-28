import type { CancellationParty } from './cancellation.js';
import { TradeError } from './errors.js';

export interface CancellationHttpRequest {
  params: { contractId?: string };
  body: unknown;
}

export interface CancellationHttpResponse {
  json(body: unknown): unknown;
}

export type CancellationRequestHandler<Request, Response> = (
  request: Request,
  response: Response,
  next: (error?: unknown) => void,
) => void | Promise<void>;

export interface CancellationRouteRegistrar<Request, Response> {
  post(path: string, handler: CancellationRequestHandler<Request, Response>): unknown;
}

// A가 createCancellationWorkflow에 Prisma adapter를 붙여 만드는 서비스다.
export interface CancellationWorkflowService {
  requestCancellation(input: {
    contractId: string;
    actor: { userId: string; role: 'CLIENT' | 'SUPPLIER' | 'ADMIN'; sessionId?: string };
    party?: CancellationParty;
    reason: string;
  }): Promise<unknown>;
  processCancellation(input: {
    contractId: string;
    actor: { userId: string; role: 'CLIENT' | 'SUPPLIER' | 'ADMIN'; sessionId?: string };
    party: CancellationParty;
    reason: string;
    negotiatedCompensation?: number;
    compensationPercent?: number;
  }): Promise<unknown>;
}

// A의 /api/contracts router 아래에 붙이는 상대 경로다.
export function registerCancellationRoutes<
  Request extends CancellationHttpRequest,
  Response extends CancellationHttpResponse,
>(
  router: CancellationRouteRegistrar<Request, Response>,
  options: {
    workflow: CancellationWorkflowService;
    getAuth: (request: Request) => {
      userId: string;
      role: 'CLIENT' | 'SUPPLIER' | 'ADMIN';
      sessionId?: string;
    };
    mapTradeError: (error: TradeError) => unknown;
  },
): void {
  router.post('/:contractId/cancellation-requests', async (request, response, next) => {
    try {
      const contractId = getParam(request.params.contractId);
      const body = getRequestCancellationBody(request.body);
      const result = await options.workflow.requestCancellation({
        contractId,
        actor: options.getAuth(request),
        ...body,
      });
      response.json(result);
    } catch (error: unknown) {
      next(error instanceof TradeError ? options.mapTradeError(error) : error);
    }
  });

  router.post('/:contractId/cancellation', async (request, response, next) => {
    try {
      const contractId = getParam(request.params.contractId);
      const body = getProcessCancellationBody(request.body);
      const result = await options.workflow.processCancellation({
        contractId,
        actor: options.getAuth(request),
        ...body,
      });
      response.json(result);
    } catch (error: unknown) {
      next(error instanceof TradeError ? options.mapTradeError(error) : error);
    }
  });
}

function getParam(value: string | undefined): string {
  if (!value?.trim()) throw new TradeError('CONTRACT_ID_REQUIRED');
  return value;
}

function getRequestCancellationBody(body: unknown): { reason: string; party?: CancellationParty } {
  if (!isRecord(body)) throw new TradeError('INVALID_CANCELLATION_BODY');
  const reason = getReason(body.reason);
  if (body.party === undefined) return { reason };
  return { reason, party: getParty(body.party) };
}

function getProcessCancellationBody(body: unknown): {
  reason: string;
  party: CancellationParty;
  negotiatedCompensation?: number;
  compensationPercent?: number;
} {
  if (!isRecord(body)) throw new TradeError('INVALID_CANCELLATION_BODY');
  const result: {
    reason: string;
    party: CancellationParty;
    negotiatedCompensation?: number;
    compensationPercent?: number;
  } = { reason: getReason(body.reason), party: getParty(body.party) };
  if (body.negotiatedCompensation !== undefined) {
    if (
      typeof body.negotiatedCompensation !== 'number' ||
      !Number.isSafeInteger(body.negotiatedCompensation) ||
      body.negotiatedCompensation < 0
    ) {
      throw new TradeError('INVALID_COMPENSATION_AMOUNT');
    }
    result.negotiatedCompensation = body.negotiatedCompensation;
  }
  if (body.compensationPercent !== undefined) {
    if (typeof body.compensationPercent !== 'number' || !Number.isSafeInteger(body.compensationPercent)) {
      throw new TradeError('INVALID_COMPENSATION_PERCENT');
    }
    result.compensationPercent = body.compensationPercent;
  }
  return result;
}

function getReason(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new TradeError('CANCELLATION_REASON_REQUIRED');
  return value;
}

function getParty(value: unknown): CancellationParty {
  if (value !== 'CLIENT' && value !== 'SUPPLIER' && value !== 'MUTUAL') {
    throw new TradeError('INVALID_CANCELLATION_PARTY');
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
