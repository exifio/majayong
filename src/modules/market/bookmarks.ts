/**
 * B-01: 북마크 저장·해제·목록.
 *
 * 마감된 프로젝트도 북마크 목록에는 남지만, 지원 가능 여부는 별도로 계산한다.
 */
import { toPublicProjectSummary, type PublicProjectSummary } from './public-project.js';

export interface BookmarkRecord {
  readonly supplierId: string;
  readonly projectId: string;
  readonly createdAt: Date;
}

export interface BookmarkRepository {
  findByKey(input: {
    readonly supplierId: string;
    readonly projectId: string;
  }): Promise<BookmarkRecord | null>;
  create(input: BookmarkRecord): Promise<BookmarkRecord>;
  delete(input: {
    readonly supplierId: string;
    readonly projectId: string;
  }): Promise<boolean>;
  listBySupplier(supplierId: string): Promise<readonly BookmarkRecord[]>;
}

export interface SaveBookmarkInput {
  readonly supplierId: string;
  readonly projectId: string;
  readonly now: Date;
}

export interface SaveBookmarkResult {
  readonly bookmark: BookmarkRecord;
  readonly created: boolean;
}

export interface RemoveBookmarkResult {
  readonly removed: boolean;
}

export interface BookmarkListItem {
  readonly project: PublicProjectSummary;
  readonly createdAt: Date;
  readonly applicationOpen: boolean;
}

export interface ListBookmarksInput {
  readonly supplierId: string;
  readonly now: Date;
  readonly projectsById: ReadonlyMap<string, PublicProjectSummary>;
}

/** 중복 저장은 최초 북마크를 그대로 돌려주고 새 행을 만들지 않는다. */
export async function saveBookmark(
  repository: BookmarkRepository,
  input: SaveBookmarkInput,
): Promise<SaveBookmarkResult> {
  const existing = await repository.findByKey(input);
  if (existing !== null) return { bookmark: existing, created: false };

  const bookmark = await repository.create({
    supplierId: input.supplierId,
    projectId: input.projectId,
    createdAt: input.now,
  });
  return { bookmark, created: true };
}

export async function removeBookmark(
  repository: BookmarkRepository,
  input: { readonly supplierId: string; readonly projectId: string },
): Promise<RemoveBookmarkResult> {
  return { removed: await repository.delete(input) };
}

/** 최근 저장 순. 프로젝트를 읽을 수 없으면 목록에서 뺀다. */
export async function listBookmarks(
  repository: BookmarkRepository,
  input: ListBookmarksInput,
): Promise<{ readonly items: readonly BookmarkListItem[] }> {
  const records = await repository.listBySupplier(input.supplierId);
  const items: BookmarkListItem[] = [];

  for (const record of records) {
    const project = input.projectsById.get(record.projectId);
    if (project === undefined) continue;

    items.push({
      project: toPublicProjectSummary(project),
      createdAt: record.createdAt,
      applicationOpen: isApplicationOpen(project, input.now),
    });
  }

  items.sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.project.id.localeCompare(b.project.id),
  );
  return { items };
}

export function isApplicationOpen(project: PublicProjectSummary, now: Date): boolean {
  if (project.status !== 'RECRUITING') return false;
  return project.deadline === null || project.deadline.getTime() >= now.getTime();
}
