/**
 * B-01: A의 공개 프로젝트 HTTP가 호출하는 검색/추천 Port.
 *
 * HTTP 소유권은 A에 있다(API_INDEX #045~046). B는 필터 5종·정렬 3종·
 * 페이지당 10건·제목/기능 검색과 공급자 홈 추천만 제공한다.
 */
import {
  PublicProjectContractError,
  toPublicProjectSummary,
  type PublicProjectSummary,
} from './public-project.js';

export const PROJECT_PAGE_SIZE = 10;

export type ProjectSort = 'LATEST' | 'DEADLINE_SOON' | 'BUDGET_HIGH';
export type RecruitmentStatusFilter = 'OPEN' | 'CLOSED' | 'ALL';

export interface ProjectSearchFilters {
  readonly keyword?: string;
  readonly industryCode?: string;
  readonly minBudgetKrw?: number;
  readonly maxBudgetKrw?: number;
  readonly requiredSkills?: readonly string[];
  readonly deadlineBefore?: Date;
  readonly recruitmentStatus?: RecruitmentStatusFilter;
}

export interface ProjectSearchInput {
  readonly filters?: ProjectSearchFilters;
  readonly sort?: ProjectSort;
  readonly page?: number;
}

export interface ProjectSearchMeta {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
}

export interface ProjectSearchPage {
  readonly items: readonly PublicProjectSummary[];
  readonly meta: ProjectSearchMeta;
}

/** A가 구현/호출하는 계약. B 구현은 DB 후보 목록을 받아 순수하게 필터링한다. */
export interface ProjectSearchPort {
  searchPublicProjects(input: ProjectSearchInput): Promise<ProjectSearchPage>;
}

/** A가 제공하는 공개 후보 목록. 신뢰 경계 밖 응답이므로 unknown으로 받는다. */
export interface ProjectCandidatePort {
  listPublicProjectCandidates(): Promise<unknown>;
}

export function createProjectSearchPort(candidates: ProjectCandidatePort): ProjectSearchPort {
  return {
    async searchPublicProjects(input) {
      const response = await candidates.listPublicProjectCandidates();
      if (!Array.isArray(response)) {
        throw new PublicProjectContractError('$candidates', 'INVALID_VALUE');
      }

      // ponytail: 후보 전체를 읽어 메모리에서 필터·페이지 처리. 데이터가 커지면 repository로 내린다.
      return searchPublicProjects(response.map(toPublicProjectSummary), input);
    },
  };
}

export interface SupplierRecommendationProfile {
  readonly supplierId: string;
  readonly industryCodes: readonly string[];
  readonly skills: readonly string[];
}

export interface RecommendedProject {
  readonly project: PublicProjectSummary;
  readonly matchedSkills: readonly string[];
}

export interface SupplierRecommendationInput {
  readonly supplier: SupplierRecommendationProfile;
  readonly projects: readonly PublicProjectSummary[];
  readonly appliedProjectIds: readonly string[];
  readonly limit?: number;
}

export interface SupplierRecommendationPort {
  recommendForSupplier(
    input: SupplierRecommendationInput,
  ): Promise<readonly RecommendedProject[]>;
}

function isOpen(project: PublicProjectSummary): boolean {
  return project.status === 'RECRUITING';
}

function matchesFilters(
  project: PublicProjectSummary,
  filters: ProjectSearchFilters,
  keyword: string,
  skills: readonly string[],
): boolean {
  if (filters.industryCode !== undefined && project.industryCode !== filters.industryCode) {
    return false;
  }

  if (filters.minBudgetKrw !== undefined || filters.maxBudgetKrw !== undefined) {
    const range = project.hopeBudgetRange;
    if (range === null) return false;
    if (filters.minBudgetKrw !== undefined && range.maxKrw < filters.minBudgetKrw) return false;
    // 상한은 미포함([min, max)) — "200만원 미만"에 정확히 200만원은 들지 않는다.
    if (filters.maxBudgetKrw !== undefined && range.minKrw >= filters.maxBudgetKrw) return false;
  }

  if (skills.length > 0) {
    const own = project.requiredSkills.map((skill) => skill.toLowerCase());
    const hasSkill = skills.some((skill) => own.includes(skill.toLowerCase()));
    if (!hasSkill) return false;
  }

  if (
    filters.deadlineBefore !== undefined &&
    (project.deadline === null ||
      project.deadline.getTime() > filters.deadlineBefore.getTime())
  ) {
    return false;
  }

  const recruitmentStatus = filters.recruitmentStatus ?? 'ALL';
  if (recruitmentStatus === 'OPEN' && !isOpen(project)) return false;
  if (recruitmentStatus === 'CLOSED' && isOpen(project)) return false;

  if (keyword.length > 0) {
    const haystack = [project.title, ...project.specItemTitles].map((text) => text.toLowerCase());
    if (!haystack.some((text) => text.includes(keyword))) return false;
  }

  return true;
}

