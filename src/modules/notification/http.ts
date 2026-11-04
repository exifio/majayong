/** Gate 0: 알림 HTTP 라우터 (API_INDEX #096~#098). */
import { Router, type Request } from 'express';

import { HttpError, sendData } from '../../http/envelope.js';
import { bodyObject } from '../../http/parse.js';
import type { Actor } from '../application/dto.js';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationUnitOfWork,
} from './notifications.js';

export interface NotificationHttpPorts {
  readonly uow: NotificationUnitOfWork;
  readonly now: () => Date;
}

function actorOf(request: Request): Actor {
  const actor = request.actor;
  if (actor === undefined) throw new HttpError(401, 'UNAUTHENTICATED', '로그인이 필요합니다.');
  return actor;
}

export function createNotificationRouter(ports: NotificationHttpPorts): Router {
  const router = Router();

  router.get('/me/notifications', async (request, response) => {
    const actor = actorOf(request);
    const unreadOnly = request.query.unreadOnly === 'true';
    const list = await listNotifications(ports.uow, {
      userId: actor.userId,
      now: ports.now(),
      unreadOnly,
    });
    sendData(response, list.items, { unreadCount: list.unreadCount });
  });

  router.patch('/me/notifications/:notificationId/read', async (request, response) => {
    const actor = actorOf(request);
    bodyObject(request.body, []);
    await markNotificationRead(ports.uow, {
      notificationId: request.params.notificationId as string,
      userId: actor.userId,
      now: ports.now(),
    });
    sendData(response, { isRead: true });
  });

  router.post('/me/notifications/read-all', async (request, response) => {
    const actor = actorOf(request);
    bodyObject(request.body, []);
    const updated = await markAllNotificationsRead(ports.uow, {
      userId: actor.userId,
      now: ports.now(),
    });
    sendData(response, { updated });
  });

  return router;
}
