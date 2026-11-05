/**
 * B-03: 문의 채팅·읽음·연락처 마스킹.
 *
 * - 의뢰인만 방을 열고, 공급자는 그 지원 줄기에 의뢰인 메시지가 1건 이상 있어야 보낸다.
 * - 회차가 바뀌어도 projectId+supplierId 기준 하나의 대화로 읽는다.
 * - 계약 체결(ACTIVE) 전에는 양쪽 메시지의 연락처를 저장 전에 가린다.
 * - 거절·철회·자동 거절·정지·채팅 제한은 쓰기만 막고 읽기는 허용한다.
 */
import type { ApplicationStatus } from '../application/dto.js';
import type { ContractDbStatus } from '../contract/display-status.js';
import { maskContacts } from './masking.js';

export type MessageKind = 'TEXT' | 'SYSTEM';

export class ChatError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ChatError';
    this.status = status;
    this.code = code;
  }
}

export type ChatRole = 'CLIENT' | 'SUPPLIER' | 'ADMIN';

export interface ChatActor {
  readonly userId: string;
  readonly role: ChatRole;
}

export interface ChatAccountState {
  readonly suspendedAt: Date | null;
  readonly withdrawnAt: Date | null;
  readonly chatRestrictedUntil: Date | null;
}

export interface ChatApplication {
  readonly id: string;
  readonly projectId: string;
  readonly clientUserId: string;
  readonly supplierId: string;
  readonly status: ApplicationStatus;
  readonly contractStatus: ContractDbStatus | null;
}

export interface ChatMessage {
  readonly id: string;
  readonly applicationId: string;
  readonly senderId: string | null;
  readonly kind: MessageKind;
  readonly body: string;
  readonly isMasked: boolean;
  readonly readAt: Date | null;
  readonly createdAt: Date;
}

export interface NewChatMessage {
  readonly applicationId: string;
  readonly senderId: string | null;
  readonly kind: MessageKind;
  readonly body: string;
  readonly isMasked: boolean;
  readonly createdAt: Date;
}

export interface ChatRepository {
  findApplication(applicationId: string): Promise<ChatApplication | null>;
  findThreadMessages(input: {
    readonly projectId: string;
    readonly supplierId: string;
  }): Promise<readonly ChatMessage[]>;
  hasMessageFrom(input: {
    readonly projectId: string;
    readonly supplierId: string;
    readonly senderId: string;
  }): Promise<boolean>;
  createMessage(input: NewChatMessage): Promise<ChatMessage>;
  markRead(input: {
    readonly messageIds: readonly string[];
    readonly readerId: string;
    readonly now: Date;
  }): Promise<number>;
}

export interface ChatEventPort {
  recordInquiryOpenedOnce(input: {
    readonly projectId: string;
    readonly clientUserId: string;
    readonly openedAt: Date;
  }): Promise<boolean>;
}

/** B-06 알림 모듈에 방 단위 새 메시지 알림을 요청하는 선택 포트. */
export interface ChatNotificationPort {
  notifyNewMessage(input: {
    readonly projectId: string;
    readonly supplierId: string;
    readonly clientUserId: string;
    readonly supplierUserId: string;
    readonly senderId: string;
    readonly now: Date;
  }): Promise<void>;
}

export interface ConversationView {
  readonly messages: readonly ChatMessage[];
  readonly unreadCount: number;
}

/** 채팅방 목록 Port. 회차가 여러 개여도 방(project+supplier) 단위 record를 준다. */
export interface ChatRoomRecord extends ChatApplication {
  readonly messages: readonly ChatMessage[];
  readonly projectTitle: string;
  readonly clientDisplayName: string;
  readonly supplierDisplayName: string;
}

export interface ChatRoomListPort {
  listRoomsForUser(userId: string): Promise<readonly ChatRoomRecord[]>;
}

export interface ChatRoomSummary extends ChatApplication {
  readonly projectTitle: string;
  /** 조회자 기준 상대방 표시 이름. 내부 사용자 ID는 새로 노출하지 않는다. */
  readonly counterpartDisplayName: string;
  readonly lastMessage: ChatMessage | null;
  readonly unreadCount: number;
}

