import { expect, test } from '@jest/globals';
import { TradeError } from '../src/trade/errors.ts';
import {
  createContractWorkflow,
  type ContractRecord,
  type ContractWorkflowPorts,
  type ContractStorage,
} from '../src/trade/contract-workflow.ts';
import { prepareContractPdf } from '../src/trade/contract-pdf.ts';
import {
  createSupabaseContractStorage,
  type SupabaseStorageClient,
} from '../src/trade/supabase-contract-storage.ts';

type TransitionAction = {
  type: 'CONTRACT_SIGNED';
  actorUserId: string;
  sessionId: string | null;
};

type TestTransaction = {
  contract: ContractRecord;
  transitions: TransitionAction[];
};

const fixedTime = new Date('2026-10-27T12:00:00.000Z');
const pdfHash = `sha256:${'a'.repeat(64)}`;
const pdfFixtureHash = 'sha256:025bfabf088fa4396e6638c23e49688c077386554ebe472d6f941d8974bda128';

function contract(overrides: Partial<ContractRecord> = {}): ContractRecord {
  return {
    id: 'contract-1',
    applicationId: 'application-1',
    status: 'PENDING_CONSENT',
    contentHash: pdfHash,
    clientSignedAt: null,
    supplierSignedAt: null,
    pdfUrl: `contracts/contract-1/${'a'.repeat(64)}.pdf`,
    ...overrides,
  };
}

function fixture(options: { transitionError?: Error; initial?: ContractRecord } = {}) {
  let database: TestTransaction = { contract: options.initial ?? contract(), transitions: [] };
  const signedUrlCalls: { bucket: string; path: string; expiresInSeconds: number; download: true }[] = [];
  const uploads: { bucket: string; path: string; bytes: Uint8Array; contentType: string; upsert: boolean }[] = [];
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
    updateContractSignature: async (tx, _contractId, patch) => {
      tx.contract = { ...tx.contract, ...patch };
      return tx.contract;
    },
    transitionProjectForContract: async (tx, _applicationId, action) => {
      if (options.transitionError) throw options.transitionError;
      tx.transitions.push(action);
      return undefined;
    },
  };
  const storage: ContractStorage = {
    uploadPrivateObject: async (input) => {
      uploads.push(input);
    },
    createSignedUrl: async (input) => {
      signedUrlCalls.push(input);
      return 'https://storage.invalid/signed-contract.pdf';
    },
  };
  return {
    workflow: createContractWorkflow(ports, storage, () => fixedTime),
    state: () => database,
    signedUrlCalls,
    uploads,
  };
}

test('서명은 역할과 지원서 당사자 ID가 모두 맞는 사용자만 할 수 있다', async () => {
  const { workflow, state } = fixture();

  await expect(workflow.sign({
    applicationId: 'application-1',
    actor: { userId: 'client-1', role: 'ADMIN' },
    contentHash: pdfHash,
  })).rejects.toHaveProperty('code', 'CONTRACT_SIGNING_FORBIDDEN');
  await expect(workflow.sign({
    applicationId: 'application-1',
    actor: { userId: 'someone-else', role: 'CLIENT' },
    contentHash: pdfHash,
  })).rejects.toHaveProperty('code', 'CONTRACT_SIGNING_FORBIDDEN');

  expect(state().contract.clientSignedAt).toBeNull();
});

test('한쪽 서명은 보존하지만 두 번째 서명 전에는 ACTIVE 전이를 호출하지 않는다', async () => {
  const { workflow, state } = fixture();

  const result = await workflow.sign({
    applicationId: 'application-1',
    actor: { userId: 'client-1', role: 'CLIENT', sessionId: 'session-client' },
    contentHash: pdfHash,
  });

  expect(result.status).toBe('PENDING_CONSENT');
  expect(state().contract.clientSignedAt).toEqual(fixedTime);
  expect(state().contract.supplierSignedAt).toBeNull();
  expect(state().transitions).toEqual([]);
});

test('두 번째 당사자의 서명과 프로젝트 전이는 같은 트랜잭션에서 수행한다', async () => {
  const { workflow, state } = fixture();

  await workflow.sign({
    applicationId: 'application-1',
    actor: { userId: 'client-1', role: 'CLIENT' },
    contentHash: pdfHash,
  });
  const result = await workflow.sign({
    applicationId: 'application-1',
    actor: { userId: 'supplier-1', role: 'SUPPLIER', sessionId: 'session-supplier' },
    contentHash: pdfHash,
  });

  expect(result.status).toBe('ACTIVE');
  expect(state().transitions).toEqual([{
    type: 'CONTRACT_SIGNED',
    actorUserId: 'supplier-1',
    sessionId: 'session-supplier',
  }]);
});

