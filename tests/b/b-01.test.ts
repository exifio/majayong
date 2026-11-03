import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isApplicationOpen,
  listBookmarks,
  removeBookmark,
  saveBookmark,
  type BookmarkRecord,
  type BookmarkRepository,
} from '../../src/modules/market/bookmarks.ts';
import {
  checkProjectDetailAccess,
  recordProjectDetailView,
  type ProjectViewPort,
} from '../../src/modules/market/project-detail.ts';
import {
  PROJECT_PAGE_SIZE,
  recommendProjectsForSupplier,
  searchPublicProjects,
} from '../../src/modules/market/project-search.ts';
import {
  PublicProjectContractError,
  type PublicProjectSummary,
} from '../../src/modules/market/public-project.ts';
import { FIXED_NOW, baseProject } from './fixtures.ts';

function makeProject(
  index: number,
  overrides: Partial<PublicProjectSummary> = {},
): PublicProjectSummary {
  return baseProject({
    id: `prj-${index}`,
    title: `프로젝트 ${index}`,
    publishedAt: new Date(Date.UTC(2026, 9, 1, 0, index)),
    deadline: new Date(Date.UTC(2026, 10, 10 + index)),
    hopeBudgetRange: { minKrw: index * 100_000, maxKrw: index * 200_000 },
    ...overrides,
  });
}

function projectIds(projects: readonly PublicProjectSummary[]): string[] {
  return projects.map((project) => project.id);
}

describe('B-01-T01 공개 프로젝트 탐색', () => {
  it('페이지당 10건, 12건이면 10/2로 나뉜다', () => {
    const projects = Array.from({ length: 12 }, (_, index) => makeProject(index + 1));

    const first = searchPublicProjects(projects, { page: 1 });
    const second = searchPublicProjects(projects, { page: 2 });

    assert.equal(PROJECT_PAGE_SIZE, 10);
    assert.equal(first.items.length, 10);
    assert.equal(second.items.length, 2);
    assert.deepEqual(second.meta, { page: 2, pageSize: 10, total: 12, totalPages: 2 });
  });

  it('최신순은 발행일 내림차순, 동률이면 id 오름차순이다', () => {
    const tied = new Date('2026-10-01T00:00:00.000Z');
    const projects = [
      makeProject(1, { id: 'b', publishedAt: tied }),
      makeProject(2, { id: 'a', publishedAt: tied }),
      makeProject(3, { publishedAt: new Date('2026-10-02T00:00:00.000Z') }),
    ];

    assert.deepEqual(projectIds(searchPublicProjects(projects, { sort: 'LATEST' }).items), [
      'prj-3',
      'a',
      'b',
    ]);
  });

  it('마감임박순은 마감일 오름차순, 마감일 없음은 뒤로 보낸다', () => {
    const projects = [
      makeProject(1, { id: 'late', deadline: new Date('2026-12-31T00:00:00.000Z') }),
      makeProject(2, { id: 'none', deadline: null }),
      makeProject(3, { id: 'soon', deadline: new Date('2026-11-05T00:00:00.000Z') }),
    ];

    assert.deepEqual(
      projectIds(searchPublicProjects(projects, { sort: 'DEADLINE_SOON' }).items),
      ['soon', 'late', 'none'],
    );
  });

  it('예산 높은순은 희망 예산 상한 내림차순, 예산 없음은 뒤로 보낸다', () => {
    const projects = [
      makeProject(1, { id: 'mid', hopeBudgetRange: { minKrw: 1, maxKrw: 3_000_000 } }),
      makeProject(2, { id: 'none', hopeBudgetRange: null }),
      makeProject(3, { id: 'high', hopeBudgetRange: { minKrw: 1, maxKrw: 9_000_000 } }),
    ];

    assert.deepEqual(projectIds(searchPublicProjects(projects, { sort: 'BUDGET_HIGH' }).items), [
      'high',
      'mid',
      'none',
    ]);
  });

  it('필터 5종(업종·예산·기술·마감일·모집 상태)을 함께 적용한다', () => {
    const inRange = { minKrw: 2_000_000, maxKrw: 5_000_000 };
    const projects = [
      makeProject(1, { industryCode: 'FOOD', requiredSkills: ['React'], hopeBudgetRange: inRange }),
      makeProject(2, { industryCode: 'CAFE', requiredSkills: ['React'], hopeBudgetRange: inRange }),
      makeProject(3, { industryCode: 'FOOD', requiredSkills: ['Vue'], hopeBudgetRange: inRange }),
      makeProject(4, {
        industryCode: 'FOOD',
        requiredSkills: ['React'],
        hopeBudgetRange: inRange,
        status: 'EXPIRED',
      }),
      makeProject(5, {
        industryCode: 'FOOD',
        requiredSkills: ['React'],
        hopeBudgetRange: inRange,
        deadline: new Date('2027-01-01T00:00:00.000Z'),
      }),
    ];

    const result = searchPublicProjects(projects, {
      filters: {
        industryCode: 'FOOD',
        minBudgetKrw: 1_500_000,
        maxBudgetKrw: 6_000_000,
        requiredSkills: ['react'],
        deadlineBefore: new Date('2026-12-01T00:00:00.000Z'),
        recruitmentStatus: 'OPEN',
      },
    });

    assert.deepEqual(projectIds(result.items), ['prj-1']);
    assert.equal(result.meta.total, 1);
  });

  it('모집 상태 CLOSED는 RECRUITING이 아닌 프로젝트만 남긴다', () => {
    const projects = [
      makeProject(1),
      makeProject(2, { status: 'EXPIRED' }),
      makeProject(3, { status: 'CONTRACTED' }),
      makeProject(4, { status: 'SCHEDULED' }),
    ];

    assert.deepEqual(
      projectIds(searchPublicProjects(projects, { filters: { recruitmentStatus: 'CLOSED' } }).items),
      ['prj-4', 'prj-3', 'prj-2'],
    );
    assert.equal(
      searchPublicProjects(projects, { filters: { recruitmentStatus: 'ALL' } }).meta.total,
      4,
    );
  });

  it('키워드는 제목과 명세 항목 이름에서 대소문자 없이 찾는다', () => {
    const projects = [
      makeProject(1, { title: '예약 달력 개선', specItemTitles: ['예약금 결제'] }),
      makeProject(2, { title: '주문 관리', specItemTitles: ['리마인드 알림'] }),
      makeProject(3, { title: '재고 알림', specItemTitles: ['입고 등록'] }),
    ];

    assert.deepEqual(
      projectIds(searchPublicProjects(projects, { filters: { keyword: '리마인드' } }).items),
      ['prj-2'],
    );
    assert.deepEqual(
      projectIds(searchPublicProjects(projects, { filters: { keyword: '  알림 ' } }).items),
      ['prj-3', 'prj-2'],
    );
  });

  it('결과 없음과 범위 밖 페이지는 빈 목록과 0 페이지로 응답한다', () => {
    const none = searchPublicProjects([makeProject(1)], {
      filters: { keyword: '없는기능' },
    });
    assert.deepEqual(none.items, []);
    assert.deepEqual(none.meta, { page: 1, pageSize: 10, total: 0, totalPages: 0 });

    const beyond = searchPublicProjects([makeProject(1)], { page: 9 });
    assert.deepEqual(beyond.items, []);
    assert.equal(beyond.meta.page, 9);
  });
});