const WRITABLE_STATUSES: readonly ApplicationStatus[] = ['SUBMITTED', 'STALE', 'ACCEPTED'];

function chatNotFound(): ChatError {
  return new ChatError(404, 'CHAT_NOT_FOUND', '대화를 찾을 수 없습니다.');
}

/** 두 당사자만 접근한다. 그 외에는 존재 여부를 숨긴다. */
function requireParty(actor: ChatActor, application: ChatApplication): void {
  if (actor.userId !== application.clientUserId && actor.userId !== application.supplierId) {
    throw chatNotFound();
  }
}

/** 계약 체결(ACTIVE) 전까지는 연락처를 가린다. 임시 계약도 포함한다. */
export function shouldMaskContacts(application: ChatApplication): boolean {
  return application.contractStatus === null || application.contractStatus === 'PENDING_CONSENT';
}

export function countUnread(
  messages: readonly ChatMessage[],
  readerId: string,
): number {
  return messages.filter((message) => message.senderId !== readerId && message.readAt === null)
    .length;
}

/** First client open only: the repository's atomic result gates the metric event. */
export async function openConversation(
  repository: ChatRepository,
  input: {
    readonly actor: ChatActor;
    readonly applicationId: string;
    readonly now: Date;
    readonly events: ChatEventPort;
  },
): Promise<{ readonly opened: boolean }> {
  const application = await repository.findApplication(input.applicationId);
  if (application === null) throw chatNotFound();
  requireParty(input.actor, application);
  if (input.actor.role !== 'CLIENT' || input.actor.userId !== application.clientUserId) {
    throw new ChatError(403, 'CLIENT_ONLY', '의뢰인만 문의 대화를 열 수 있습니다.');
  }

  const opened = await input.events.recordInquiryOpenedOnce({
    projectId: application.projectId,
    clientUserId: application.clientUserId,
    openedAt: input.now,
  });
  return { opened };
}

export async function sendMessage(
  repository: ChatRepository,
  input: {
    readonly actor: ChatActor;
    readonly account: ChatAccountState;
    readonly applicationId: string;
    readonly body: string;
    readonly now: Date;
    readonly notifications?: ChatNotificationPort;
  },
): Promise<ChatMessage> {
  const application = await repository.findApplication(input.applicationId);
  if (application === null) throw chatNotFound();
  requireParty(input.actor, application);

  if (input.account.suspendedAt !== null) {
    throw new ChatError(403, 'ACCOUNT_SUSPENDED', '정지된 계정은 메시지를 보낼 수 없습니다.');
  }
  if (input.account.withdrawnAt !== null) {
    throw new ChatError(403, 'ACCOUNT_WITHDRAWN', '탈퇴한 계정은 메시지를 보낼 수 없습니다.');
  }
  if (
    input.account.chatRestrictedUntil !== null &&
    input.account.chatRestrictedUntil.getTime() > input.now.getTime()
  ) {
    throw new ChatError(403, 'CHAT_RESTRICTED', '채팅 제한 기간에는 메시지를 보낼 수 없습니다.');
  }
  if (!WRITABLE_STATUSES.includes(application.status)) {
    throw new ChatError(403, 'CHAT_READ_ONLY', '종료된 지원의 대화는 읽기만 할 수 있습니다.');
  }

  if (input.actor.userId === application.supplierId) {
    const clientStarted = await repository.hasMessageFrom({
      projectId: application.projectId,
      supplierId: application.supplierId,
      senderId: application.clientUserId,
    });
    if (!clientStarted) {
      throw new ChatError(403, 'CHAT_NOT_STARTED', '의뢰인이 먼저 문의해야 답할 수 있습니다.');
    }
  }

  const trimmed = input.body.trim();
  if (trimmed.length === 0) {
    throw new ChatError(400, 'MESSAGE_EMPTY', '빈 메시지는 보낼 수 없습니다.');
  }

  const masked = shouldMaskContacts(application)
    ? maskContacts(trimmed)
    : { text: trimmed, masked: false };

  const created = await repository.createMessage({
    applicationId: application.id,
    senderId: input.actor.userId,
    kind: 'TEXT',
    body: masked.text,
    isMasked: masked.masked,
    createdAt: input.now,
  });

  await input.notifications?.notifyNewMessage({
    projectId: application.projectId,
    supplierId: application.supplierId,
    clientUserId: application.clientUserId,
    supplierUserId: application.supplierId,
    senderId: input.actor.userId,
    now: input.now,
  });

  return created;
}

