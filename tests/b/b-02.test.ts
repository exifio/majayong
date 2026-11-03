import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ApplicationStatus } from '../../src/modules/application/dto.ts';
import {
  ApplicationError,
  ApplicationUniqueViolation,
  type ApplicationRevision,
  type ApplicationTx,
  type ApplicationUnitOfWork,
  type NewApplicationRevision,
  type ReviseApplicationInput,
  type SubmitApplicationInput,
  assertContractableRevision,
  autoRejectCompetingApplications,
  autoRejectCompetingApplicationsInTransaction,
  compareApplicationCards,
  markApplicationsStale,
  rejectApplication,
  reviseApplication,
  submitApplication,
  withdrawApplication,
} from '../../src/modules/application/submission.ts';
import { CONTACT_PLACEHOLDER, maskContacts } from '../../src/modules/chat/masking.ts';
import { FIXED_NOW, applicationRevision } from './fixtures.ts';

const SPEC_ITEM_IDS = ['spec-1', 'spec-2', 'spec-3', 'spec-4'];

function isAppError(status: number, code: string) {
  return (error: unknown): boolean =>
    error instanceof ApplicationError && error.status === status && error.code === code;
}

class FakeApplicationTx implements ApplicationTx {
  rows: ApplicationRevision[];
  systemMessages: { applicationId: string; body: string }[] = [];
  viewedAt: Date | null;
  private forceUnique = false;

  constructor(
    rows: readonly ApplicationRevision[] = [],
    options: { readonly viewedAt?: Date | null } = {},
  ) {
    this.rows = [...rows];
    this.viewedAt = options.viewedAt === undefined ? null : options.viewedAt;
  }

  failNextCreateWithUnique(): void {
    this.forceUnique = true;
  }

  async findFirstDetailView(): Promise<Date | null> {
    return this.viewedAt;
  }

  async findLatestRevision(input: {
    readonly projectId: string;
    readonly supplierId: string;
  }): Promise<ApplicationRevision | null> {
    const matching = this.rows.filter(
      (row) => row.projectId === input.projectId && row.supplierId === input.supplierId,
    );
    let latest: ApplicationRevision | null = null;
    for (const row of matching) {
      if (latest === null || row.revisionNo > latest.revisionNo) latest = row;
    }
    return latest;
  }

  async findById(applicationId: string): Promise<ApplicationRevision | null> {
    return this.rows.find((row) => row.id === applicationId) ?? null;
  }

  async listByProject(projectId: string): Promise<readonly ApplicationRevision[]> {
    return this.rows.filter((row) => row.projectId === projectId);
  }

  async createRevision(input: NewApplicationRevision): Promise<ApplicationRevision> {
    if (this.forceUnique) {
      this.forceUnique = false;
      throw new ApplicationUniqueViolation();
    }

    const duplicateRevision = this.rows.some(
      (row) =>
        row.projectId === input.projectId &&
        row.supplierId === input.supplierId &&
        row.revisionNo === input.revisionNo,
    );
    const activeDuplicate = this.rows.some(
      (row) =>
        row.projectId === input.projectId &&
        row.supplierId === input.supplierId &&
        (row.status === 'SUBMITTED' || row.status === 'STALE' || row.status === 'ACCEPTED'),
    );
    if (duplicateRevision || activeDuplicate) throw new ApplicationUniqueViolation();

    const created: ApplicationRevision = {
      ...input,
      id: `app-${this.rows.length + 1}`,
      status: 'SUBMITTED',
    };
    this.rows.push(created);
    return created;
  }

  async updateStatus(input: {
    readonly applicationId: string;
    readonly from: readonly ApplicationStatus[];
    readonly to: ApplicationStatus;
  }): Promise<boolean> {
    const index = this.rows.findIndex(
      (row) => row.id === input.applicationId && input.from.includes(row.status),
    );
    const current = this.rows[index];
    if (index < 0 || current === undefined) return false;

    this.rows[index] = { ...current, status: input.to };
    return true;
  }