describe('B-01-T02 상세 열람 기록', () => {
  function memoryViewPort(initial: Date | null = null): {
    port: ProjectViewPort;
    views: { projectId: string; supplierId: string; viewedAt: Date }[];
  } {
    const views: { projectId: string; supplierId: string; viewedAt: Date }[] = [];
    let first = initial;

    return {
      views,
      port: {
        findFirstViewedAt: async () => first,
        recordDetailView: async (input) => {
          views.push(input);
          if (first === null) first = input.viewedAt;
        },
      },
    };
  }

  const key = { projectId: 'prj-1', supplierId: 'supplier-1' };

  it('첫 열람은 기록하고 isFirstView=true로 최초 시각을 돌려준다', async () => {
    const { port, views } = memoryViewPort();
    const viewedAt = new Date('2026-11-03T01:00:00.000Z');

    const result = await recordProjectDetailView(port, { ...key, viewedAt });

    assert.deepEqual(result, { firstViewedAt: viewedAt, isFirstView: true });
    assert.equal(views.length, 1);
    assert.equal(views[0]?.projectId, 'prj-1');
  });

  it('재열람도 매번 기록하지만 최초 시각과 isFirstView=false를 유지한다', async () => {
    const firstViewedAt = new Date('2026-11-01T00:00:00.000Z');
    const { port, views } = memoryViewPort(firstViewedAt);
    const viewedAt = new Date('2026-11-03T01:00:00.000Z');

    const result = await recordProjectDetailView(port, { ...key, viewedAt });

    assert.deepEqual(result, { firstViewedAt, isFirstView: false });
    assert.equal(views.length, 1);
  });
});

