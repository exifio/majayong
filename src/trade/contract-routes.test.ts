import { expect, test } from '@jest/globals';
import { TradeError } from './errors.js';
import { createContractWorkflow, type ContractActor, type ContractRecord, type ContractWorkflowPorts, type ContractStorage } from './contract-workflow.js';
import {
  registerContractRoutes,
  type ContractHttpRequest,
  type ContractHttpResponse,
  type ContractHttpNext,
  type ContractRequestHandler,
  type ContractRouteRegistrar,
} from './contract-routes.js';

type TestTransaction = { contract: ContractRecord; transitions: number };
type TestRequest = ContractHttpRequest & { auth?: ContractActor };
type TestResponse = ContractHttpResponse & {
  body: unknown;
  redirectStatus: number | null;
  redirectUrl: string | null;
};

const pdfHash = `sha256:${'a'.repeat(64)}`;
const pdfPath = `contracts/contract-1/${'a'.repeat(64)}.pdf`;

function makeWorkflow(initialStatus: ContractRecord['status'] = 'PENDING_CONSENT') {
  let database: TestTransaction = {
    contract: {
      id: 'contract-1',
      applicationId: 'application-1',
      status: initialStatus,
      contentHash: pdfHash,
      clientSignedAt: initialStatus === 'PENDING_CONSENT' ? null : new Date('2026-10-27T12:00:00.000Z'),
      supplierSignedAt: initialStatus === 'PENDING_CONSENT' ? null : new Date('2026-10-27T12:05:00.000Z'),
      pdfUrl: pdfPath,
    },
    transitions: 0,
  };
  const ports: ContractWorkflowPorts<TestTransaction> = {
    transaction: async (work) => {
      const staged = structuredClone(database);
      const result = await work(staged);
      database = staged;
      return result;
    },
    getAcceptedApplicationContext: async () => ({ clientId: 'client-1', supplierId: 'supplier-1' }),
    getContractParticipants: async () => ({ clientId: 'client-1', supplierId: 'supplier-1' }),
    findContractForUpdate: async (tx) => tx.contract,
    findContract: async (tx) => tx.contract,
    updateContractSignature: async (tx, _id, fields) => {
      tx.contract = { ...tx.contract, ...fields };
      return tx.contract;
    },
    transitionProjectForContract: async (tx) => {
      tx.transitions += 1;
      return undefined;
    },
  };
  const storage: ContractStorage = {
    uploadPrivateObject: async () => undefined,
    createSignedUrl: async () => 'https://storage.invalid/signed.pdf',
  };
  return {
    workflow: createContractWorkflow(ports, storage, () => new Date('2026-10-27T12:00:00.000Z')),
    state: () => database,
  };
}

function routeFixture(status: ContractRecord['status'] = 'PENDING_CONSENT') {
  const { workflow, state } = makeWorkflow(status);
  const errors: unknown[] = [];
  const registered: { postPath?: string; getPath?: string } = {};
  let post: ContractRequestHandler<TestRequest, TestResponse> | undefined;
  let get: ContractRequestHandler<TestRequest, TestResponse> | undefined;
  const router: ContractRouteRegistrar<TestRequest, TestResponse> = {
    post: (path, handler) => {
      registered.postPath = path;
      post = handler;
    },
    get: (path, handler) => {
      registered.getPath = path;
      get = handler;
    },
  };
  registerContractRoutes(router, {
    workflow,
    bucket: 'contracts',
    getAuth: (req) => {
      if (!req.auth) throw new TradeError('UNAUTHORIZED');
      return req.auth;
    },
    mapTradeError: (error) => ({ code: error.code }),
  });
  if (!post || !get) throw new Error('contract handlers were not registered');
  return { post, get, state, errors, registered };
}

function response(): TestResponse {
  return {
    body: undefined,
    redirectStatus: null,
    redirectUrl: null,
    json(body) { this.body = body; },
    redirect(status, url) {
      this.redirectStatus = status;
      this.redirectUrl = url;
    },
  };
}

test('계약 라우트는 로그인 사용자만 서명에 쓰고 요청 본문 속 사용자 정보는 무시한다', async () => {
  const routes = routeFixture();
  const res = response();
  const next: ContractHttpNext = (error) => { if (error !== undefined) routes.errors.push(error); };

  await routes.post({
    params: { applicationId: 'application-1' },
    body: { contentHash: pdfHash, userId: 'supplier-1', role: 'SUPPLIER' },
    auth: { userId: 'client-1', role: 'CLIENT' },
  }, res, next);

  expect(routes.registered.postPath).toBe('/:applicationId/signature');
  expect(res.body).toEqual({ status: 'PENDING_CONSENT' });
  expect(routes.state().contract.clientSignedAt).toEqual(new Date('2026-10-27T12:00:00.000Z'));
  expect(routes.errors).toEqual([]);
});

test('PDF 라우트는 서명된 계약의 짧은 signed URL로 임시 redirect한다', async () => {
  const routes = routeFixture('ACTIVE');
  const res = response();
  const next: ContractHttpNext = (error) => { if (error !== undefined) routes.errors.push(error); };

  await routes.get({
    params: { applicationId: 'application-1' },
    body: undefined,
    auth: { userId: 'supplier-1', role: 'SUPPLIER' },
  }, res, next);

  expect(routes.registered.getPath).toBe('/:applicationId/pdf');
  expect(res.redirectStatus).toBe(302);
  expect(res.redirectUrl).toBe('https://storage.invalid/signed.pdf');
  expect(routes.errors).toEqual([]);
});

test('서명 요청 본문이 잘못되면 계약 저장 없이 공통 오류 변환기로 전달한다', async () => {
  const routes = routeFixture();
  const res = response();
  const next: ContractHttpNext = (error) => { if (error !== undefined) routes.errors.push(error); };

  await routes.post({
    params: { applicationId: 'application-1' },
    body: { contentHash: ['not', 'a', 'hash'] },
    auth: { userId: 'client-1', role: 'CLIENT' },
  }, res, next);

  expect(routes.state().contract.clientSignedAt).toBeNull();
  expect(routes.errors).toEqual([{ code: 'INVALID_CONTENT_HASH' }]);
});

test('인증 실패는 A의 인증 오류로 그대로 넘긴다', async () => {
  const routes = routeFixture();
  const res = response();
  const next: ContractHttpNext = (error) => { if (error !== undefined) routes.errors.push(error); };

  await routes.get({ params: { applicationId: 'application-1' }, body: undefined }, res, next);

  expect(routes.errors).toEqual([{ code: 'UNAUTHORIZED' }]);
  expect(res.redirectUrl).toBeNull();
});
