/**
 * B-02: 지원·견적·수정 회차.
 *
 * - 상세 열람 기록이 있는 공급자만 지원한다.
 * - 가능 항목 1개 이상, 총액·기간·질문(최대 3)·메시지, 연락처는 저장 전에 가린다.
 * - 수정은 같은 트랜잭션에서 이전 회차 SUPERSEDED + 새 SUBMITTED(항목·질문·메시지·
 *   firstViewedAt 복사, revisionReason, SYSTEM 메시지)다.
 * - 한 프로젝트·공급자에게 SUBMITTED/STALE/ACCEPTED는 1건뿐이다(raw 제약 2).
 */
import { maskContacts } from '../chat/masking.js';
import type { ProjectStatus } from '../market/public-project.js';
import { ApplicationError, type ApplicationRecord, type ApplicationStatus } from './dto.js';

export interface ApplicationQuestion {
  readonly text: string;
}

export interface ApplicationItemSnapshot {
  readonly specItemId: string;
  readonly isAvailable: boolean;
}

export interface ApplicationRevision extends ApplicationRecord {
  readonly message: string | null;
  readonly questions: readonly ApplicationQuestion[];
  readonly isMessageMasked: boolean;
  readonly revisionReason: string | null;
  readonly items: readonly ApplicationItemSnapshot[];
}

export interface NewApplicationRevision {
  readonly projectId: string;
  readonly clientUserId: string;
  readonly supplierId: string;
  readonly revisionNo: number;
  readonly specVersionNo: number;
  readonly totalAmount: number;
  readonly durationDays: number;
  readonly message: string | null;
  readonly questions: readonly ApplicationQuestion[];
  readonly isMessageMasked: boolean;
  readonly revisionReason: string | null;
  readonly firstViewedAt: Date;
  readonly submittedAt: Date;
  readonly items: readonly ApplicationItemSnapshot[];
}

/** B가 C/통합에 넘기는 원자적 쓰기 Port. 실제 구현은 PostgreSQL 트랜잭션. */
export interface ApplicationTx {
  findFirstDetailView(input: {
    readonly projectId: string;
    readonly supplierId: string;
  }): Promise<Date | null>;
  findLatestRevision(input: {
    readonly projectId: string;
    readonly supplierId: string;
  }): Promise<ApplicationRevision | null>;
  findById(applicationId: string): Promise<ApplicationRevision | null>;
  listByProject(projectId: string): Promise<readonly ApplicationRevision[]>;
  createRevision(input: NewApplicationRevision): Promise<ApplicationRevision>;
  updateStatus(input: {
    readonly applicationId: string;
    readonly from: readonly ApplicationStatus[];
    readonly to: ApplicationStatus;
  }): Promise<boolean>;
  appendSystemMessage(input: {
    readonly applicationId: string;
    readonly body: string;
  }): Promise<void>;
}

export interface ApplicationUnitOfWork {
  run<T>(work: (tx: ApplicationTx) => Promise<T>): Promise<T>;
}

/** DB unique 위반을 도메인 오류로 바꿀 때 쓴다. */
export class ApplicationUniqueViolation extends Error {
  constructor() {
    super('application unique violation');
    this.name = 'ApplicationUniqueViolation';
  }
}

export interface SubmitApplicationInput {
  readonly projectId: string;
  readonly clientUserId: string;
  readonly supplierId: string;
  readonly projectStatus: ProjectStatus;
  readonly specVersionNo: number;
  readonly specItemIds: readonly string[];
  readonly totalAmount: number;
  readonly durationDays: number;
  readonly message?: string | null;
  readonly questions?: readonly ApplicationQuestion[];
  readonly items: readonly ApplicationItemSnapshot[];
  readonly now: Date;
}

export interface ReviseApplicationInput {
  readonly applicationId: string;
  readonly supplierId: string;
  readonly specVersionNo: number;
  readonly specItemIds: readonly string[];
  readonly totalAmount: number;
  readonly durationDays: number;
  readonly items: readonly ApplicationItemSnapshot[];
  readonly revisionReason: string;
  readonly message?: string | null;
  readonly questions?: readonly ApplicationQuestion[];
  readonly now: Date;
}