describe('B-01-T03 상세 열람 권한', () => {
  const published = {
    status: 'RECRUITING',
    publishedAt: new Date('2026-10-27T00:00:00.000Z'),
    deletedAt: null,
  } as const;

  it('NDA 미동의 공급자는 403 NDA_REQUIRED다', () => {
    assert.deepEqual(
      checkProjectDetailAccess({ role: 'SUPPLIER', ndaAgreedAt: null, project: published }),
      { allowed: false, status: 403, code: 'NDA_REQUIRED' },
    );
  });

  it('NDA 동의 공급자와 의뢰인·관리자는 열람할 수 있다', () => {
    assert.deepEqual(
      checkProjectDetailAccess({
        role: 'SUPPLIER',
        ndaAgreedAt: new Date('2026-08-01T00:00:00.000Z'),
        project: published,
      }),
      { allowed: true },
    );
    assert.deepEqual(
      checkProjectDetailAccess({ role: 'CLIENT', ndaAgreedAt: null, project: published }),
      { allowed: true },
    );
    assert.deepEqual(
      checkProjectDetailAccess({ role: 'ADMIN', ndaAgreedAt: null, project: published }),
      { allowed: true },
    );
  });

  it('미발행·삭제·모집 전 프로젝트는 NDA보다 404를 먼저 돌려준다', () => {
    const notFound = { allowed: false, status: 404, code: 'PROJECT_NOT_FOUND' };

    assert.deepEqual(
      checkProjectDetailAccess({
        role: 'SUPPLIER',
        ndaAgreedAt: null,
        project: { ...published, publishedAt: null },
      }),
      notFound,
    );
    assert.deepEqual(
      checkProjectDetailAccess({
        role: 'SUPPLIER',
        ndaAgreedAt: null,
        project: { ...published, deletedAt: new Date('2026-10-30T00:00:00.000Z') },
      }),
      notFound,
    );
    assert.deepEqual(
      checkProjectDetailAccess({
        role: 'SUPPLIER',
        ndaAgreedAt: null,
        project: { ...published, status: 'SCHEDULED' },
      }),
      notFound,
    );
  });
});

describe('B-01-T04 북마크', () => {
  function memoryBookmarks(initial: readonly BookmarkRecord[] = []): BookmarkRepository {
    const rows = new Map<string, BookmarkRecord>();
    const keyOf = (supplierId: string, projectId: string): string => `${supplierId}:${projectId}`;
    for (const record of initial) rows.set(keyOf(record.supplierId, record.projectId), record);

    return {
      findByKey: async ({ supplierId, projectId }) =>
        rows.get(keyOf(supplierId, projectId)) ?? null,
      create: async (record) => {
        rows.set(keyOf(record.supplierId, record.projectId), record);
        return record;
      },
      delete: async ({ supplierId, projectId }) => rows.delete(keyOf(supplierId, projectId)),
      listBySupplier: async (supplierId) =>
        [...rows.values()].filter((record) => record.supplierId === supplierId),
    };
  }

  const input = { supplierId: 'supplier-1', projectId: 'prj-1' };

  it('같은 프로젝트 중복 저장은 최초 북마크를 그대로 돌려준다', async () => {
    const repository = memoryBookmarks();
    const first = await saveBookmark(repository, { ...input, now: FIXED_NOW });
    const again = await saveBookmark(repository, {
      ...input,
      now: new Date('2026-11-04T00:00:00.000Z'),
    });

    assert.equal(first.created, true);
    assert.equal(again.created, false);
    assert.equal(again.bookmark.createdAt.toISOString(), FIXED_NOW.toISOString());
  });

  it('해제는 두 번 호출해도 안전하다', async () => {
    const repository = memoryBookmarks();
    await saveBookmark(repository, { ...input, now: FIXED_NOW });

    assert.deepEqual(await removeBookmark(repository, input), { removed: true });
    assert.deepEqual(await removeBookmark(repository, input), { removed: false });
  });

  it('마감된 프로젝트도 목록에 남고 applicationOpen=false로 표시한다', async () => {
    const repository = memoryBookmarks([
      { ...input, createdAt: new Date('2026-11-01T00:00:00.000Z') },
      { supplierId: 'supplier-1', projectId: 'prj-2', createdAt: new Date('2026-11-02T00:00:00.000Z') },
    ]);
    const open = baseProject({ id: 'prj-1' });
    const closed = baseProject({ id: 'prj-2', status: 'EXPIRED' });
    const projectsById = new Map([
      [open.id, open],
      [closed.id, closed],
    ]);

    const result = await listBookmarks(repository, {
      supplierId: 'supplier-1',
      now: FIXED_NOW,
      projectsById,
    });

    assert.deepEqual(
      result.items.map((item) => [item.project.id, item.applicationOpen]),
      [
        ['prj-2', false],
        ['prj-1', true],
      ],
    );
  });

  it('지원 가능 여부는 모집 중이면서 마감일이 지나지 않았을 때만 true다', () => {
    assert.equal(isApplicationOpen(baseProject(), FIXED_NOW), true);
    assert.equal(
      isApplicationOpen(
        baseProject({ deadline: new Date('2026-11-01T00:00:00.000Z') }),
        FIXED_NOW,
      ),
      false,
    );
    assert.equal(isApplicationOpen(baseProject({ status: 'SELECTING' }), FIXED_NOW), false);
  });
});

