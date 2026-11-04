/**
 * Gate 2: A/C 소유 데이터를 읽어 B 라우터에 주입하는 어댑터.
 *
 * 읽기 전용이며, 소유 서비스의 규칙을 복제하지 않는다. 아직 계약이 없는 Port는
 * 호출 시점에 503 `INTEGRATION_PENDING`으로 실패해 조용히 틀린 값을 만들지 않는다.
 */
import { HttpError } from '../http/envelope.js';
import type { ChatAccountState, ChatEventPort } from '../modules/chat/conversation.js';
import type { DepositAttemptPort } from '../modules/contract/prisma-adapter.js';
import type { ProjectStateReadPort } from '../modules/application/http.js';
import type { ContractItemSource } from '../modules/contract/lifecycle.js';
import type { ReportAccountActionPort } from '../modules/report/prisma-adapter.js';
import type { AgreementMessage, AgreementSpec } from '../modules/agreement/draft.js';
import type { ExternalPorts } from '../server.js';
import type { ProjectStatus } from '../modules/market/public-project.js';

interface ProjectRow {
  readonly id: string;
  readonly draft: { readonly clientId: string };
  readonly status: ProjectStatus;
  readonly currentVersion: number;
}

interface SpecItemRow {
  readonly id: string;
  readonly blockId: string;
  readonly description: string;
  readonly origin: ContractItemSource['origin'];
  readonly sortOrder: number;
}

interface UserStateRow {
  readonly suspendedAt: Date | null;
  readonly withdrawnAt: Date | null;
  readonly chatRestrictedUntil: Date | null;
}

export interface IntegrationDb {
  readonly project: {
    findUnique(input: {
      readonly where: { readonly id: string };
      readonly select: {
        readonly id: true;
        readonly draft: { readonly select: { readonly clientId: true } };
        readonly status: true;
        readonly currentVersion: true;
      };
    }): Promise<ProjectRow | null>;
  };
  readonly specItem: {
    findMany(input: {
      readonly where: Readonly<Record<string, unknown>>;
      readonly select: {
        readonly id: true;
        readonly blockId: true;
        readonly description: true;
        readonly origin: true;
        readonly sortOrder: true;
      };
      readonly orderBy?: readonly Readonly<Record<string, 'asc' | 'desc'>>[];
    }): Promise<readonly SpecItemRow[]>;
  };
  readonly application: {
    findUnique(input: {
      readonly where: { readonly id: string };
      readonly select: { readonly projectId: true; readonly specVersionNo: true };
    }): Promise<{ readonly projectId: string; readonly specVersionNo: number } | null>;
  };
  readonly user: {
    findUnique(input: {
      readonly where: { readonly id: string };
      readonly select: {
        readonly suspendedAt: true;
        readonly withdrawnAt: true;
        readonly chatRestrictedUntil: true;
      };
    }): Promise<UserStateRow | null>;
  };
  readonly escrowDeposit: {
    count(input: {
      readonly where: Readonly<Record<string, unknown>>;
    }): Promise<number>;
  };
  readonly eventLog: {
    findFirst(input: {
      readonly where: Readonly<Record<string, unknown>>;
      readonly select: { readonly id: true };
    }): Promise<{ readonly id: string } | null>;
    create(input: { readonly data: Readonly<Record<string, unknown>> }): Promise<unknown>;
  };
}

const INCLUDED = { status: 'INCLUDED' } as const;
const OPEN_DEPOSIT_STATUSES = ['PENDING', 'HELD', 'COMPLETED'] as const;

function pendingPort(name: string): never {
  throw new HttpError(
    503,
    'INTEGRATION_PENDING',
    `${name} Port가 아직 연결되지 않았습니다.`,
  );
}

/** A의 Project/SpecItem 읽기. 지원 제출에 필요한 현재 버전과 포함 항목 ID를 만든다. */
export function createProjectStatePort(db: IntegrationDb): ProjectStateReadPort {
  return {
    async getForApplication(projectId) {
      const project = await db.project.findUnique({
        where: { id: projectId },
        select: { id: true, draft: { select: { clientId: true } }, status: true, currentVersion: true },
      });
      if (project === null) return null;
      const items = await db.specItem.findMany({
        where: { projectId, versionNo: project.currentVersion, ...INCLUDED },
        select: { id: true, blockId: true, description: true, origin: true, sortOrder: true },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      });
      return {
        clientUserId: project.draft.clientId,
        status: project.status,
        specVersionNo: project.currentVersion,
        specItemIds: items.map((item) => item.id),
      };
    },
  };
}

