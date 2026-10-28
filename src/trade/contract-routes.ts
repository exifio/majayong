import type { ContractActor, ContractRecord } from './contract-workflow.js';
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