describe('B-01-T05 공급자 홈 추천', () => {
  const supplier = {
    supplierId: 'supplier-1',
    industryCodes: ['FOOD'],
    skills: ['React', 'Node.js', 'Supabase'],
  };

  it('같은 업종만, 이미 지원한 프로젝트와 모집 중이 아닌 글은 제외한다', () => {
    const projects = [
      makeProject(1, { industryCode: 'FOOD', requiredSkills: ['React'] }),
      makeProject(2, { industryCode: 'CAFE', requiredSkills: ['React', 'Node.js'] }),
      makeProject(3, { industryCode: 'FOOD', requiredSkills: ['React', 'Node.js'] }),
      makeProject(4, { industryCode: 'FOOD', requiredSkills: ['React'], status: 'EXPIRED' }),
    ];

    const recommended = recommendProjectsForSupplier({
      supplier,
      projects,
      appliedProjectIds: ['prj-1'],
    });

    assert.deepEqual(projectIds(recommended.map((item) => item.project)), ['prj-3']);
    assert.deepEqual(recommended[0]?.matchedSkills, ['React', 'Node.js']);
  });

  it('기술 겹침 내림차순, 동률이면 마감이 가까운 순, 그다음 id 순이다', () => {
    const projects = [
      makeProject(1, {
        requiredSkills: ['React'],
        deadline: new Date('2026-11-05T00:00:00.000Z'),
      }),
      makeProject(2, {
        requiredSkills: ['React', 'Node.js'],
        deadline: new Date('2027-01-01T00:00:00.000Z'),
      }),
      makeProject(3, {
        requiredSkills: [],
        deadline: new Date('2026-11-01T00:00:00.000Z'),
      }),
      makeProject(4, {
        requiredSkills: ['React', 'Node.js'],
        deadline: new Date('2026-12-01T00:00:00.000Z'),
      }),
    ];

    const recommended = recommendProjectsForSupplier({
      supplier,
      projects,
      appliedProjectIds: [],
    });

    assert.deepEqual(projectIds(recommended.map((item) => item.project)), [
      'prj-4',
      'prj-2',
      'prj-1',
      'prj-3',
    ]);
  });

  it('limit으로 홈 노출 개수를 제한한다', () => {
    const projects = Array.from({ length: 5 }, (_, index) => makeProject(index + 1));

    assert.equal(
      recommendProjectsForSupplier({ supplier, projects, appliedProjectIds: [], limit: 2 }).length,
      2,
    );
  });
});

describe('B-01-T06 가격·원문 비공개', () => {
  it('탐색·추천 결과는 공개 카드 필드만 남긴다', () => {
    const projects = [makeProject(1)];
    const item = searchPublicProjects(projects, {}).items[0];
    const recommended = recommendProjectsForSupplier({
      supplier: { supplierId: 's', industryCodes: ['FOOD'], skills: ['React'] },
      projects,
      appliedProjectIds: [],
    })[0]?.project;

    for (const project of [item, recommended]) {
      assert.ok(project);
      assert.equal('exactHopeBudgetKrw' in project, false);
      assert.equal('unitPrice' in project, false);
      assert.equal('aiUnitPrice' in project, false);
      assert.equal('clientUtterance' in project, false);
      assert.equal(project.hopeBudgetRange !== null, true);
    }
  });

  it('민감 필드가 섞인 후보는 502 SENSITIVE_FIELD로 거부한다', () => {
    const leaky = {
      ...makeProject(1),
      aiUnitPrice: 900_000,
      clientUtterance: '원문',
    };

    assert.throws(
      () => searchPublicProjects([leaky], {}),
      (error: unknown) =>
        error instanceof PublicProjectContractError && error.reason === 'SENSITIVE_FIELD',
    );
  });
});