/** A SpecItem을 계약 항목 사본의 원천으로 읽는다. */
export function createContractItemSourcePort(db: IntegrationDb): {
  listSources(applicationId: string): Promise<readonly ContractItemSource[]>;
} {
  return {
    async listSources(applicationId) {
      const application = await db.application.findUnique({
        where: { id: applicationId },
        select: { projectId: true, specVersionNo: true },
      });
      if (application === null) return [];
      const items = await db.specItem.findMany({
        where: {
          projectId: application.projectId,
          versionNo: application.specVersionNo,
          ...INCLUDED,
        },
        select: { id: true, blockId: true, description: true, origin: true, sortOrder: true },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      });
      return items.map((item) => ({
        blockId: item.blockId,
        description: item.description,
        origin: item.origin,
        sortOrder: item.sortOrder,
      }));
    },
  };
}

/** A User의 제재 상태 읽기. 쓰기는 A 소유라 하지 않는다. */
export function createChatAccountPort(db: IntegrationDb): {
  getAccountState(userId: string): Promise<ChatAccountState>;
} {
  return {
    async getAccountState(userId) {
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { suspendedAt: true, withdrawnAt: true, chatRestrictedUntil: true },
      });
      if (user === null) {
        throw new HttpError(401, 'UNAUTHENTICATED', '계정을 찾을 수 없습니다.');
      }
      return {
        suspendedAt: user.suspendedAt,
        withdrawnAt: user.withdrawnAt,
        chatRestrictedUntil: user.chatRestrictedUntil,
      };
    },
  };
}

/** C 예치 시도 여부 읽기. 결렬 후보 제외에만 쓴다. */
export function createDepositAttemptPort(db: IntegrationDb): DepositAttemptPort {
  return {
    async hasDepositAttempt(contractId) {
      const count = await db.escrowDeposit.count({
        where: { contractId, status: { in: OPEN_DEPOSIT_STATUSES } },
      });
      return count > 0;
    },
  };
}

/**
 * 최초 문의 이벤트. A의 recordEvent Port가 동결되기 전까지 EventLog에 직접 남긴다.
 * ponytail: find-then-create라 동시 호출 원자성은 A Port 연결 후 보장한다.
 */
export function createChatEventPort(db: IntegrationDb): ChatEventPort {
  return {
    async recordInquiryOpenedOnce(input) {
      const existing = await db.eventLog.findFirst({
        where: { type: 'INQUIRY_OPENED', projectId: input.projectId },
        select: { id: true },
      });
      if (existing !== null) return false;
      await db.eventLog.create({
        data: {
          userId: input.clientUserId,
          type: 'INQUIRY_OPENED',
          projectId: input.projectId,
          occurredAt: input.openedAt,
        },
      });
      return true;
    },
  };
}

export interface IntegrationPortOptions {
  /** A가 공개 목록 조회 Port를 제공할 때 연결한다. */
  readonly projects?: ExternalPorts['projects'];
  readonly recommendations?: ExternalPorts['recommendations'];
  readonly reportAccounts?: ReportAccountActionPort;
  readonly agreementPreview?: ExternalPorts['agreementPreview'];
  readonly now: () => Date;
}

export function createIntegrationPorts(
  db: IntegrationDb,
  options: IntegrationPortOptions,
): ExternalPorts {
  return {
    projectState: createProjectStatePort(db),
    projects:
      options.projects ??
      ({
        listPublicProjectsByIds: async () => pendingPort('ProjectPublic'),
      } satisfies ExternalPorts['projects']),
    recommendations:
      options.recommendations ??
      ({
        getSupplier: async () => pendingPort('SupplierRecommendation'),
        listOpenProjects: async () => pendingPort('ProjectPublic'),
        listAppliedProjectIds: async () => pendingPort('Application'),
      } satisfies ExternalPorts['recommendations']),
    chatAccounts: createChatAccountPort(db),
    chatEvents: createChatEventPort(db),
    reportAccounts:
      options.reportAccounts ??
      ({
        applyAccountAction: async () => pendingPort('AccountAction'),
      } satisfies ReportAccountActionPort),
    contractItems: createContractItemSourcePort(db),
    agreementPreview:
      options.agreementPreview ??
      ({
        getSpec: async () => pendingPort('AgreementSpec'),
        getMessages: async () => pendingPort('AgreementMessage'),
      } satisfies { getSpec(id: string): Promise<AgreementSpec | null>; getMessages(id: string): Promise<readonly AgreementMessage[]> }),
    depositAttempts: createDepositAttemptPort(db),
    now: options.now,
  };
}