function timeValue(value: Date | null): number | null {
  return value === null ? null : value.getTime();
}

function compareNullableAsc(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

function compareNullableDesc(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right - left;
}

function compareId(left: PublicProjectSummary, right: PublicProjectSummary): number {
  return left.id.localeCompare(right.id);
}

function comparator(sort: ProjectSort): (a: PublicProjectSummary, b: PublicProjectSummary) => number {
  switch (sort) {
    case 'DEADLINE_SOON':
      return (a, b) => compareNullableAsc(timeValue(a.deadline), timeValue(b.deadline)) || compareId(a, b);
    case 'BUDGET_HIGH':
      return (a, b) =>
        compareNullableDesc(
          a.hopeBudgetRange === null ? null : a.hopeBudgetRange.maxKrw,
          b.hopeBudgetRange === null ? null : b.hopeBudgetRange.maxKrw,
        ) || compareId(a, b);
    case 'LATEST':
      return (a, b) =>
        compareNullableDesc(timeValue(a.publishedAt), timeValue(b.publishedAt)) || compareId(a, b);
  }
}

/**
 * 정렬·필터·페이지를 적용한다. 응답은 공개 카드 projection으로 다시 좁혀
 * 가격·원문 필드가 섞여 들어와도 밖으로 나가지 않게 한다.
 */
export function searchPublicProjects(
  projects: readonly PublicProjectSummary[],
  input: ProjectSearchInput = {},
): ProjectSearchPage {
  const filters = input.filters ?? {};
  const keyword = (filters.keyword ?? '').trim().toLowerCase();
  const skills = filters.requiredSkills ?? [];

  const filtered = projects.filter((project) =>
    matchesFilters(project, filters, keyword, skills),
  );
  const sorted = [...filtered].sort(comparator(input.sort ?? 'LATEST'));

  const page = Math.max(1, Math.trunc(input.page ?? 1));
  const start = (page - 1) * PROJECT_PAGE_SIZE;
  const items = sorted
    .slice(start, start + PROJECT_PAGE_SIZE)
    .map((project) => toPublicProjectSummary(project));

  return {
    items,
    meta: {
      page,
      pageSize: PROJECT_PAGE_SIZE,
      total: sorted.length,
      totalPages: Math.ceil(sorted.length / PROJECT_PAGE_SIZE),
    },
  };
}

function matchedSkills(
  project: PublicProjectSummary,
  supplierSkills: readonly string[],
): readonly string[] {
  const wanted = supplierSkills.map((skill) => skill.toLowerCase());
  return project.requiredSkills.filter((skill) => wanted.includes(skill.toLowerCase()));
}

/**
 * 공급자 홈 추천(F-17): 같은 업종 → 기술 겹침 많은 순 → 마감 가까운 순 → id.
 * 이미 지원한 프로젝트와 모집 중이 아닌 프로젝트는 제외한다.
 */
export function recommendProjectsForSupplier(
  input: SupplierRecommendationInput,
): readonly RecommendedProject[] {
  const industries = new Set(input.supplier.industryCodes);
  const applied = new Set(input.appliedProjectIds);

  const candidates = input.projects
    .filter(
      (project) =>
        industries.has(project.industryCode) && !applied.has(project.id) && isOpen(project),
    )
    .map((project) => ({ project, matchedSkills: matchedSkills(project, input.supplier.skills) }));

  candidates.sort(
    (a, b) =>
      b.matchedSkills.length - a.matchedSkills.length ||
      compareNullableAsc(timeValue(a.project.deadline), timeValue(b.project.deadline)) ||
      compareId(a.project, b.project),
  );

  const ordered =
    input.limit === undefined
      ? candidates
      : candidates.slice(0, Math.max(0, Math.trunc(input.limit)));

  return ordered.map((candidate) => ({
    project: toPublicProjectSummary(candidate.project),
    matchedSkills: candidate.matchedSkills,
  }));
}