export interface ReviseApplicationResult {
  readonly previous: ApplicationRevision;
  readonly current: ApplicationRevision;
}

export interface ApplicationCard {
  readonly applicationId: string;
  readonly supplierId: string;
  readonly revisionNo: number;
  readonly totalAmount: number;
  readonly durationDays: number;
  readonly questionCount: number;
  readonly revisionCount: number;
  readonly submittedAt: Date;
}

export interface SupplierProfileSummary {
  readonly supplierId: string;
  readonly careerYears: number | null;
  readonly ratingAvg: number | null;
  readonly reviewCount: number;
  readonly completedContractCount: number;
  readonly portfolioSummary: string | null;
}

export type SupplierApplicationCard = ApplicationCard & SupplierProfileSummary;

export const ACTIVE_STATUSES: readonly ApplicationStatus[] = [
  'SUBMITTED',
  'STALE',
  'ACCEPTED',
];

const MAX_QUESTIONS = 3;
const REVISABLE_STATUSES: readonly ApplicationStatus[] = ['SUBMITTED', 'STALE'];
const SYSTEM_REVISION_MESSAGE = '채팅에서 견적이 수정되었습니다.';

function invalid(code: string, message: string): ApplicationError {
  return new ApplicationError(400, code, message);
}

function validateAmount(totalAmount: number): void {
  if (!Number.isInteger(totalAmount) || totalAmount <= 0) {
    throw invalid('INVALID_AMOUNT', '견적 총액은 0보다 큰 정수여야 합니다.');
  }
}

function validateDuration(durationDays: number): void {
  if (!Number.isInteger(durationDays) || durationDays <= 0) {
    throw invalid('INVALID_DURATION', '작업 기간은 0보다 큰 정수여야 합니다.');
  }
}

function validateItems(
  items: readonly ApplicationItemSnapshot[],
  specItemIds: readonly string[],
): void {
  if (items.length === 0) throw invalid('ITEMS_REQUIRED', '명세 항목을 하나 이상 골라야 합니다.');

  const known = new Set(specItemIds);
  const seen = new Set<string>();
  let availableCount = 0;

  for (const item of items) {
    if (!known.has(item.specItemId)) {
      throw invalid('INVALID_SPEC_ITEM', '현재 명세에 없는 항목입니다.');
    }
    if (seen.has(item.specItemId)) {
      throw invalid('INVALID_SPEC_ITEM', '같은 명세 항목을 두 번 넣을 수 없습니다.');
    }
    seen.add(item.specItemId);
    if (item.isAvailable) availableCount += 1;
  }

  if (availableCount === 0) {
    throw invalid('NO_AVAILABLE_ITEM', '가능한 항목이 하나 이상 있어야 합니다.');
  }
}

interface PreparedContent {
  readonly message: string | null;
  readonly questions: readonly ApplicationQuestion[];
  readonly isMessageMasked: boolean;
}

/** 메시지·질문은 저장 전에 가린 본문으로 바꾼다. 원문은 보관하지 않는다. */
function prepareContent(
  message: string | null | undefined,
  questions: readonly ApplicationQuestion[],
): PreparedContent {
  if (questions.length > MAX_QUESTIONS) {
    throw invalid('TOO_MANY_QUESTIONS', '의뢰인에게 묻는 질문은 최대 3개입니다.');
  }

  let maskedAny = false;
  let preparedMessage: string | null = null;
  if (message !== null && message !== undefined) {
    const trimmed = message.trim();
    if (trimmed.length > 0) {
      const result = maskContacts(trimmed);
      preparedMessage = result.text;
      maskedAny = result.masked || maskedAny;
    }
  }

  const preparedQuestions: ApplicationQuestion[] = [];
  for (const question of questions) {
    const trimmed = question.text.trim();
    if (trimmed.length === 0) throw invalid('INVALID_QUESTION', '빈 질문은 저장할 수 없습니다.');

    const result = maskContacts(trimmed);
    maskedAny = result.masked || maskedAny;
    preparedQuestions.push({ text: result.text });
  }

  return {
    message: preparedMessage,
    questions: preparedQuestions,
    isMessageMasked: maskedAny,
  };
}

