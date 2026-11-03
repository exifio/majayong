import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { AgreementDraft } from '../../src/modules/agreement/draft.ts';
import {
  ApplicationAccessError,
  ApplicationError,
  requireApplicationParty,
} from '../../src/modules/application/dto.ts';
import { summarizeBMetrics, type BMetricSource } from '../../src/modules/application/metrics.ts';
import {
  assertContractableRevision,
  compareApplicationCards,
  type ApplicationRevision,
} from '../../src/modules/application/submission.ts';
import {
  acceptAgreement,
  ContractError,
  contractDocumentFor,
  type ContractRecord,
  type ContractTx,
  type ContractUnitOfWork,
} from '../../src/modules/contract/lifecycle.ts';
import { applicationRecord, applicationRevision, chatMessage, FIXED_NOW } from './fixtures.ts';

function buildMetricSource(): BMetricSource {
  return {
    quotes: [
      { firstViewedAt: new Date('2026-11-03T08:00:00.000Z'), submittedAt: new Date('2026-11-03T10:00:00.000Z') },
      { firstViewedAt: new Date('2026-11-03T09:00:00.000Z'), submittedAt: new Date('2026-11-03T10:00:00.000Z') },
    ],
    appliedProjectIds: ['project-1', 'project-1', 'project-2', 'project-3'],
    inquiryOpenedProjectIds: ['project-1', 'project-3', 'project-outside-window'],
    contractEvents: [
      { type: 'APPLICATION_ACCEPTED', contractId: 'contract-1', conditionCount: 10, decidedCount: 9 },
      { type: 'APPLICATION_ACCEPTED', contractId: 'contract-1', conditionCount: 10, decidedCount: 9 },
      { type: 'APPLICATION_ACCEPTED', contractId: 'contract-2', conditionCount: 4, decidedCount: 2 },
      { type: 'APPLICATION_ACCEPTED', contractId: 'contract-3', conditionCount: 2, decidedCount: 2 },
      { type: 'CONTRACT_AGREED', contractId: 'contract-1' },
      { type: 'CONTRACT_AGREED', contractId: 'contract-1' },
      { type: 'CONTRACT_AGREED', contractId: 'contract-2' },
      { type: 'CONTRACT_AGREED', contractId: 'contract-3' },
      { type: 'CONTRACT_BROKEN', contractId: 'contract-1', reason: 'SIGN_REFUSED' },
      { type: 'CONTRACT_BROKEN', contractId: 'contract-3', reason: 'DEPOSIT_TIMEOUT' },
      // ERD EventLog는 양쪽 당사자에 기록되므로 중복 이벤트 1건도 dedupe한다.
      { type: 'CONTRACT_BROKEN', contractId: 'contract-1', reason: 'SIGN_REFUSED' },
    ],
    reports: [
      { chatRoomId: 'room-1', action: 'WARNING' },
      { chatRoomId: 'room-1', action: 'CHAT_RESTRICT_7D' },
      { chatRoomId: 'room-3', action: null },
    ],
    chatRoomCount: 4,
  };
}

function isError(code: string) {
  return (error: unknown): boolean =>
    (error instanceof ApplicationAccessError ||
      error instanceof ApplicationError ||
      error instanceof ContractError) && error.code === code;
}

