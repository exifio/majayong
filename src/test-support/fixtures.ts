import type { ApplicationRecord } from '../modules/application/dto.ts';
import type { ApplicationRevision } from '../modules/application/submission.ts';
import type {
  ChatApplication,
  ChatMessage,
} from '../modules/chat/conversation.ts';
import type { ContractStatusInput } from '../modules/contract/display-status.ts';
import type {
  PublicProjectDetail,
  PublicProjectSummary,
} from '../modules/market/public-project.ts';

/** 테스트에서 고정하는 기준 시각(UTC). 기한 계산은 시계 fixture를 통해서만 움직인다. */
export const FIXED_NOW = new Date('2026-11-03T00:00:00.000Z');

export interface TestClock {
  now(): Date;
  set(iso: string): void;
  advanceDays(days: number): void;
}

export function createTestClock(initialIso: string = FIXED_NOW.toISOString()): TestClock {
  let current = new Date(initialIso);
  return {
    now: () => new Date(current.getTime()),
    set: (iso: string) => {
      current = new Date(iso);
    },
    advanceDays: (days: number) => {
      current = new Date(current.getTime() + days * 24 * 60 * 60 * 1000);
    },
  };
}

/** PRD 9.6 시연 데이터와 같은 프로젝트 공개 projection. */
export function baseProject(
  overrides: Partial<PublicProjectSummary> = {},
): PublicProjectSummary {
  return {
    id: 'prj-1',
    title: '예약 달력 외 2개 기능',
    summary: '예약 기반 음식점 예약 시스템',
    industryCode: 'FOOD',
    requiredSkills: ['React', 'Node.js'],
    hopeBudgetRange: { minKrw: 3_000_000, maxKrw: 5_000_000 },
    deadline: new Date('2026-11-10T14:59:59.000Z'),
    status: 'RECRUITING',
    publishedAt: new Date('2026-10-27T00:00:00.000Z'),
    currentSpecVersion: 1,
    specItemCount: 4,
    specItemTitles: ['예약 달력', '예약금 결제', '노쇼 기록', '리마인드 알림'],
    ...overrides,
  };
}

/** 상세 공개 + SpecItem versionNo fixture. */
export function projectDetail(
  overrides: Partial<PublicProjectDetail> = {},
): PublicProjectDetail {
  return {
    ...baseProject(),
    exactHopeBudgetKrw: 5_000_000,
    specItems: [
      { id: 'spec-1', versionNo: 1, title: '예약 달력' },
      { id: 'spec-2', versionNo: 1, title: '예약금 결제' },
      { id: 'spec-3', versionNo: 1, title: '노쇼 기록' },
      { id: 'spec-4', versionNo: 1, title: '리마인드 알림' },
    ],
    ...overrides,
  };
}

export function applicationRecord(
  overrides: Partial<ApplicationRecord> = {},
): ApplicationRecord {
  return {
    id: 'app-1',
    projectId: 'prj-1',
    clientUserId: 'client-1',
    supplierId: 'supplier-1',
    revisionNo: 1,
    specVersionNo: 1,
    status: 'SUBMITTED',
    totalAmount: 3_100_000,
    durationDays: 42,
    firstViewedAt: new Date('2026-10-28T01:00:00.000Z'),
    submittedAt: new Date('2026-10-29T01:00:00.000Z'),
    ...overrides,
  };
}

export function applicationRevision(
  overrides: Partial<ApplicationRevision> = {},
): ApplicationRevision {
  return {
    ...applicationRecord(),
    message: '예약 달력과 결제까지 가능합니다.',
    questions: [],
    isMessageMasked: false,
    revisionReason: null,
    items: [
      { specItemId: 'spec-1', isAvailable: true },
      { specItemId: 'spec-2', isAvailable: false },
    ],
    ...overrides,
  };
}

export function chatApplication(
  overrides: Partial<ChatApplication> = {},
): ChatApplication {
  return {
    id: 'app-1',
    projectId: 'prj-1',
    clientUserId: 'client-1',
    supplierId: 'supplier-1',
    status: 'SUBMITTED',
    contractStatus: null,
    ...overrides,
  };
}

export function chatMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    applicationId: 'app-1',
    senderId: 'client-1',
    kind: 'TEXT',
    body: '안녕하세요. 일정 확인 부탁드립니다.',
    isMasked: false,
    readAt: null,
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
    ...overrides,
  };
}

/** 임시 계약/서명 테스트용 계약 상태 입력. */
export function contractStatusInput(
  overrides: Partial<ContractStatusInput> = {},
): ContractStatusInput {
  return {
    status: 'PENDING_CONSENT',
    paymentStatus: 'PENDING',
    clientSignedAt: null,
    supplierSignedAt: null,
    workDueAt: null,
    finalDelivered: false,
    now: FIXED_NOW,
    ...overrides,
  };
}
