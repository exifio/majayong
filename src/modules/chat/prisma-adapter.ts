/**
 * B-03: 채팅 읽기·쓰기 Port의 Prisma 어댑터.
 *
 * 회차가 바뀌어도 `projectId + supplierId`로 한 대화를 이어 본다.
 * `Application.clientUserId`는 `Project.clientId`에서 온다.
 */
import type {
  ChatApplication,
  ChatMessage,
  ChatRepository,
  ChatRoomListPort,
  ChatRoomRecord,
  NewChatMessage,
} from './conversation.js';
import type { ApplicationStatus } from '../application/dto.js';
import type { ContractDbStatus } from '../contract/display-status.js';

export interface ChatMessageRow {
  readonly id: string;
  readonly applicationId: string;
  readonly senderId: string | null;
  readonly kind: 'TEXT' | 'SYSTEM';
  readonly body: string;
  readonly isMasked: boolean;
  readonly readAt: Date | null;
  readonly createdAt: Date;
}

export interface ChatApplicationRow {
  readonly id: string;
  readonly projectId: string;
  readonly supplierId: string;
  readonly status: ApplicationStatus;
  readonly project: { readonly draft: { readonly clientId: string } };
  readonly contract: { readonly status: ContractDbStatus } | null;
  readonly messages?: readonly ChatMessageRow[];
}

const APPLICATION_SELECT = {
  id: true,
  projectId: true,
  supplierId: true,
  status: true,
  project: { select: { draft: { select: { clientId: true } } } },
  contract: { select: { status: true } },
} as const;

export interface ChatDbClient {
  readonly application: {
    findUnique(input: {
      readonly where: { readonly id: string };
      readonly select: typeof APPLICATION_SELECT;
    }): Promise<ChatApplicationRow | null>;
    findMany(input: {
      readonly where: Readonly<Record<string, unknown>>;
      readonly select?: typeof APPLICATION_SELECT;
      readonly include?: {
        readonly messages: true;
        readonly project: { readonly select: { readonly draft: { readonly select: { readonly clientId: true } } } };
        readonly contract: { readonly select: { readonly status: true } };
      };
      readonly orderBy?: readonly Readonly<Record<string, 'asc' | 'desc'>>[];
    }): Promise<readonly ChatApplicationRow[]>;
  };
  readonly applicationMessage: {
    findMany(input: {
      readonly where: Readonly<Record<string, unknown>>;
      readonly orderBy: readonly Readonly<Record<string, 'asc' | 'desc'>>[];
    }): Promise<readonly ChatMessageRow[]>;
    findFirst(input: {
      readonly where: Readonly<Record<string, unknown>>;
      readonly select: { readonly id: true };
    }): Promise<{ readonly id: string } | null>;
    create(input: { readonly data: Readonly<Record<string, unknown>> }): Promise<ChatMessageRow>;
    updateMany(input: {
      readonly where: Readonly<Record<string, unknown>>;
      readonly data: Readonly<Record<string, unknown>>;
    }): Promise<{ readonly count: number }>;
  };
}

export function toChatApplication(row: ChatApplicationRow): ChatApplication {
  return {
    id: row.id,
    projectId: row.projectId,
    clientUserId: row.project.draft.clientId,
    supplierId: row.supplierId,
    status: row.status,
    contractStatus: row.contract?.status ?? null,
  };
}

export function toChatMessage(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    applicationId: row.applicationId,
    senderId: row.senderId,
    kind: row.kind,
    body: row.body,
    isMasked: row.isMasked,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}

export function createPrismaChatRepository(db: ChatDbClient): ChatRepository {
  return {
    async findApplication(applicationId) {
      const row = await db.application.findUnique({
        where: { id: applicationId },
        select: APPLICATION_SELECT,
      });
      return row === null ? null : toChatApplication(row);
    },

    async findThreadMessages(input) {
      const rows = await db.applicationMessage.findMany({
        where: {
          application: { is: { projectId: input.projectId, supplierId: input.supplierId } },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      return rows.map(toChatMessage);
    },

    async hasMessageFrom(input) {
      const row = await db.applicationMessage.findFirst({
        where: {
          senderId: input.senderId,
          application: { is: { projectId: input.projectId, supplierId: input.supplierId } },
        },
        select: { id: true },
      });
      return row !== null;
    },

    async createMessage(input: NewChatMessage) {
      const row = await db.applicationMessage.create({
        data: {
          applicationId: input.applicationId,
          senderId: input.senderId,
          kind: input.kind,
          body: input.body,
          isMasked: input.isMasked,
          createdAt: input.createdAt,
        },
      });
      return toChatMessage(row);
    },

    async markRead(input) {
      if (input.messageIds.length === 0) return 0;
      const result = await db.applicationMessage.updateMany({
        where: {
          id: { in: input.messageIds },
          senderId: { not: input.readerId },
          readAt: null,
        },
        data: { readAt: input.now },
      });
      return result.count;
    },
  };
}

export function createPrismaChatRoomListPort(db: ChatDbClient): ChatRoomListPort {
  return {
    async listRoomsForUser(userId) {
      const rows = await db.application.findMany({
        where: {
          OR: [{ supplierId: userId }, { project: { is: { draft: { is: { clientId: userId } } } } }],
          messages: { some: {} },
        },
        include: {
          messages: true,
          project: { select: { draft: { select: { clientId: true } } } },
          contract: { select: { status: true } },
        },
        orderBy: [{ submittedAt: 'desc' }, { id: 'asc' }],
      });
      return rows.map(
        (row): ChatRoomRecord => ({
          ...toChatApplication(row),
          messages: (row.messages ?? []).map(toChatMessage),
        }),
      );
    },
  };
}
