/** Gate 0: 문의 채팅 HTTP 라우터 (API_INDEX #061~#065). */
import { Router, type Request } from 'express';

import { HttpError, sendCreated, sendData } from '../../http/envelope.js';
import { bodyObject, text } from '../../http/parse.js';
import type { Actor } from '../application/dto.js';
import {
  listChatRooms,
  listConversation,
  markConversationRead,
  openConversation,
  sendMessage,
  type ChatAccountState,
  type ChatEventPort,
  type ChatNotificationPort,
  type ChatRepository,
  type ChatRoomListPort,
} from './conversation.js';

export interface ChatHttpPorts {
  readonly repository: ChatRepository;
  readonly rooms: ChatRoomListPort;
  readonly accounts: {
    getAccountState(userId: string): Promise<ChatAccountState>;
  };
  readonly events: ChatEventPort;
  readonly notifications?: ChatNotificationPort;
  readonly now: () => Date;
}

function actorOf(request: Request): Actor {
  const actor = request.actor;
  if (actor === undefined) throw new HttpError(401, 'UNAUTHENTICATED', '로그인이 필요합니다.');
  return actor;
}

function afterOf(request: Request): Date | undefined {
  const raw = request.query.after;
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, 'INVALID_REQUEST', 'after 형식이 올바르지 않습니다.');
  }
  return parsed;
}

export function createChatRouter(ports: ChatHttpPorts): Router {
  const router = Router();

  router.get('/me/chats', async (request, response) => {
    const rooms = await listChatRooms(ports.rooms, { actor: actorOf(request) });
    sendData(response, rooms);
  });

  router.post('/applications/:applicationId/chat/open', async (request, response) => {
    const actor = actorOf(request);
    if (actor.role !== 'CLIENT') {
      throw new HttpError(403, 'CLIENT_ONLY', '의뢰인만 대화를 열 수 있습니다.');
    }
    bodyObject(request.body, []);
    const result = await openConversation(ports.repository, {
      actor,
      applicationId: request.params.applicationId as string,
      now: ports.now(),
      events: ports.events,
    });
    sendData(response, result);
  });

  router.get('/applications/:applicationId/messages', async (request, response) => {
    const view = await listConversation(ports.repository, {
      actor: actorOf(request),
      applicationId: request.params.applicationId as string,
      after: afterOf(request),
    });
    sendData(response, view);
  });

  router.post('/applications/:applicationId/messages', async (request, response) => {
    const actor = actorOf(request);
    const body = bodyObject(request.body, ['body']);
    const account = await ports.accounts.getAccountState(actor.userId);
    const message = await sendMessage(ports.repository, {
      actor,
      account,
      applicationId: request.params.applicationId as string,
      body: text(body.body, 'body', { max: 2000 }) as string,
      now: ports.now(),
      notifications: ports.notifications,
    });
    sendCreated(response, message);
  });

  router.post('/applications/:applicationId/messages/read', async (request, response) => {
    bodyObject(request.body, []);
    const updated = await markConversationRead(ports.repository, {
      actor: actorOf(request),
      applicationId: request.params.applicationId as string,
      now: ports.now(),
    });
    sendData(response, { updated });
  });

  return router;
}