export async function submitApplication(
  uow: ApplicationUnitOfWork,
  input: SubmitApplicationInput,
): Promise<ApplicationRevision> {
  validateAmount(input.totalAmount);
  validateDuration(input.durationDays);
  validateItems(input.items, input.specItemIds);
  const content = prepareContent(input.message, input.questions ?? []);

  return uow.run(async (tx) => {
    if (input.projectStatus !== 'RECRUITING') {
      throw new ApplicationError(
        409,
        'PROJECT_NOT_RECRUITING',
        '모집 중인 프로젝트에만 지원할 수 있습니다.',
      );
    }

    const firstViewedAt = await tx.findFirstDetailView({
      projectId: input.projectId,
      supplierId: input.supplierId,
    });
    if (firstViewedAt === null) {
      throw new ApplicationError(
        403,
        'DETAIL_VIEW_REQUIRED',
        '명세 상세를 먼저 열람해야 지원할 수 있습니다.',
      );
    }

    const latest = await tx.findLatestRevision({
      projectId: input.projectId,
      supplierId: input.supplierId,
    });
    if (latest !== null && ACTIVE_STATUSES.includes(latest.status)) {
      throw new ApplicationError(
        409,
        'APPLICATION_ALREADY_SUBMITTED',
        '이미 진행 중인 지원이 있습니다.',
      );
    }

    try {
      return await tx.createRevision({
        projectId: input.projectId,
        clientUserId: input.clientUserId,
        supplierId: input.supplierId,
        revisionNo: (latest === null ? 0 : latest.revisionNo) + 1,
        specVersionNo: input.specVersionNo,
        totalAmount: input.totalAmount,
        durationDays: input.durationDays,
        message: content.message,
        questions: content.questions,
        isMessageMasked: content.isMessageMasked,
        revisionReason: null,
        firstViewedAt,
        submittedAt: input.now,
        items: [...input.items],
      });
    } catch (error) {
      if (error instanceof ApplicationUniqueViolation) {
        throw new ApplicationError(
          409,
          'APPLICATION_ALREADY_SUBMITTED',
          '이미 진행 중인 지원이 있습니다.',
        );
      }
      throw error;
    }
  });
}

export async function reviseApplication(
  uow: ApplicationUnitOfWork,
  input: ReviseApplicationInput,
): Promise<ReviseApplicationResult> {
  validateAmount(input.totalAmount);
  validateDuration(input.durationDays);
  validateItems(input.items, input.specItemIds);

  const trimmedReason = input.revisionReason.trim();
  if (trimmedReason.length === 0) {
    throw invalid('REVISION_REASON_REQUIRED', '견적 수정 사유를 한 줄 적어야 합니다.');
  }

  return uow.run(async (tx) => {
    const previous = await tx.findById(input.applicationId);
    if (previous === null || previous.supplierId !== input.supplierId) {
      throw new ApplicationError(404, 'APPLICATION_NOT_FOUND', '지원 정보를 찾을 수 없습니다.');
    }
    if (previous.status === 'SUPERSEDED') {
      throw new ApplicationError(
        409,
        'APPLICATION_REVISION_SUPERSEDED',
        '이미 대체된 회차입니다.',
      );
    }
    if (!REVISABLE_STATUSES.includes(previous.status)) {
      throw new ApplicationError(
        409,
        'APPLICATION_NOT_REVISABLE',
        '현재 상태에서는 견적을 수정할 수 없습니다.',
      );
    }

    const content = prepareContent(
      input.message === undefined ? previous.message : input.message,
      input.questions ?? previous.questions,
    );
    const revisionReason = maskContacts(trimmedReason);

    const superseded = await tx.updateStatus({
      applicationId: previous.id,
      from: REVISABLE_STATUSES,
      to: 'SUPERSEDED',
    });
    if (!superseded) {
      throw new ApplicationError(
        409,
        'APPLICATION_STATE_CHANGED',
        '다른 요청으로 지원 상태가 바뀌었습니다.',
      );
    }

    let current: ApplicationRevision;
    try {
      current = await tx.createRevision({
        projectId: previous.projectId,
        clientUserId: previous.clientUserId,
        supplierId: previous.supplierId,
        revisionNo: previous.revisionNo + 1,
        specVersionNo: input.specVersionNo,
        totalAmount: input.totalAmount,
        durationDays: input.durationDays,
        message: content.message,
        questions: content.questions,
        isMessageMasked: content.isMessageMasked,
        revisionReason: revisionReason.text,
        firstViewedAt: previous.firstViewedAt,
        submittedAt: input.now,
        items: [...input.items],
      });
    } catch (error) {
      if (error instanceof ApplicationUniqueViolation) {
        throw new ApplicationError(
          409,
          'APPLICATION_REVISION_SUPERSEDED',
          '이미 대체된 회차입니다.',
        );
      }
      throw error;
    }

    await tx.appendSystemMessage({
      applicationId: current.id,
      body: SYSTEM_REVISION_MESSAGE,
    });

    return { previous: { ...previous, status: 'SUPERSEDED' }, current };
  });
}

