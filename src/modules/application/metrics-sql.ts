/**
 * B-08-U03: PostgreSQL 지표 집계 SQL.
 *
 * `BMetricSource`는 개인정보 없는 projection만 요구한다. 여기서는 Prisma 타입을
 * 직접 쓰지 않고 구조적 query runner만 받아, 스키마가 동결되면 그대로 연결한다.
 * EventLog는 당사자별로 중복 기록되므로 contractId 단위로 합친다.
 */
import type { ReportAction } from '../report/reports.js';
import type { BMetricSource, MetricBreakReason } from './metrics.js';

export interface MetricQueryRunner {
  query<Row>(sql: string, params: readonly unknown[]): Promise<readonly Row[]>;
}

interface QuoteRow {
  readonly firstViewedAt: Date;
  readonly submittedAt: Date;
}

interface IdRow {
  readonly id: string;
}

interface ContractEventRow {
  readonly type: string;
  readonly contractId: string;
  readonly conditionCount: number | null;
  readonly decidedCount: number | null;
  readonly reason: string | null;
}

interface ReportRow {
  readonly projectId: string;
  readonly supplierId: string;
  readonly action: string | null;
}

const BREAK_REASONS: readonly MetricBreakReason[] = [
  'CONSENT_TIMEOUT',
  'SIGN_REFUSED',
  'CLIENT_CANCELLED',
  'DEPOSIT_TIMEOUT',
];

const REPORT_ACTIONS: readonly ReportAction[] = [
  'NONE',
  'WARNING',
  'CHAT_RESTRICT_7D',
  'SUSPEND',
];

const QUOTES_SQL = `
SELECT "firstViewedAt", "submittedAt"
FROM applications
WHERE "submittedAt" >= $1 AND "submittedAt" <= $2`;

const APPLIED_PROJECTS_SQL = `
SELECT DISTINCT "projectId" AS id
FROM applications
WHERE "submittedAt" >= $1 AND "submittedAt" <= $2`;

const INQUIRY_PROJECTS_SQL = `
SELECT DISTINCT "projectId" AS id
FROM event_logs
WHERE type = 'INQUIRY_OPENED'
  AND "projectId" IS NOT NULL
  AND "occurredAt" >= $1 AND "occurredAt" <= $2`;

const CONTRACT_EVENTS_SQL = `
SELECT type,
       "contractId",
       MAX((payload->>'conditionCount')::int) AS "conditionCount",
       MAX((payload->>'decidedCount')::int) AS "decidedCount",
       MAX(payload->>'reason') AS reason
FROM event_logs
WHERE type IN ('APPLICATION_ACCEPTED', 'CONTRACT_AGREED', 'CONTRACT_BROKEN')
  AND "contractId" IS NOT NULL
  AND "occurredAt" >= $1 AND "occurredAt" <= $2
GROUP BY type, "contractId"`;

const REPORTS_SQL = `
SELECT a."projectId", a."supplierId", r.action
FROM reports r
JOIN application_messages m ON m.id = r."messageId"
JOIN applications a ON a.id = m."applicationId"
WHERE r."createdAt" >= $1 AND r."createdAt" <= $2`;

const CHAT_ROOMS_SQL = `
SELECT count(*)::int AS id
FROM (
  SELECT DISTINCT a."projectId", a."supplierId"
  FROM application_messages m
  JOIN applications a ON a.id = m."applicationId"
  WHERE m."createdAt" >= $1 AND m."createdAt" <= $2
) rooms`;

function toBreakReason(value: string | null, contractId: string): MetricBreakReason {
  const reason = BREAK_REASONS.find((candidate) => candidate === value);
  if (reason === undefined) throw new Error(`INVALID_METRIC_SOURCE: ${contractId}`);
  return reason;
}

function toReportAction(value: string | null, projectId: string): ReportAction | null {
  if (value === null) return null;
  const action = REPORT_ACTIONS.find((candidate) => candidate === value);
  if (action === undefined) throw new Error(`INVALID_METRIC_SOURCE: ${projectId}`);
  return action;
}

export async function loadBMetricSource(
  runner: MetricQueryRunner,
  input: { readonly since: Date; readonly now: Date },
): Promise<BMetricSource> {
  const params = [input.since, input.now];
  const [quotes, applied, inquiries, contractRows, reportRows, roomRows] = await Promise.all([
    runner.query<QuoteRow>(QUOTES_SQL, params),
    runner.query<IdRow>(APPLIED_PROJECTS_SQL, params),
    runner.query<IdRow>(INQUIRY_PROJECTS_SQL, params),
    runner.query<ContractEventRow>(CONTRACT_EVENTS_SQL, params),
    runner.query<ReportRow>(REPORTS_SQL, params),
    runner.query<{ readonly id: number }>(CHAT_ROOMS_SQL, params),
  ]);

  const contractEvents = contractRows.map((row) => {
    if (row.type === 'APPLICATION_ACCEPTED') {
      if (row.conditionCount === null || row.decidedCount === null) {
        throw new Error(`INVALID_METRIC_SOURCE: ${row.contractId}`);
      }
      return {
        type: 'APPLICATION_ACCEPTED' as const,
        contractId: row.contractId,
        conditionCount: row.conditionCount,
        decidedCount: row.decidedCount,
      };
    }
    if (row.type === 'CONTRACT_AGREED') {
      return { type: 'CONTRACT_AGREED' as const, contractId: row.contractId };
    }
    return {
      type: 'CONTRACT_BROKEN' as const,
      contractId: row.contractId,
      reason: toBreakReason(row.reason, row.contractId),
    };
  });

  return {
    quotes,
    appliedProjectIds: applied.map((row) => row.id),
    inquiryOpenedProjectIds: inquiries.map((row) => row.id),
    contractEvents,
    reports: reportRows.map((row) => ({
      chatRoomId: `${row.projectId}:${row.supplierId}`,
      action: toReportAction(row.action, row.projectId),
    })),
    chatRoomCount: roomRows[0]?.id ?? 0,
  };
}
