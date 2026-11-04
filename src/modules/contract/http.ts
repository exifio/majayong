/** Gate 0: 합의·계약 HTTP 라우터 (API_INDEX #066~#073). */
import { Router, type Request } from 'express';

import { HttpError, sendCreated, sendData } from '../../http/envelope.js';
import { bodyObject, text } from '../../http/parse.js';
import type { AgreementMessage, AgreementSpec } from '../agreement/draft.js';
import { previewAgreementDraft } from '../agreement/draft.js';
import type { AgreementDraftStore } from '../agreement/prisma-adapter.js';
import type { ApplicationRevision } from '../application/submission.js';
import {
  acceptAgreement,
  breakContract,
  contractDocumentFor,
  signContract,
  type ContractActor,
  type ContractItemSource,
  type ContractUnitOfWork,
} from './lifecycle.js';
import {
  getContractDetail,
  listMyContracts,
  type ContractReadPort,
} from './queries.js';

export interface ContractHttpPorts {
  readonly uow: ContractUnitOfWork;
  readonly reads: ContractReadPort;
  readonly applications: {
    findRevision(applicationId: string): Promise<ApplicationRevision | null>;
  };
  readonly agreements: AgreementDraftStore;
  readonly items: {
    listSources(applicationId: string): Promise<readonly ContractItemSource[]>;
  };
  readonly preview: {
    getSpec(applicationId: string): Promise<AgreementSpec | null>;
    getMessages(applicationId: string): Promise<readonly AgreementMessage[]>;
  };
  readonly now: () => Date;
}

function actorOf(request: Request): ContractActor {
  const actor = request.actor;
  if (actor === undefined) throw new HttpError(401, 'UNAUTHENTICATED', '로그인이 필요합니다.');
  return actor;
}

async function requireApplication(
  ports: ContractHttpPorts,
  applicationId: string,
  actor: ContractActor,
): Promise<ApplicationRevision> {
  const application = await ports.applications.findRevision(applicationId);
  if (
    application === null ||
    (actor.userId !== application.clientUserId && actor.userId !== application.supplierId)
  ) {
    throw new HttpError(404, 'APPLICATION_NOT_FOUND', '지원 정보를 찾을 수 없습니다.');
  }
  return application;
}

export function createContractRouter(ports: ContractHttpPorts): Router {
  const router = Router();

  router.get('/applications/:applicationId/agreement-preview', async (request, response) => {
    const actor = actorOf(request);
    const applicationId = request.params.applicationId as string;
    await requireApplication(ports, applicationId, actor);
    const spec = await ports.preview.getSpec(applicationId);
    if (spec === null) {
      throw new HttpError(404, 'APPLICATION_NOT_FOUND', '지원 정보를 찾을 수 없습니다.');
    }
    const [messages, cached] = await Promise.all([
      ports.preview.getMessages(applicationId),
      ports.agreements.get(applicationId),
    ]);
    sendData(
      response,
      previewAgreementDraft({ spec, messages, cached, now: ports.now() }),
    );
  });

  router.post('/applications/:applicationId/agreement/confirm', async (request, response) => {
    const actor = actorOf(request);
    if (actor.role !== 'CLIENT') {
      throw new HttpError(403, 'CLIENT_ONLY', '의뢰인만 합의를 완료할 수 있습니다.');
    }
    bodyObject(request.body, []);
    const applicationId = request.params.applicationId as string;
    const application = await requireApplication(ports, applicationId, actor);
    const [agreement, items] = await Promise.all([
      ports.agreements.get(applicationId),
      ports.items.listSources(applicationId),
    ]);
    const result = await acceptAgreement(ports.uow, {
      actor,
      application,
      agreement,
      items,
      now: ports.now(),
    });
    sendCreated(response, result);
  });

  router.get('/me/contracts', async (request, response) => {
    const rows = await listMyContracts(ports.reads, { actor: actorOf(request) });
    sendData(response, rows);
  });

  router.get('/contracts/:contractId', async (request, response) => {
    const contract = await getContractDetail(ports.reads, {
      actor: actorOf(request),
      contractId: request.params.contractId as string,
    });
    sendData(response, contract);
  });

  router.get('/contracts/:contractId/document', async (request, response) => {
    const actor = actorOf(request);
    const contract = await getContractDetail(ports.reads, {
      actor,
      contractId: request.params.contractId as string,
    });
    sendData(response, contractDocumentFor(contract, actor));
  });

  router.post('/contracts/:contractId/sign', async (request, response) => {
    const body = bodyObject(request.body, ['expectedContentHash']);
    const result = await signContract(ports.uow, {
      contractId: request.params.contractId as string,
      actor: actorOf(request),
      expectedContentHash: text(body.expectedContentHash, 'expectedContentHash', { max: 128 }) as string,
      now: ports.now(),
    });
    sendData(response, result);
  });

  router.post('/contracts/:contractId/decline', async (request, response) => {
    const actor = actorOf(request);
    if (actor.role !== 'SUPPLIER') {
      throw new HttpError(403, 'FORBIDDEN', '공급자만 서명을 거절할 수 있습니다.');
    }
    bodyObject(request.body, []);
    const result = await breakContract(ports.uow, {
      contractId: request.params.contractId as string,
      reason: 'SIGN_REFUSED',
      actor,
      now: ports.now(),
    });
    sendData(response, result);
  });

  router.post('/contracts/:contractId/cancel-provisional', async (request, response) => {
    const actor = actorOf(request);
    if (actor.role !== 'CLIENT') {
      throw new HttpError(403, 'FORBIDDEN', '의뢰인만 임시 계약을 취소할 수 있습니다.');
    }
    bodyObject(request.body, []);
    const result = await breakContract(ports.uow, {
      contractId: request.params.contractId as string,
      reason: 'CLIENT_CANCELLED',
      actor,
      now: ports.now(),
    });
    sendData(response, result);
  });

  return router;
}
