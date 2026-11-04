/**
 * B-01: 상세 열람 권한(NDA)과 최초 열람 시각 기록.
 *
 * 상세는 NDA에 동의한 공급자에게만 공개하고, 열람 사실은 EventLog
 * SPEC_DETAIL_VIEWED로 남긴다. 최초 시각은 해당 기록의 최솟값이다.
 */
import type { ProjectStatus } from './public-project.js';

export type DetailActorRole = 'CLIENT' | 'SUPPLIER' | 'ADMIN';

export interface DetailProjectState {
  readonly status: ProjectStatus;
  readonly publishedAt: Date | null;
  readonly deletedAt: Date | null;
}

export type ProjectDetailAccess =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly status: 403 | 404;
      readonly code: 'NDA_REQUIRED' | 'PROJECT_NOT_FOUND';
    };

/**
 * 존재 여부를 먼저 판정해 미발행/삭제/모집 전 프로젝트는 NDA 여부와 무관하게
 * 404로 숨긴다. 그 다음 공급자에게만 NDA를 요구한다.
 */
export function checkProjectDetailAccess(input: {
  readonly role: DetailActorRole;
  readonly ndaAgreedAt: Date | null;
  readonly project: DetailProjectState;
}): ProjectDetailAccess {
  const { project } = input;

  if (
    project.deletedAt !== null ||
    project.publishedAt === null ||
    project.status === 'SCHEDULED'
  ) {
    return { allowed: false, status: 404, code: 'PROJECT_NOT_FOUND' };
  }

  if (input.role === 'SUPPLIER' && input.ndaAgreedAt === null) {
    return { allowed: false, status: 403, code: 'NDA_REQUIRED' };
  }

  return { allowed: true };
}

export interface ProjectViewKey {
  readonly projectId: string;
  readonly supplierId: string;
}

export interface RecordProjectDetailViewInput extends ProjectViewKey {
  readonly viewedAt: Date;
}

export interface RecordProjectDetailViewResult {
  readonly firstViewedAt: Date;
  readonly isFirstView: boolean;
}

/** A의 EventLog Port를 감싸는 B 쪽 어댑터 계약. */
export interface ProjectViewPort {
  findFirstViewedAt(input: ProjectViewKey): Promise<Date | null>;
  recordDetailView(input: RecordProjectDetailViewInput): Promise<void>;
}

/**
 * 열람은 매번 기록하고, 최초 시각은 기존 기록과 이번 열람 중 이른 쪽이다.
 * isFirstView는 기존 기록이 없을 때만 true다.
 */
export async function recordProjectDetailView(
  port: ProjectViewPort,
  input: RecordProjectDetailViewInput,
): Promise<RecordProjectDetailViewResult> {
  const previous = await port.findFirstViewedAt({
    projectId: input.projectId,
    supplierId: input.supplierId,
  });

  await port.recordDetailView(input);

  if (previous === null) {
    return { firstViewedAt: input.viewedAt, isFirstView: true };
  }

  const firstViewedAt =
    previous.getTime() <= input.viewedAt.getTime() ? previous : input.viewedAt;
  return { firstViewedAt, isFirstView: false };
}
