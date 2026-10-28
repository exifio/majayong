import type { ContractActor, ContractRecord } from './contract-workflow.js';
import type { InstallmentStage } from './settlement.js';
import { TradeError } from './errors.js';

export interface ContractHttpRequest {
  params: { applicationId?: string };
  body: unknown;
}

export interface ContractHttpResponse {
  json(body: unknown): unknown;
  redirect(status: number, url: string): unknown;
}

export type ContractHttpNext = (error?: unknown) => void;
export type ContractRequestHandler<Request, Response> = (
  request: Request,
  response: Response,
  next: ContractHttpNext,
) => void | Promise<void>;

export interface ContractRouteRegistrar<Request, Response> {
  post(path: string, handler: ContractRequestHandler<Request, Response>): unknown;
  get(path: string, handler: ContractRequestHandler<Request, Response>): unknown;
}

export interface ContractWorkflowService {
  // 계약 생성은 수락된 지원서에서 서버가 금액·명세를 읽는다. 클라이언트가 보낸 금액은 받지 않는다.
  createContract(input: {
    applicationId: string;
    actor: ContractActor;
    interimRatio?: number;
    installmentStageBySpecItemId: Readonly<Record<string, InstallmentStage>>;
  }): Promise<ContractRecord>;
  sign(input: { applicationId: string; actor: ContractActor; contentHash: string }): Promise<ContractRecord>;
  getPdfDownloadUrl(actor: ContractActor, applicationId: string, bucket: string): Promise<string>;
}

export function registerContractRoutes<Request extends ContractHttpRequest, Response extends ContractHttpResponse>(
  router: ContractRouteRegistrar<Request, Response>,
  options: {
    workflow: ContractWorkflowService;
    bucket: string;
    getAuth: (request: Request) => ContractActor;
    mapTradeError: (error: TradeError) => unknown;
  },
): void {
  router.post('/:applicationId', async (request, response, next) => {
    try {
      const applicationId = getApplicationId(request);
      const contract = await options.workflow.createContract({
        applicationId,
        actor: options.getAuth(request),
        ...getCreateContractBody(request.body),
      });
      response.json({ contractId: contract.id, status: contract.status });
    } catch (error: unknown) {
      next(error instanceof TradeError ? options.mapTradeError(error) : error);
    }
  });

  router.post('/:applicationId/signature', async (request, response, next) => {
    try {
      const applicationId = getApplicationId(request);
      const contentHash = getContentHash(request.body);
      const contract = await options.workflow.sign({
        applicationId,
        actor: options.getAuth(request),
        contentHash,
      });
      response.json({ status: contract.status });
    } catch (error: unknown) {
      next(error instanceof TradeError ? options.mapTradeError(error) : error);
    }
  });

  router.get('/:applicationId/pdf', async (request, response, next) => {
    try {
      const applicationId = getApplicationId(request);
      const signedUrl = await options.workflow.getPdfDownloadUrl(
        options.getAuth(request),
        applicationId,
        options.bucket,
      );
      response.redirect(302, signedUrl);
    } catch (error: unknown) {
      next(error instanceof TradeError ? options.mapTradeError(error) : error);
    }
  });
}

function getApplicationId(request: ContractHttpRequest): string {
  const applicationId = request.params.applicationId;
  if (!applicationId?.trim()) throw new TradeError('APPLICATION_ID_REQUIRED');
  return applicationId;
}

function getCreateContractBody(body: unknown): {
  interimRatio?: number;
  installmentStageBySpecItemId: Readonly<Record<string, InstallmentStage>>;
} {
  if (!isRecord(body)) {
    throw new TradeError('INVALID_CONTRACT_CREATE_BODY');
  }
  // 금액처럼 서버가 정해야 하는 값을 body로 보내면 조용히 무시하지 않고 거부한다.
  if (Object.keys(body).some((key) => key !== 'interimRatio' && key !== 'installmentStageBySpecItemId')) {
    throw new TradeError('INVALID_CONTRACT_CREATE_BODY');
  }
  const assignment = body.installmentStageBySpecItemId;
  if (!isRecord(assignment)) {
    throw new TradeError('INVALID_INSTALLMENT_STAGE_ASSIGNMENT');
  }
  const stages: Record<string, InstallmentStage> = {};
  for (const [specItemId, stage] of Object.entries(assignment)) {
    if (!specItemId.trim() || (stage !== 'INTERIM' && stage !== 'FINAL')) {
      throw new TradeError('INVALID_INSTALLMENT_STAGE_ASSIGNMENT');
    }
    stages[specItemId] = stage;
  }
  const ratio = body.interimRatio;
  if (ratio === undefined) return { installmentStageBySpecItemId: stages };
  if (typeof ratio !== 'number') throw new TradeError('INVALID_RATIO');
  return { interimRatio: ratio, installmentStageBySpecItemId: stages };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getContentHash(body: unknown): string {
  if (
    typeof body !== 'object' ||
    body === null ||
    !('contentHash' in body) ||
    typeof body.contentHash !== 'string' ||
    !body.contentHash.trim()
  ) {
    throw new TradeError('INVALID_CONTENT_HASH');
  }
  return body.contentHash;
}