test('PDF 파일 또는 PDF 해시가 아직 저장되지 않은 계약은 서명할 수 없다', async () => {
  for (const initial of [
    contract({ pdfUrl: null }),
    contract({ contentHash: null }),
    contract({ contentHash: 'not-a-sha256-hash' }),
  ]) {
    const { workflow, state } = fixture({ initial });
    await expect(workflow.sign({
      applicationId: 'application-1',
      actor: { userId: 'client-1', role: 'CLIENT' },
      contentHash: pdfHash,
    })).rejects.toHaveProperty('code', 'CONTRACT_PDF_NOT_READY');
    expect(state().contract.clientSignedAt).toBeNull();
  }
});

test('잘못된 형식의 저장 해시는 같은 값으로 요청해도 서명을 막는다', async () => {
  const initial = contract({
    contentHash: 'sha256:bad',
    pdfUrl: 'contracts/contract-1/bad.pdf',
  });
  const { workflow, state } = fixture({ initial });

  await expect(workflow.sign({
    applicationId: 'application-1',
    actor: { userId: 'client-1', role: 'CLIENT' },
    contentHash: 'sha256:bad',
  })).rejects.toHaveProperty('code', 'CONTRACT_PDF_NOT_READY');
  expect(state().contract.clientSignedAt).toBeNull();
});

test('A 브리지 전이가 실패하면 서명 업데이트도 롤백된다', async () => {
  const initial = contract({
    clientSignedAt: new Date('2026-10-27T11:00:00.000Z'),
  });

  const seeded = fixture({ initial, transitionError: new Error('transition failed') });
  await expect(seeded.workflow.sign({
    applicationId: 'application-1',
    actor: { userId: 'supplier-1', role: 'SUPPLIER' },
    contentHash: pdfHash,
  })).rejects.toThrow('transition failed');
  expect(seeded.state().contract.status).toBe('PENDING_CONSENT');
  expect(seeded.state().contract.supplierSignedAt).toBeNull();
});

test('같은 당사자의 재서명은 중복 기록하지 않는다', async () => {
  const { workflow, state } = fixture();
  const request = {
    applicationId: 'application-1',
    actor: { userId: 'client-1', role: 'CLIENT' as const },
    contentHash: pdfHash,
  };

  await workflow.sign(request);
  await expect(workflow.sign(request)).rejects.toHaveProperty('code', 'ALREADY_SIGNED');
  expect(state().contract.clientSignedAt).toEqual(fixedTime);
});

test('PDF는 실제 바이트 해시의 비공개 경로로 업로드한 뒤 DB 저장 콜백에 전달한다', async () => {
  const { uploads } = fixture();
  const order: string[] = [];
  let persisted: { contentHash: string; pdfUrl: string } | null = null;
  const bytes = new TextEncoder().encode('%PDF-1.7\nfixture\n%%EOF');

  const artifact = await prepareContractPdf({
    bucket: 'contracts',
    contractId: 'contract-1',
    document: { applicationId: 'application-1' },
    renderPdf: async () => bytes,
    storage: {
      uploadPrivateObject: async (input) => {
        order.push('upload');
        uploads.push(input);
      },
      createSignedUrl: async () => 'unused',
    },
    persistArtifact: async (value) => {
      order.push('persist');
      persisted = value;
    },
  });

  expect(artifact.contentHash).toBe(pdfFixtureHash);
  expect(artifact.pdfUrl).toBe(`contracts/contract-1/${pdfFixtureHash.slice(7)}.pdf`);
  expect(uploads[0]).toMatchObject({
    bucket: 'contracts',
    path: artifact.pdfUrl,
    contentType: 'application/pdf',
    upsert: true,
  });
  expect(order).toEqual(['upload', 'persist']);
  expect(persisted).toEqual(artifact);
});

test('PDF renderer가 PDF가 아닌 바이트를 반환하면 Storage나 DB를 호출하지 않는다', async () => {
  const calls: string[] = [];
  await expect(prepareContractPdf({
    bucket: 'contracts',
    contractId: 'contract-1',
    document: {},
    renderPdf: async () => new TextEncoder().encode('not a pdf'),
    storage: {
      uploadPrivateObject: async () => { calls.push('upload'); },
      createSignedUrl: async () => 'unused',
    },
    persistArtifact: async () => { calls.push('persist'); },
  })).rejects.toBeInstanceOf(TradeError);
  expect(calls).toEqual([]);
});

test('계약 PDF 다운로드는 당사자 권한과 양측 서명을 확인하고 짧은 signed URL만 발급한다', async () => {
  const initial = contract({
    status: 'ACTIVE',
    clientSignedAt: fixedTime,
    supplierSignedAt: new Date('2026-10-27T12:05:00.000Z'),
  });
  const { workflow, signedUrlCalls } = fixture({ initial });

  const url = await workflow.getPdfDownloadUrl(
    { userId: 'client-1', role: 'CLIENT' },
    'application-1',
    'contracts',
  );

  expect(url).toBe('https://storage.invalid/signed-contract.pdf');
  expect(signedUrlCalls).toEqual([{
    bucket: 'contracts',
    path: initial.pdfUrl,
    expiresInSeconds: 300,
    download: true,
  }]);
});