export async function markApplicationsStale(
  uow: ApplicationUnitOfWork,
  input: { readonly projectId: string },
): Promise<number> {
  return uow.run(async (tx) => {
    const rows = await tx.listByProject(input.projectId);
    let changed = 0;

    for (const row of rows) {
      if (row.status !== 'SUBMITTED') continue;

      const updated = await tx.updateStatus({
        applicationId: row.id,
        from: ['SUBMITTED'],
        to: 'STALE',
      });
      if (updated) changed += 1;
    }

    return changed;
  });
}

/**
 * C의 예치 완료 트랜잭션에서 호출하는 Port. 계약한 지원을 뺀 SUBMITTED/STALE만
 * AUTO_REJECTED로 바꾼다. 자동 거절은 예치 완료 시점에만 일어난다.
 */
export async function autoRejectCompetingApplications(
  uow: ApplicationUnitOfWork,
  input: { readonly projectId: string; readonly acceptedApplicationId: string },
): Promise<number> {
  return uow.run(async (tx) => {
    const result = await autoRejectCompetingApplicationsInTransaction(tx, input);
    return result.rejectedCount;
  });
}

/** C의 예치 완료 트랜잭션이 제공한 tx에 참여하는 변형. */
export async function autoRejectCompetingApplicationsInTransaction(
  tx: Pick<ApplicationTx, 'listByProject' | 'updateStatus'>,
  input: { readonly projectId: string; readonly acceptedApplicationId: string },
): Promise<{ readonly rejectedCount: number }> {
  const rows = await tx.listByProject(input.projectId);
  let changed = 0;

  for (const row of rows) {
    if (row.id === input.acceptedApplicationId || !REVISABLE_STATUSES.includes(row.status)) continue;
    const updated = await tx.updateStatus({
      applicationId: row.id,
      from: REVISABLE_STATUSES,
      to: 'AUTO_REJECTED',
    });
    if (updated) changed += 1;
  }

  return { rejectedCount: changed };
}

async function closeApplication(
  uow: ApplicationUnitOfWork,
  input: {
    readonly applicationId: string;
    readonly actorId: string;
    readonly owner: 'supplier' | 'client';
  },
  target: 'WITHDRAWN' | 'REJECTED',
): Promise<{ readonly status: ApplicationStatus }> {
  return uow.run(async (tx) => {
    const row = await tx.findById(input.applicationId);
    if (row === null) {
      throw new ApplicationError(404, 'APPLICATION_NOT_FOUND', '지원 정보를 찾을 수 없습니다.');
    }

    const ownerId = input.owner === 'supplier' ? row.supplierId : row.clientUserId;
    if (ownerId !== input.actorId) {
      throw new ApplicationError(404, 'APPLICATION_NOT_FOUND', '지원 정보를 찾을 수 없습니다.');
    }

    if (!REVISABLE_STATUSES.includes(row.status)) {
      throw new ApplicationError(
        409,
        'APPLICATION_STATE_CHANGED',
        '현재 상태에서는 처리할 수 없습니다.',
      );
    }

    const updated = await tx.updateStatus({
      applicationId: row.id,
      from: REVISABLE_STATUSES,
      to: target,
    });
    if (!updated) {
      throw new ApplicationError(
        409,
        'APPLICATION_STATE_CHANGED',
        '다른 요청으로 지원 상태가 바뀌었습니다.',
      );
    }

    return { status: target };
  });
}

