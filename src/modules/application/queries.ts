/**
 * B-08: 읽기 전용 내 지원 목록·상세 조회 서비스.
 *
 * HTTP/DTO는 Gate 0 동결 전이므로 저장 record/revision을 그대로 노출한다.
 * 표시 상태(ON_HOLD)는 예치 상태가 C에 있어 목록 서비스에서 파생하지 않는다.
 */
import {
  ApplicationAccessError,
  requireApplicationParty,
  type Actor,
  type ApplicationRecord,
} from './dto.js';
import type { ApplicationRevision } from './submission.js';

export interface ApplicationReadPort {
  listForUser(input: {
    readonly userId: string;
    readonly role: 'CLIENT' | 'SUPPLIER';
  }): Promise<readonly ApplicationRecord[]>;
  findRevision(applicationId: string): Promise<ApplicationRevision | null>;
}

function isMine(application: ApplicationRecord, actor: Actor): boolean {
  return actor.role === 'CLIENT'
    ? application.clientUserId === actor.userId
    : application.supplierId === actor.userId;
}

/** `GET /me/applications`: 내가 의뢰한/지원한 지원을 최신 제출 순으로. */
export async function listMyApplications(
  port: ApplicationReadPort,
  input: { readonly actor: Actor },
): Promise<readonly ApplicationRecord[]> {
  if (input.actor.role === 'ADMIN') return [];

  const rows = await port.listForUser({
    userId: input.actor.userId,
    role: input.actor.role,
  });
  return rows
    .filter((application) => isMine(application, input.actor))
    .sort(
      (a, b) =>
        b.submittedAt.getTime() - a.submittedAt.getTime() || a.id.localeCompare(b.id),
    );
}

/** `GET /applications/{id}`: 당사자만 최신 회차 전체를 본다. */
export async function getApplicationDetail(
  port: ApplicationReadPort,
  input: { readonly actor: Actor; readonly applicationId: string },
): Promise<ApplicationRevision> {
  const revision = await port.findRevision(input.applicationId);
  if (revision === null) throw new ApplicationAccessError();
  requireApplicationParty(input.actor, {
    clientUserId: revision.clientUserId,
    supplierUserId: revision.supplierId,
  });
  return revision;
}