/**
 * `GET /me/chats`: 내가 당사자인 방만, 최근 메시지 순으로. 회차 중복은 최신 방 record로 합친다.
 */
export async function listChatRooms(
  port: ChatRoomListPort,
  input: { readonly actor: ChatActor },
): Promise<readonly ChatRoomSummary[]> {
  if (input.actor.role === 'ADMIN') return [];

  const rooms = await port.listRoomsForUser(input.actor.userId);
  const byRoom = new Map<string, { summary: ChatRoomSummary; lastAt: number }>();

  for (const room of rooms) {
    if (
      room.clientUserId !== input.actor.userId &&
      room.supplierId !== input.actor.userId
    ) {
      continue;
    }

    const ordered = [...room.messages].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
    );
    const lastMessage = ordered.at(-1) ?? null;
    const summary: ChatRoomSummary = {
      id: room.id,
      projectId: room.projectId,
      clientUserId: room.clientUserId,
      supplierId: room.supplierId,
      status: room.status,
      contractStatus: room.contractStatus,
      projectTitle: room.projectTitle,
      counterpartDisplayName:
        room.clientUserId === input.actor.userId
          ? room.supplierDisplayName
          : room.clientDisplayName,
      lastMessage,
      unreadCount: countUnread(room.messages, input.actor.userId),
    };

    const key = `${room.projectId}\u0000${room.supplierId}`;
    const existing = byRoom.get(key);
    const lastAt = lastMessage?.createdAt.getTime() ?? Number.NEGATIVE_INFINITY;
    if (existing === undefined || lastAt > existing.lastAt) {
      byRoom.set(key, { summary, lastAt });
    }
  }

  return [...byRoom.values()]
    .map((entry) => entry.summary)
    .sort(
      (a, b) =>
        (b.lastMessage?.createdAt.getTime() ?? Number.NEGATIVE_INFINITY) -
          (a.lastMessage?.createdAt.getTime() ?? Number.NEGATIVE_INFINITY) ||
        a.projectId.localeCompare(b.projectId) ||
        a.supplierId.localeCompare(b.supplierId),
    );
}

export async function listConversation(
  repository: ChatRepository,
  input: {
    readonly actor: ChatActor;
    readonly applicationId: string;
    readonly after?: Date;
  },
): Promise<ConversationView> {
  const application = await repository.findApplication(input.applicationId);
  if (application === null) throw chatNotFound();
  requireParty(input.actor, application);

  const thread = await repository.findThreadMessages({
    projectId: application.projectId,
    supplierId: application.supplierId,
  });
  const ordered = [...thread].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );
  const after = input.after;
  const messages =
    after === undefined
      ? ordered
      : ordered.filter((message) => message.createdAt.getTime() > after.getTime());

  return { messages, unreadCount: countUnread(ordered, input.actor.userId) };
}

export async function markConversationRead(
  repository: ChatRepository,
  input: {
    readonly actor: ChatActor;
    readonly applicationId: string;
    readonly now: Date;
  },
): Promise<number> {
  const application = await repository.findApplication(input.applicationId);
  if (application === null) throw chatNotFound();
  requireParty(input.actor, application);

  const thread = await repository.findThreadMessages({
    projectId: application.projectId,
    supplierId: application.supplierId,
  });
  const unreadIds = thread
    .filter(
      (message) => message.senderId !== input.actor.userId && message.readAt === null,
    )
    .map((message) => message.id);

  if (unreadIds.length === 0) return 0;

  return repository.markRead({
    messageIds: unreadIds,
    readerId: input.actor.userId,
    now: input.now,
  });
}
