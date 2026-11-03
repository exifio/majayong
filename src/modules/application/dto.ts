/**
 * B-00: Application 상태 표와 DTO, 리소스 소유권 검사.
 *
 * "보류"는 저장 상태가 아니다. 프로젝트에 ACCEPTED 지원이 있고 예치가 끝나기 전의
 * SUBMITTED/STALE 지원을 화면에서만 ON_HOLD로 파생한다(ERD 7.2).
 */

export const APPLICATION_STATUSES = [
  'SUBMITTED',
  'STALE',
  'ACCEPTED',
  'REJECTED',
  'AUTO_REJECTED',
  'WITHDRAWN',
  'SUPERSEDED',
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** 저장하지 않는 화면 표시 상태. */
export type ApplicationDisplayStatus = ApplicationStatus | 'ON_HOLD';

/** v0.7 Application 상태 전이. AUTO_REJECTED는 예치 완료 시점에만 발생한다. */
export const APPLICATION_TRANSITIONS = {
  SUBMITTED: ['STALE', 'SUPERSEDED', 'ACCEPTED', 'WITHDRAWN', 'REJECTED', 'AUTO_REJECTED'],
  STALE: ['SUPERSEDED', 'WITHDRAWN', 'REJECTED', 'AUTO_REJECTED'],
  ACCEPTED: ['REJECTED'],
  REJECTED: [],
  AUTO_REJECTED: [],
  WITHDRAWN: [],
  SUPERSEDED: [],
} as const satisfies Record<ApplicationStatus, readonly ApplicationStatus[]>;

export interface ApplicationRecord {
  readonly id: string;
  readonly projectId: string;
  readonly clientUserId: string;
  readonly supplierId: string;
  readonly revisionNo: number;
  readonly specVersionNo: number;
  readonly status: ApplicationStatus;
  readonly totalAmount: number;
  readonly durationDays: number;
  readonly firstViewedAt: Date;
  readonly submittedAt: Date;
}

export interface ApplicationDto {
  readonly id: string;
  readonly projectId: string;
  readonly supplierId: string;
  readonly revisionNo: number;
  readonly specVersionNo: number;
  readonly status: ApplicationStatus;
  readonly displayStatus: ApplicationDisplayStatus;
  readonly totalAmount: number;
  readonly durationDays: number;
  readonly firstViewedAt: Date;
  readonly submittedAt: Date;
}

export interface ApplicationHoldContext {
  readonly hasAcceptedApplication: boolean;
  readonly depositCompleted: boolean;
}

export function applicationDisplayStatus(
  input: {
    readonly status: ApplicationStatus;
    readonly hasAcceptedApplication: boolean;
    readonly depositCompleted: boolean;
  },
): ApplicationDisplayStatus {
  const isWaiting = input.status === 'SUBMITTED' || input.status === 'STALE';
  if (isWaiting && input.hasAcceptedApplication && !input.depositCompleted) {
    return 'ON_HOLD';
  }
  return input.status;
}

export interface Actor {
  readonly userId: string;
  readonly role: 'CLIENT' | 'SUPPLIER' | 'ADMIN';
}

export interface ApplicationParties {
  readonly clientUserId: string;
  readonly supplierUserId: string;
}

export class ApplicationAccessError extends Error {
  readonly status = 404;
  readonly code = 'APPLICATION_NOT_FOUND';

  constructor() {
    super('지원 정보를 찾을 수 없습니다.');
    this.name = 'ApplicationAccessError';
  }
}

/** 비당사자에게는 존재 여부를 숨기기 위해 403 대신 404를 쓴다. */
export function requireApplicationParty(
  actor: Actor,
  parties: ApplicationParties,
): void {
  if (actor.role === 'ADMIN') return;

  const isParty =
    actor.userId === parties.clientUserId || actor.userId === parties.supplierUserId;
  if (!isParty) throw new ApplicationAccessError();
}