test('서명이 끝난 뒤 취소된 계약서도 당사자에게 제공한다', async () => {
  const initial = contract({
    status: 'CANCELLED',
    clientSignedAt: fixedTime,
    supplierSignedAt: new Date('2026-10-27T12:05:00.000Z'),
  });
  const { workflow, signedUrlCalls } = fixture({ initial });

  await expect(workflow.getPdfDownloadUrl(
    { userId: 'supplier-1', role: 'SUPPLIER' },
    'application-1',
    'contracts',
  )).resolves.toBe('https://storage.invalid/signed-contract.pdf');
  expect(signedUrlCalls).toHaveLength(1);
});

test('계약 PDF의 제3자 또는 미서명 계약에는 signed URL을 발급하지 않는다', async () => {
  const { workflow, signedUrlCalls } = fixture({
    initial: contract({ status: 'PENDING_CONSENT', clientSignedAt: fixedTime }),
  });

  await expect(workflow.getPdfDownloadUrl(
    { userId: 'someone-else', role: 'CLIENT' },
    'application-1',
    'contracts',
  )).rejects.toHaveProperty('code', 'CONTRACT_SIGNING_FORBIDDEN');
  await expect(workflow.getPdfDownloadUrl(
    { userId: 'client-1', role: 'CLIENT' },
    'application-1',
    'contracts',
  )).rejects.toHaveProperty('code', 'CONTRACT_NOT_SIGNED');
  expect(signedUrlCalls).toEqual([]);
});

test('Supabase Storage 어댑터가 PDF를 올리고 만료 signed URL을 반환한다', async () => {
  const calls: string[] = [];
  const client: SupabaseStorageClient = {
    storage: {
      from: (bucket) => ({
        upload: async (path, bytes, options) => {
          calls.push(`upload:${bucket}:${path}:${bytes.byteLength}:${options.contentType}:${options.upsert}`);
          return { error: null };
        },
        createSignedUrl: async (path, expiresInSeconds, options) => {
          calls.push(`sign:${bucket}:${path}:${expiresInSeconds}:${options?.download}`);
          return { data: { signedUrl: 'https://storage.invalid/temporary.pdf' }, error: null };
        },
      }),
    },
  };
  const storage = createSupabaseContractStorage(client);

  await storage.uploadPrivateObject({
    bucket: 'contracts',
    path: 'contracts/contract-1/document.pdf',
    bytes: new TextEncoder().encode('%PDF-1.7'),
    contentType: 'application/pdf',
    upsert: true,
  });
  const url = await storage.createSignedUrl({
    bucket: 'contracts',
    path: 'contracts/contract-1/document.pdf',
    expiresInSeconds: 300,
    download: true,
  });

  expect(calls).toEqual([
    'upload:contracts:contracts/contract-1/document.pdf:8:application/pdf:true',
    'sign:contracts:contracts/contract-1/document.pdf:300:true',
  ]);
  expect(url).toBe('https://storage.invalid/temporary.pdf');
});

test('Supabase Storage URL 발급 실패는 일시적 PDF URL 오류로 변환한다', async () => {
  const failure = new Error('signing key unavailable');
  const client: SupabaseStorageClient = {
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        createSignedUrl: async () => ({ data: null, error: failure }),
      }),
    },
  };
  const storage = createSupabaseContractStorage(client);

  await expect(storage.createSignedUrl({
    bucket: 'contracts',
    path: 'contracts/contract-1/document.pdf',
    expiresInSeconds: 300,
    download: true,
  })).rejects.toHaveProperty('code', 'CONTRACT_PDF_URL_FAILED');
});

test('Supabase 업로드 오류가 나면 DB 저장 단계로 진행할 수 있게 오류를 그대로 전달한다', async () => {
  const failure = new Error('bucket unavailable');
  const client: SupabaseStorageClient = {
    storage: {
      from: () => ({
        upload: async () => ({ error: failure }),
        createSignedUrl: async () => ({ data: null, error: null }),
      }),
    },
  };
  const storage = createSupabaseContractStorage(client);

  await expect(storage.uploadPrivateObject({
    bucket: 'contracts',
    path: 'contracts/contract-1/document.pdf',
    bytes: new TextEncoder().encode('%PDF-1.7'),
    contentType: 'application/pdf',
    upsert: true,
  })).rejects.toHaveProperty('code', 'CONTRACT_PDF_UPLOAD_FAILED');
});