describe('B-08-T01 지표 이벤트 샘플·개인정보 최소화', () => {
  it('견적 시간·문의율·조건 결정률·결렬률·신고 분포를 원천 데이터로 재계산한다', () => {
    const summary = summarizeBMetrics(buildMetricSource());
    assert.deepEqual(summary, {
      quoteDraft: { count: 2, averageDurationMs: 5_400_000 },
      inquiryRate: { eligibleProjects: 3, projectsWithInquiry: 2, rate: 2 / 3 },
      conditionDecisionRate: { totalConditions: 16, decidedConditions: 13, rate: 13 / 16 },
      contractBreakRate: {
        acceptedContracts: 3, brokenContracts: 2, rate: 2 / 3,
        byReason: { CONSENT_TIMEOUT: 0, SIGN_REFUSED: 1, CLIENT_CANCELLED: 0, DEPOSIT_TIMEOUT: 1 },
      },
      depositTimeoutRate: { agreedContracts: 3, depositTimeouts: 1, rate: 1 / 3 },
      reportRate: {
        chatRooms: 4, reportedRooms: 2, reports: 3, reportsPerChatRoom: 0.75, rate: 0.5,
        byAction: { UNRESOLVED: 1, NONE: 0, WARNING: 1, CHAT_RESTRICT_7D: 1, SUSPEND: 0 },
      },
    });

    const serialized = JSON.stringify(summary);
    for (const privateValue of ['client-1', 'supplier-1', 'owner@example.com', 'project-1', 'room-1']) {
      assert.equal(serialized.includes(privateValue), false);
    }
  });

  it('조건·시간 데이터가 잘못되면 잘못된 지표 대신 거부한다', () => {
    const invalid: BMetricSource = {
      ...buildMetricSource(),
      quotes: [{ firstViewedAt: new Date('2026-11-04T10:00:00.000Z'), submittedAt: new Date('2026-11-03T10:00:00.000Z') }],
    };
    assert.throws(() => summarizeBMetrics(invalid), /INVALID_METRIC_SOURCE/);
    const invalidAgreement: BMetricSource = {
      ...buildMetricSource(),
      contractEvents: [{ type: 'APPLICATION_ACCEPTED', contractId: 'contract-1', conditionCount: 1, decidedCount: 2 }],
    };
    assert.throws(() => summarizeBMetrics(invalidAgreement), /INVALID_METRIC_SOURCE/);
    const empty = summarizeBMetrics({
      quotes: [], appliedProjectIds: [], inquiryOpenedProjectIds: [], contractEvents: [], reports: [], chatRoomCount: 0,
    });
    assert.deepEqual(empty, {
      quoteDraft: { count: 0, averageDurationMs: 0 },
      inquiryRate: { eligibleProjects: 0, projectsWithInquiry: 0, rate: 0 },
      conditionDecisionRate: { totalConditions: 0, decidedConditions: 0, rate: 0 },
      contractBreakRate: {
        acceptedContracts: 0, brokenContracts: 0, rate: 0,
        byReason: { CONSENT_TIMEOUT: 0, SIGN_REFUSED: 0, CLIENT_CANCELLED: 0, DEPOSIT_TIMEOUT: 0 },
      },
      depositTimeoutRate: { agreedContracts: 0, depositTimeouts: 0, rate: 0 },
      reportRate: {
        chatRooms: 0, reportedRooms: 0, reports: 0, reportsPerChatRoom: 0, rate: 0,
        byAction: { UNRESOLVED: 0, NONE: 0, WARNING: 0, CHAT_RESTRICT_7D: 0, SUSPEND: 0 },
      },
    });
  });
});

describe('B-08-T02 조회 권한·금액·견적 이력', () => {
  it('지원·계약은 당사자만 읽고 타인에게는 자원을 숨긴다', () => {
    assert.doesNotThrow(() => requireApplicationParty(
      { userId: 'client-1', role: 'CLIENT' },
      { clientUserId: 'client-1', supplierUserId: 'supplier-1' },
    ));
    assert.throws(() => requireApplicationParty(
      { userId: 'intruder', role: 'SUPPLIER' },
      { clientUserId: 'client-1', supplierUserId: 'supplier-1' },
    ), isError('APPLICATION_NOT_FOUND'));

    const contract = {
      id: 'contract-1', applicationId: 'app-1', projectId: 'project-1',
      clientUserId: 'client-1', supplierId: 'supplier-1', status: 'PENDING_CONSENT',
      specVersionNo: 1, agreedAmount: 3_100_000, durationDays: 42,
      clientFee: 155_000, supplierFee: 155_000, interimRatio: 50,
      consentDeadline: new Date('2026-11-10T00:00:00.000Z'), contentHash: 'a'.repeat(64),
      clientSignedAt: null, supplierSignedAt: null, depositDeadline: null,
      paymentStatus: 'PENDING', totalDeposited: 0, items: [],
    } satisfies ContractRecord;
    assert.throws(() => contractDocumentFor(contract, { userId: 'intruder', role: 'CLIENT' }), isError('CONTRACT_NOT_FOUND'));
    const document = contractDocumentFor(contract, { userId: 'client-1', role: 'CLIENT' });
    assert.deepEqual(
      [document.agreedAmount, document.clientFee, document.supplierFee, document.depositAmount, document.supplierPayout],
      [3_100_000, 155_000, 155_000, 3_255_000, 2_945_000],
    );
  });

  it('비교는 최신 견적 이력과 실제 금액만 제공하고 AI 단가·판정은 만들지 않는다', () => {
    const revisions: ApplicationRevision[] = [
      applicationRevision({ id: 'app-1-r1', revisionNo: 1, status: 'SUPERSEDED', submittedAt: new Date('2026-11-01T00:00:00.000Z'), totalAmount: 2_800_000 }),
      applicationRevision({ id: 'app-1-r2', revisionNo: 2, submittedAt: new Date('2026-11-02T00:00:00.000Z'), totalAmount: 3_100_000, questions: [{ text: '질문 1' }, { text: '질문 2' }] }),
    ];
    const cards = compareApplicationCards(revisions);
    assert.equal(cards.length, 1);
    assert.deepEqual(cards[0], {
      applicationId: 'app-1-r2', supplierId: 'supplier-1', revisionNo: 2,
      totalAmount: 3_100_000, durationDays: 42, questionCount: 2,
      revisionCount: 2, submittedAt: new Date('2026-11-02T00:00:00.000Z'),
    });
    for (const key of ['unitPrice', 'aiUnitPrice', 'isLowest', 'recommended', 'rank']) {
      assert.equal(key in (cards[0] ?? {}), false);
    }
    assert.deepEqual(revisions.map(({ id, status, totalAmount }) => [id, status, totalAmount]), [
      ['app-1-r1', 'SUPERSEDED', 2_800_000],
      ['app-1-r2', 'SUBMITTED', 3_100_000],
    ]);
    const oldRevision = revisions[0];
    const latestRevision = revisions[1];
    assert.ok(oldRevision);
    assert.ok(latestRevision);
    assert.throws(() => assertContractableRevision({ revision: oldRevision, latest: latestRevision }), isError('APPLICATION_REVISION_SUPERSEDED'));
  });
});