  async appendSystemMessage(input: {
    readonly applicationId: string;
    readonly body: string;
  }): Promise<void> {
    this.systemMessages.push({ applicationId: input.applicationId, body: input.body });
  }
}

class FakeUnitOfWork implements ApplicationUnitOfWork {
  readonly tx: FakeApplicationTx;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(tx: FakeApplicationTx) {
    this.tx = tx;
  }

  run<T>(work: (tx: ApplicationTx) => Promise<T>): Promise<T> {
    const next = this.tail.then(() => work(this.tx));
    this.tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

function submitInput(
  overrides: Partial<SubmitApplicationInput> = {},
): SubmitApplicationInput {
  return {
    projectId: 'prj-1',
    clientUserId: 'client-1',
    supplierId: 'supplier-1',
    projectStatus: 'RECRUITING',
    specVersionNo: 1,
    specItemIds: SPEC_ITEM_IDS,
    totalAmount: 3_100_000,
    durationDays: 42,
    message: '잘 부탁드립니다.',
    questions: [],
    items: [
      { specItemId: 'spec-1', isAvailable: true },
      { specItemId: 'spec-2', isAvailable: false },
    ],
    now: FIXED_NOW,
    ...overrides,
  };
}

function reviseInput(overrides: Partial<ReviseApplicationInput> = {}): ReviseApplicationInput {
  return {
    applicationId: 'app-1',
    supplierId: 'supplier-1',
    specVersionNo: 2,
    specItemIds: SPEC_ITEM_IDS,
    totalAmount: 3_300_000,
    durationDays: 40,
    items: [{ specItemId: 'spec-1', isAvailable: true }],
    revisionReason: '명세가 바뀌어 일정을 조정합니다.',
    now: new Date('2026-11-05T00:00:00.000Z'),
    ...overrides,
  };
}

describe('B-02-T01 상세 미열람 지원 거부', () => {
  it('상세 열람 기록이 없으면 403 DETAIL_VIEW_REQUIRED다', async () => {
    const tx = new FakeApplicationTx([], { viewedAt: null });

    await assert.rejects(
      submitApplication(new FakeUnitOfWork(tx), submitInput()),
      isAppError(403, 'DETAIL_VIEW_REQUIRED'),
    );
    assert.equal(tx.rows.length, 0);
  });

  it('모집 중이 아니면 409 PROJECT_NOT_RECRUITING이다', async () => {
    const tx = new FakeApplicationTx([], { viewedAt: FIXED_NOW });

    await assert.rejects(
      submitApplication(new FakeUnitOfWork(tx), submitInput({ projectStatus: 'EXPIRED' })),
      isAppError(409, 'PROJECT_NOT_RECRUITING'),
    );
  });

  it('가능 항목이 하나도 없거나 명세에 없는 항목이면 거부한다', async () => {
    const tx = new FakeApplicationTx([], { viewedAt: FIXED_NOW });
    const uow = new FakeUnitOfWork(tx);

    await assert.rejects(
      submitApplication(
        uow,
        submitInput({ items: [{ specItemId: 'spec-1', isAvailable: false }] }),
      ),
      isAppError(400, 'NO_AVAILABLE_ITEM'),
    );
    await assert.rejects(
      submitApplication(
        uow,
        submitInput({ items: [{ specItemId: 'spec-9', isAvailable: true }] }),
      ),
      isAppError(400, 'INVALID_SPEC_ITEM'),
    );
  });

  it('유효한 지원은 1회차 SUBMITTED로 저장하고 최초 열람 시각을 남긴다', async () => {
    const viewedAt = new Date('2026-10-28T01:00:00.000Z');
    const tx = new FakeApplicationTx([], { viewedAt });
    const uow = new FakeUnitOfWork(tx);

    const created = await submitApplication(uow, submitInput());

    assert.equal(created.revisionNo, 1);
    assert.equal(created.status, 'SUBMITTED');
    assert.equal(created.firstViewedAt.toISOString(), viewedAt.toISOString());
    assert.equal(created.totalAmount, 3_100_000);
    assert.deepEqual(created.items, [
      { specItemId: 'spec-1', isAvailable: true },
      { specItemId: 'spec-2', isAvailable: false },
    ]);
  });
});

describe('B-02-T02 중복·동시 제출', () => {
  it('이미 진행 중인 지원이 있으면 409 APPLICATION_ALREADY_SUBMITTED다', async () => {
    const tx = new FakeApplicationTx([], { viewedAt: FIXED_NOW });
    const uow = new FakeUnitOfWork(tx);

    await submitApplication(uow, submitInput());

    await assert.rejects(
      submitApplication(uow, submitInput()),
      isAppError(409, 'APPLICATION_ALREADY_SUBMITTED'),
    );
    assert.equal(tx.rows.length, 1);
  });

  it('동시 제출은 한 건만 성공하고 나머지는 409다', async () => {
    const tx = new FakeApplicationTx([], { viewedAt: FIXED_NOW });
    const uow = new FakeUnitOfWork(tx);

    const results = await Promise.allSettled([
      submitApplication(uow, submitInput()),
      submitApplication(uow, submitInput()),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(tx.rows.length, 1);

    const failure = rejected[0];
    assert.equal(failure?.status, 'rejected');
    if (failure?.status === 'rejected') {
      assert.equal(failure.reason instanceof ApplicationError, true);
      assert.equal(failure.reason.code, 'APPLICATION_ALREADY_SUBMITTED');
    }
  });

  it('DB unique 위반은 409 APPLICATION_ALREADY_SUBMITTED로 바꾼다', async () => {
    const tx = new FakeApplicationTx([], { viewedAt: FIXED_NOW });
    const uow = new FakeUnitOfWork(tx);
    tx.failNextCreateWithUnique();

    await assert.rejects(
      submitApplication(uow, submitInput()),
      isAppError(409, 'APPLICATION_ALREADY_SUBMITTED'),
    );
  });
});

describe('B-02-T03 질문 3개 제한·연락처 원문 저장 금지', () => {
  it('질문은 최대 3개이며 4개는 400 TOO_MANY_QUESTIONS다', async () => {
    const tx = new FakeApplicationTx([], { viewedAt: FIXED_NOW });

    await assert.rejects(
      submitApplication(
        new FakeUnitOfWork(tx),
        submitInput({
          questions: [{ text: 'q1' }, { text: 'q2' }, { text: 'q3' }, { text: 'q4' }],
        }),
      ),
      isAppError(400, 'TOO_MANY_QUESTIONS'),
    );
    assert.equal(tx.rows.length, 0);
  });

  it('메시지·질문의 전화·이메일·메신저 ID는 저장 전에 가린다', async () => {
    const tx = new FakeApplicationTx([], { viewedAt: FIXED_NOW });
    const message = '카톡 chef123, 010-1234-5678, owner@example.com 으로 연락 주세요.';
    const questionText = '텔레그램 @chef_kim 으로 답 주시면 02-123-4567도 됩니다.';

    const created = await submitApplication(
      new FakeUnitOfWork(tx),
      submitInput({ message, questions: [{ text: questionText }] }),
    );

    assert.equal(created.message?.includes(CONTACT_PLACEHOLDER), true);
    assert.equal(created.questions[0]?.text.includes(CONTACT_PLACEHOLDER), true);
    assert.equal(created.isMessageMasked, true);

    const stored = JSON.stringify(tx.rows);
    for (const original of [
      'chef123',
      '010-1234-5678',
      'owner@example.com',
      '@chef_kim',
      '02-123-4567',
    ]) {
      assert.equal(stored.includes(original), false);
    }
  });

  it('연락처가 없는 본문은 그대로 저장하고 isMessageMasked=false다', async () => {
    const tx = new FakeApplicationTx([], { viewedAt: FIXED_NOW });

    const created = await submitApplication(
      new FakeUnitOfWork(tx),
      submitInput({ message: '일정과 범위 확인했습니다.', questions: [{ text: '예약금은 어떻게 처리하나요?' }] }),
    );

    assert.equal(created.message, '일정과 범위 확인했습니다.');
    assert.equal(created.isMessageMasked, false);
  });

  it('가림기는 여러 연락처를 한 번에 바꾸고 이미 가린 본문은 그대로 둔다', () => {
    const masked = maskContacts('010-1111-2222 / a@b.co.kr / 카톡: chef1');
    assert.equal(masked.masked, true);
    assert.equal(masked.text.includes('chef1'), false);
    assert.equal(masked.text.includes('010-1111-2222'), false);

    const again = maskContacts(masked.text);
    assert.equal(again.text, masked.text);
    assert.equal(again.masked, false);
  });
});

describe('B-02-T04 명세 변경 → STALE', () => {
  it('해당 프로젝트의 SUBMITTED만 STALE로 바꾸고 나머지는 유지한다', async () => {
    const tx = new FakeApplicationTx([
      applicationRevision({ id: 'app-1', supplierId: 'supplier-1', status: 'SUBMITTED' }),
      applicationRevision({ id: 'app-2', supplierId: 'supplier-2', status: 'STALE' }),
      applicationRevision({ id: 'app-3', supplierId: 'supplier-3', status: 'ACCEPTED' }),
      applicationRevision({
        id: 'app-4',
        projectId: 'prj-2',
        supplierId: 'supplier-4',
        status: 'SUBMITTED',
      }),
    ]);

    const count = await markApplicationsStale(new FakeUnitOfWork(tx), { projectId: 'prj-1' });

    assert.equal(count, 1);
    assert.deepEqual(
      tx.rows.map((row) => [row.id, row.status]),
      [
        ['app-1', 'STALE'],
        ['app-2', 'STALE'],
        ['app-3', 'ACCEPTED'],
        ['app-4', 'SUBMITTED'],
      ],
    );
  });
});

describe('B-02-T05 견적 수정 회차', () => {
  it('이전 회차는 SUPERSEDED, 새 회차는 항목·질문·메시지·최초 열람 시각을 복사한다', async () => {
    const previous = applicationRevision({
      questions: [{ text: '예약금은 어떻게 처리하나요?' }],
    });
    const tx = new FakeApplicationTx([previous], { viewedAt: previous.firstViewedAt });
    const uow = new FakeUnitOfWork(tx);

    const result = await reviseApplication(uow, reviseInput());

    assert.equal(result.previous.status, 'SUPERSEDED');
    assert.equal(result.current.revisionNo, 2);
    assert.equal(result.current.status, 'SUBMITTED');
    assert.equal(result.current.specVersionNo, 2);
    assert.equal(result.current.totalAmount, 3_300_000);
    assert.equal(result.current.durationDays, 40);
    assert.equal(
      result.current.firstViewedAt.toISOString(),
      previous.firstViewedAt.toISOString(),
    );
    assert.equal(result.current.message, previous.message);
    assert.deepEqual(result.current.questions, previous.questions);
    assert.equal(result.current.revisionReason, '명세가 바뀌어 일정을 조정합니다.');
    assert.equal(tx.rows.length, 2);
    assert.equal(tx.rows[0]?.status, 'SUPERSEDED');
    assert.equal(tx.systemMessages.length, 1);
    assert.equal(tx.systemMessages[0]?.applicationId, result.current.id);
  });

  it('STALE 회차도 재견적할 수 있고 이전 회차는 남는다', async () => {
    const tx = new FakeApplicationTx([applicationRevision({ status: 'STALE' })], {
      viewedAt: FIXED_NOW,
    });

    const result = await reviseApplication(new FakeUnitOfWork(tx), reviseInput());

    assert.equal(result.previous.status, 'SUPERSEDED');
    assert.equal(result.current.status, 'SUBMITTED');
  });

  it('임시 계약(ACCEPTED) 이후에는 견적을 수정할 수 없다', async () => {
    const tx = new FakeApplicationTx([applicationRevision({ status: 'ACCEPTED' })], {
      viewedAt: FIXED_NOW,
    });

    await assert.rejects(
      reviseApplication(new FakeUnitOfWork(tx), reviseInput()),
      isAppError(409, 'APPLICATION_NOT_REVISABLE'),
    );
  });

  it('다른 공급자의 회차는 404로 존재를 숨긴다', async () => {
    const tx = new FakeApplicationTx([applicationRevision()], { viewedAt: FIXED_NOW });

    await assert.rejects(
      reviseApplication(
        new FakeUnitOfWork(tx),
        reviseInput({ supplierId: 'supplier-2' }),
      ),
      isAppError(404, 'APPLICATION_NOT_FOUND'),
    );
  });

  it('수정 메시지의 연락처도 가린다', async () => {
    const tx = new FakeApplicationTx([applicationRevision()], { viewedAt: FIXED_NOW });

    const result = await reviseApplication(
      new FakeUnitOfWork(tx),
      reviseInput({ message: '카톡 chef999로 연락 주세요.' }),
    );

    assert.equal(result.current.message?.includes('chef999'), false);
    assert.equal(result.current.isMessageMasked, true);
  });
});

describe('B-02-T06 구 회차 계약 시도 거부', () => {
  const oldRevision = applicationRevision({ id: 'app-1', revisionNo: 1, status: 'SUPERSEDED' });
  const latestRevision = applicationRevision({ id: 'app-2', revisionNo: 2, status: 'SUBMITTED' });

  it('최신 회차가 아니면 409 APPLICATION_REVISION_SUPERSEDED다', () => {
    assert.throws(
      () => assertContractableRevision({ revision: oldRevision, latest: latestRevision }),
      isAppError(409, 'APPLICATION_REVISION_SUPERSEDED'),
    );
  });

  it('최신 회차가 SUBMITTED가 아니면 409 APPLICATION_NOT_SUBMITTED다', () => {
    assert.throws(
      () =>
        assertContractableRevision({
          revision: latestRevision,
          latest: { ...latestRevision, status: 'STALE' },
        }),
      isAppError(409, 'APPLICATION_NOT_SUBMITTED'),
    );
  });

  it('최신 SUBMITTED 회차는 통과한다', () => {
    assert.doesNotThrow(() =>
      assertContractableRevision({ revision: latestRevision, latest: latestRevision }),
    );
  });
});

describe('B-02-T07 철회·직접 거절', () => {
  it('공급자는 SUBMITTED·STALE(보류) 지원을 철회할 수 있다', async () => {
    const tx = new FakeApplicationTx([
      applicationRevision({ id: 'app-1', status: 'SUBMITTED' }),
      applicationRevision({ id: 'app-2', supplierId: 'supplier-2', status: 'STALE' }),
    ]);
    const uow = new FakeUnitOfWork(tx);

    assert.deepEqual(
      await withdrawApplication(uow, { applicationId: 'app-1', supplierId: 'supplier-1' }),
      { status: 'WITHDRAWN' },
    );
    assert.deepEqual(
      await withdrawApplication(uow, { applicationId: 'app-2', supplierId: 'supplier-2' }),
      { status: 'WITHDRAWN' },
    );
    assert.deepEqual(
      tx.rows.map((row) => row.status),
      ['WITHDRAWN', 'WITHDRAWN'],
    );
  });

  it('ACCEPTED 지원은 철회할 수 없고 다른 공급자는 404다', async () => {
    const tx = new FakeApplicationTx([applicationRevision({ status: 'ACCEPTED' })]);
    const uow = new FakeUnitOfWork(tx);

    await assert.rejects(
      withdrawApplication(uow, { applicationId: 'app-1', supplierId: 'supplier-1' }),
      isAppError(409, 'APPLICATION_STATE_CHANGED'),
    );
    await assert.rejects(
      withdrawApplication(uow, { applicationId: 'app-1', supplierId: 'supplier-2' }),
      isAppError(404, 'APPLICATION_NOT_FOUND'),
    );
  });

  it('의뢰인은 진행 중 지원을 직접 거절할 수 있다', async () => {
    const tx = new FakeApplicationTx([applicationRevision()]);
    const uow = new FakeUnitOfWork(tx);

    assert.deepEqual(
      await rejectApplication(uow, { applicationId: 'app-1', clientUserId: 'client-1' }),
      { status: 'REJECTED' },
    );
    assert.equal(tx.rows[0]?.status, 'REJECTED');
  });
});

describe('B-02 보조: 예치 완료 자동 거절 Port', () => {
  it('계약한 지원을 뺀 SUBMITTED·STALE만 AUTO_REJECTED로 바꾼다', async () => {
    const tx = new FakeApplicationTx([
      applicationRevision({ id: 'app-1', supplierId: 'supplier-1', status: 'ACCEPTED' }),
      applicationRevision({ id: 'app-2', supplierId: 'supplier-2', status: 'SUBMITTED' }),
      applicationRevision({ id: 'app-3', supplierId: 'supplier-3', status: 'STALE' }),
      applicationRevision({ id: 'app-4', supplierId: 'supplier-4', status: 'REJECTED' }),
    ]);

    const count = await autoRejectCompetingApplications(new FakeUnitOfWork(tx), {
      projectId: 'prj-1',
      acceptedApplicationId: 'app-1',
    });

    assert.equal(count, 2);
    assert.deepEqual(
      tx.rows.map((row) => [row.id, row.status]),
      [
        ['app-1', 'ACCEPTED'],
        ['app-2', 'AUTO_REJECTED'],
        ['app-3', 'AUTO_REJECTED'],
        ['app-4', 'REJECTED'],
      ],
    );
  });

  it('제공된 transaction-scoped port로 다른 지원만 자동 거절한다', async () => {
    const tx = new FakeApplicationTx([
      applicationRevision({ id: 'app-1', status: 'ACCEPTED' }),
      applicationRevision({ id: 'app-2', supplierId: 'supplier-2', status: 'SUBMITTED' }),
      applicationRevision({ id: 'app-3', supplierId: 'supplier-3', status: 'STALE' }),
    ]);
    const result = await autoRejectCompetingApplicationsInTransaction(tx, {
      projectId: 'prj-1',
      acceptedApplicationId: 'app-1',
    });

    assert.deepEqual(result, { rejectedCount: 2 });
    assert.deepEqual(tx.rows.map((row) => row.status), ['ACCEPTED', 'AUTO_REJECTED', 'AUTO_REJECTED']);
  });
});

describe('B-02 보조: 지원 비교 카드', () => {
  it('공급자별 최신 회차만 지원 순서대로 보여 주고 판정 필드를 만들지 않는다', () => {
    const cards = compareApplicationCards([
      applicationRevision({
        id: 'app-1',
        supplierId: 'supplier-1',
        revisionNo: 1,
        submittedAt: new Date('2026-10-29T00:00:00.000Z'),
        totalAmount: 2_000_000,
      }),
      applicationRevision({
        id: 'app-2',
        supplierId: 'supplier-1',
        revisionNo: 2,
        submittedAt: new Date('2026-10-30T00:00:00.000Z'),
        totalAmount: 2_500_000,
        questions: [{ text: 'q1' }, { text: 'q2' }],
      }),
      applicationRevision({
        id: 'app-3',
        supplierId: 'supplier-2',
        submittedAt: new Date('2026-10-28T00:00:00.000Z'),
        totalAmount: 3_000_000,
      }),
    ]);

    assert.deepEqual(
      cards.map((card) => [card.supplierId, card.revisionNo, card.revisionCount]),
      [
        ['supplier-2', 1, 1],
        ['supplier-1', 2, 2],
      ],
    );
    assert.equal(cards[1]?.totalAmount, 2_500_000);
    assert.equal(cards[1]?.questionCount, 2);

    for (const card of cards) {
      assert.equal('isLowest' in card, false);
      assert.equal('recommended' in card, false);
      assert.equal('rank' in card, false);
    }
  });
});