export async function withdrawApplication(
  uow: ApplicationUnitOfWork,
  input: { readonly applicationId: string; readonly supplierId: string },
): Promise<{ readonly status: ApplicationStatus }> {
  return closeApplication(
    uow,
    { applicationId: input.applicationId, actorId: input.supplierId, owner: 'supplier' },
    'WITHDRAWN',
  );
}

export async function rejectApplication(
  uow: ApplicationUnitOfWork,
  input: { readonly applicationId: string; readonly clientUserId: string },
): Promise<{ readonly status: ApplicationStatus }> {
  return closeApplication(
    uow,
    { applicationId: input.applicationId, actorId: input.clientUserId, owner: 'client' },
    'REJECTED',
  );
}

/** 합의(F-10) 직전 확인: 최신 회차의 SUBMITTED만 계약할 수 있다. */
export function assertContractableRevision(input: {
  readonly revision: ApplicationRevision;
  readonly latest: ApplicationRevision | null;
}): void {
  if (input.latest === null) {
    throw new ApplicationError(404, 'APPLICATION_NOT_FOUND', '지원 정보를 찾을 수 없습니다.');
  }
  if (
    input.revision.status === 'SUPERSEDED' ||
    input.revision.revisionNo !== input.latest.revisionNo
  ) {
    throw new ApplicationError(
      409,
      'APPLICATION_REVISION_SUPERSEDED',
      '이미 대체된 회차입니다.',
    );
  }
  if (input.latest.status !== 'SUBMITTED') {
    throw new ApplicationError(
      409,
      'APPLICATION_NOT_SUBMITTED',
      '현재 명세 기준 제출 회차가 아닙니다.',
    );
  }
}

/** 공급자별 최신 회차만, 지원 순서대로. 최저가/추천 같은 판정은 만들지 않는다. */
export function compareApplicationCards(
  revisions: readonly ApplicationRevision[],
): readonly ApplicationCard[] {
  const latestBySupplier = new Map<string, ApplicationRevision>();
  const revisionCountBySupplier = new Map<string, number>();

  for (const revision of revisions) {
    const count = revisionCountBySupplier.get(revision.supplierId) ?? 0;
    if (revision.revisionNo > count) {
      revisionCountBySupplier.set(revision.supplierId, revision.revisionNo);
    }

    const current = latestBySupplier.get(revision.supplierId);
    if (current === undefined || revision.revisionNo > current.revisionNo) {
      latestBySupplier.set(revision.supplierId, revision);
    }
  }

  return [...latestBySupplier.values()]
    .sort(
      (a, b) =>
        a.submittedAt.getTime() - b.submittedAt.getTime() ||
        a.supplierId.localeCompare(b.supplierId),
    )
    .map((revision) => ({
      applicationId: revision.id,
      supplierId: revision.supplierId,
      revisionNo: revision.revisionNo,
      totalAmount: revision.totalAmount,
      durationDays: revision.durationDays,
      questionCount: revision.questions.length,
      revisionCount: revisionCountBySupplier.get(revision.supplierId) ?? revision.revisionNo,
      submittedAt: revision.submittedAt,
    }));
}

/** A의 공개 프로필 projection만 결합한다. 제공되지 않은 프로필은 비어 있는 값으로 둔다. */
export function attachSupplierProfileSummaries(
  cards: readonly ApplicationCard[],
  profiles: readonly SupplierProfileSummary[],
): readonly SupplierApplicationCard[] {
  const bySupplier = new Map(profiles.map((profile) => [profile.supplierId, profile]));
  return cards.map((card) => {
    const profile = bySupplier.get(card.supplierId);
    return {
      ...card,
      careerYears: profile === undefined ? null : profile.careerYears,
      ratingAvg: profile === undefined ? null : profile.ratingAvg,
      reviewCount: profile === undefined ? 0 : profile.reviewCount,
      completedContractCount: profile === undefined ? 0 : profile.completedContractCount,
      portfolioSummary: profile === undefined ? null : profile.portfolioSummary,
    };
  });
}

export { ApplicationError };