describe('B-08-T03 transaction rollback·대화 메시지 불변', () => {
  it('합의 트랜잭션 후반 실패는 상태·계약·알림·이벤트와 기존 대화까지 되돌린다', async () => {
    type State = {
      applicationStatus: 'SUBMITTED' | 'ACCEPTED';
      projectStatus: 'RECRUITING' | 'ACCEPTED';
      contracts: ContractRecord[];
      messages: { readonly applicationId: string; readonly body: string }[];
      notifications: string[];
      events: string[];
    };
    class AtomicFakeUnitOfWork implements ContractUnitOfWork {
      state: State = {
        applicationStatus: 'SUBMITTED', projectStatus: 'RECRUITING', contracts: [],
        messages: [{ applicationId: 'app-1', body: chatMessage().body }], notifications: [], events: [],
      };

      async run<Result>(work: (tx: ContractTx) => Promise<Result>): Promise<Result> {
        const draft: State = structuredClone(this.state);
        const tx: ContractTx = {
          findLatestRevision: async () => applicationRecord({ status: draft.applicationStatus }),
          findProject: async () => ({ id: 'prj-1', status: draft.projectStatus, deadline: null }),
          findContract: async () => null,
          listBreakCandidates: async () => [],
          listProjectApplications: async () => [],
          updateApplicationStatus: async (input) => {
            if (draft.applicationStatus !== input.from[0]) return false;
            draft.applicationStatus = input.to === 'ACCEPTED' ? 'ACCEPTED' : 'SUBMITTED';
            return true;
          },
          updateProjectStatus: async (input) => {
            if (draft.projectStatus !== input.from[0]) return false;
            draft.projectStatus = input.to === 'ACCEPTED' ? 'ACCEPTED' : 'RECRUITING';
            return true;
          },
          createContract: async (input) => {
            const contract: ContractRecord = {
              ...input, id: 'contract-1', status: 'PENDING_CONSENT', clientSignedAt: null,
              supplierSignedAt: null, depositDeadline: null, paymentStatus: 'PENDING', totalDeposited: 0,
            };
            draft.contracts.push(contract);
            return contract;
          },
          applySignature: async () => null,
          cancelContract: async () => false,
          appendSystemMessage: async (input) => { draft.messages.push(input); },
          notify: async (input) => { draft.notifications.push(input.type); },
          logEvent: async (input) => {
            draft.events.push(input.type);
            throw new Error('simulated event persistence failure');
          },
        };
        const result = await work(tx);
        this.state = draft;
        return result;
      }
    }

    const uow = new AtomicFakeUnitOfWork();
    const before = structuredClone(uow.state);
    const agreement: AgreementDraft = {
      items: [{
        blockId: 'block-1', specItemId: 'spec-1', title: '예약 달력', stage: 'FINAL',
        conditions: [{ key: 'scope', text: '예약 시간대', state: 'DECIDED', evidenceMessageIds: ['msg-1', 'msg-2'] }],
      }],
      interimRatio: 50, ratioState: 'UNDECIDED', cachedAt: FIXED_NOW, lastMessageAt: FIXED_NOW,
    };
    await assert.rejects(acceptAgreement(uow, {
      actor: { userId: 'client-1', role: 'CLIENT' }, application: applicationRecord(), agreement,
      items: [{ blockId: 'block-1', description: '예약 기능', origin: 'AGREEMENT', sortOrder: 0 }], now: FIXED_NOW,
    }), /simulated event persistence failure/);
    assert.deepEqual(uow.state, before);
    assert.deepEqual(uow.state.messages, [{ applicationId: 'app-1', body: chatMessage().body }]);
  });
});
