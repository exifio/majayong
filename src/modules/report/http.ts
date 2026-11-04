/** Gate 0: 신고 HTTP 라우터 (API_INDEX #099~#100, #114~#115). */
import { Router, type Request } from 'express';

import { HttpError, sendCreated, sendData } from '../../http/envelope.js';
import {
  bodyObject,
  oneOf,
  nullableText,
  text,
} from '../../http/parse.js';
import {
  REPORT_ACTIONS,
  REPORT_REASONS,
  listMyReports,
  listReports,
  resolveReport,
  submitReport,
  type MyReportQueryPort,
  type ReportActor,
  type ReportStatus,
  type ReportUnitOfWork,
} from './reports.js';

export interface ReportHttpPorts {
  readonly uow: ReportUnitOfWork;
  readonly myReports: MyReportQueryPort;
  readonly now: () => Date;
}

function actorOf(request: Request): ReportActor {
  const actor = request.actor;
  if (actor === undefined) throw new HttpError(401, 'UNAUTHENTICATED', '로그인이 필요합니다.');
  return actor;
}

function statusOf(request: Request): ReportStatus | undefined {
  const raw = request.query.status;
  if (raw === undefined) return undefined;
  if (raw !== 'OPEN' && raw !== 'RESOLVED') {
    throw new HttpError(400, 'INVALID_REQUEST', 'status 값이 올바르지 않습니다.');
  }
  return raw;
}

export function createReportRouter(ports: ReportHttpPorts): Router {
  const router = Router();

  router.post('/messages/:messageId/reports', async (request, response) => {
    const body = bodyObject(request.body, ['reason', 'detail']);
    const report = await submitReport(ports.uow, {
      actor: actorOf(request),
      messageId: request.params.messageId as string,
      reason: oneOf(body.reason, 'reason', REPORT_REASONS),
      detail: nullableText(body.detail, 'detail', 2000) ?? undefined,
      now: ports.now(),
    });
    sendCreated(response, report);
  });

  router.get('/me/reports', async (request, response) => {
    const rows = await listMyReports(ports.myReports, {
      actor: actorOf(request),
      status: statusOf(request),
    });
    sendData(response, rows);
  });

  router.get('/admin/reports', async (request, response) => {
    const rows = await listReports(ports.uow, {
      actor: actorOf(request),
      status: statusOf(request),
    });
    sendData(response, rows);
  });

  router.post('/admin/reports/:reportId/resolve', async (request, response) => {
    const body = bodyObject(request.body, ['action', 'actionNote']);
    const result = await resolveReport(ports.uow, {
      actor: actorOf(request),
      reportId: request.params.reportId as string,
      action: oneOf(body.action, 'action', REPORT_ACTIONS),
      actionNote: text(body.actionNote, 'actionNote', { max: 2000 }) as string,
      now: ports.now(),
    });
    sendData(response, result);
  });

  return router;
}
