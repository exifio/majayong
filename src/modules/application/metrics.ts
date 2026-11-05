/** B-08: 개인 식별정보 없이 재계산 가능한 지표 읽기 모델. */
import type { ReportAction } from '../report/reports.js';

export type MetricBreakReason =
  | 'CONSENT_TIMEOUT'
  | 'SIGN_REFUSED'
  | 'CLIENT_CANCELLED'
  | 'DEPOSIT_TIMEOUT';

export interface BMetricSource {
  readonly quotes: readonly {
    readonly firstViewedAt: Date;
    readonly submittedAt: Date;
  }[];
  /** 프로젝트당 distinct ID만 제공. ID는 결과 DTO에 노출되지 않는다. */
  readonly appliedProjectIds: readonly string[];
  readonly inquiryOpenedProjectIds: readonly string[];
  /** EventLog 집계 투영. EventLog per-party 중복은 contractId로 제거한다. */
  readonly contractEvents: readonly (
    | {
        readonly type: 'APPLICATION_ACCEPTED';
        readonly contractId: string;
        readonly conditionCount: number;
        readonly decidedCount: number;
      }
    | { readonly type: 'CONTRACT_AGREED'; readonly contractId: string }
    | { readonly type: 'CONTRACT_BROKEN'; readonly contractId: string; readonly reason: MetricBreakReason }
  )[];
  /** Report→ApplicationMessage→Application join에서 만든 별도 집계 query 결과. */
  readonly reports: readonly {
    readonly chatRoomId: string;
    readonly action: ReportAction | null;
  }[];
  readonly chatRoomCount: number;
}

export interface BMetricSummary {
  readonly quoteDraft: {
    readonly count: number;
    readonly averageDurationMs: number;
  };
  readonly inquiryRate: {
    readonly eligibleProjects: number;
    readonly projectsWithInquiry: number;
    readonly rate: number;
  };
  readonly conditionDecisionRate: {
    readonly totalConditions: number;
    readonly decidedConditions: number;
    readonly rate: number;
  };
  readonly contractBreakRate: {
    readonly acceptedContracts: number;
    readonly brokenContracts: number;
    readonly rate: number;
    readonly byReason: Readonly<Record<MetricBreakReason, number>>;
  };
  readonly depositTimeoutRate: {
    readonly agreedContracts: number;
    readonly depositTimeouts: number;
    readonly rate: number;
  };
  readonly reportRate: {
    readonly chatRooms: number;
    readonly reportedRooms: number;
    readonly reports: number;
    readonly reportsPerChatRoom: number;
    readonly rate: number;
    readonly byAction: Readonly<Record<'UNRESOLVED' | ReportAction, number>>;
  };
}

function invalidMetricSource(): never {
  throw new Error('INVALID_METRIC_SOURCE');
}

function isCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function validDate(value: Date): boolean {
  return Number.isFinite(value.getTime());
}

export function summarizeBMetrics(source: BMetricSource): BMetricSummary {
  const quoteDurations = source.quotes.map(({ firstViewedAt, submittedAt }) => {
    if (
      !validDate(firstViewedAt) ||
      !validDate(submittedAt) ||
      submittedAt.getTime() < firstViewedAt.getTime()
    ) {
      invalidMetricSource();
    }
    return submittedAt.getTime() - firstViewedAt.getTime();
  });
  if (quoteDurations.some((duration) => !Number.isSafeInteger(duration))) invalidMetricSource();
  if (
    source.appliedProjectIds.some((id) => id.length === 0) ||
    source.inquiryOpenedProjectIds.some((id) => id.length === 0)
  ) {
    invalidMetricSource();
  }
  const appliedProjects = new Set(source.appliedProjectIds);
  const projectsWithInquiry = new Set(
    source.inquiryOpenedProjectIds.filter((projectId) => appliedProjects.has(projectId)),
  );
  const acceptedContracts = new Set<string>();
  const agreedContracts = new Set<string>();
  const brokenContracts = new Map<string, MetricBreakReason>();
  const agreementByContract = new Map<string, { conditionCount: number; decidedCount: number }>();
  for (const event of source.contractEvents) {
    if (event.contractId.length === 0) invalidMetricSource();
    if (event.type === 'APPLICATION_ACCEPTED') {
      if (
        !isCount(event.conditionCount) ||
        !isCount(event.decidedCount) ||
        event.decidedCount > event.conditionCount
      ) {
        invalidMetricSource();
      }
      acceptedContracts.add(event.contractId);
      const previous = agreementByContract.get(event.contractId);
      if (
        previous !== undefined &&
        (previous.conditionCount !== event.conditionCount || previous.decidedCount !== event.decidedCount)
      ) {
        invalidMetricSource();
      }
      agreementByContract.set(event.contractId, {
        conditionCount: event.conditionCount,
        decidedCount: event.decidedCount,
      });
    }
    if (event.type === 'CONTRACT_AGREED') agreedContracts.add(event.contractId);
    if (event.type === 'CONTRACT_BROKEN') {
      const previousReason = brokenContracts.get(event.contractId);
      if (previousReason !== undefined && previousReason !== event.reason) invalidMetricSource();
      brokenContracts.set(event.contractId, event.reason);
    }
  }
  for (const contractId of brokenContracts.keys()) {
    if (!acceptedContracts.has(contractId)) invalidMetricSource();
  }

  const byReason: Record<MetricBreakReason, number> = {
    CONSENT_TIMEOUT: 0,
    SIGN_REFUSED: 0,
    CLIENT_CANCELLED: 0,
    DEPOSIT_TIMEOUT: 0,
  };
  for (const reason of brokenContracts.values()) byReason[reason] += 1;

  const byAction: Record<'UNRESOLVED' | ReportAction, number> = {
    UNRESOLVED: 0,
    NONE: 0,
    WARNING: 0,
    CHAT_RESTRICT_7D: 0,
    SUSPEND: 0,
  };
  const reportedRooms = new Set<string>();
  for (const report of source.reports) {
    if (report.chatRoomId.length === 0) invalidMetricSource();
    reportedRooms.add(report.chatRoomId);
    byAction[report.action ?? 'UNRESOLVED'] += 1;
  }

  const totalConditions = [...agreementByContract.values()].reduce(
    (total, event) => total + event.conditionCount,
    0,
  );
  const decidedConditions = [...agreementByContract.values()].reduce(
    (total, event) => total + event.decidedCount,
    0,
  );
  if (
    !isCount(source.chatRoomCount) ||
    reportedRooms.size > source.chatRoomCount ||
    !Number.isSafeInteger(totalConditions) ||
    !Number.isSafeInteger(decidedConditions)
  ) {
    invalidMetricSource();
  }
  const quoteDurationTotal = quoteDurations.reduce((total, duration) => total + duration, 0);
  if (!Number.isSafeInteger(quoteDurationTotal) || source.reports.length > Number.MAX_SAFE_INTEGER) {
    invalidMetricSource();
  }

  const brokenContractsCount = brokenContracts.size;
  return {
    quoteDraft: {
      count: quoteDurations.length,
      averageDurationMs:
        quoteDurations.length === 0
          ? 0
          : quoteDurationTotal / quoteDurations.length,
    },
    inquiryRate: {
      eligibleProjects: appliedProjects.size,
      projectsWithInquiry: projectsWithInquiry.size,
      rate: appliedProjects.size === 0 ? 0 : projectsWithInquiry.size / appliedProjects.size,
    },
    conditionDecisionRate: {
      totalConditions,
      decidedConditions,
      rate: totalConditions === 0 ? 0 : decidedConditions / totalConditions,
    },
    contractBreakRate: {
      acceptedContracts: acceptedContracts.size,
      brokenContracts: brokenContractsCount,
      rate: acceptedContracts.size === 0 ? 0 : brokenContractsCount / acceptedContracts.size,
      byReason,
    },
    depositTimeoutRate: {
      agreedContracts: agreedContracts.size,
      depositTimeouts: byReason.DEPOSIT_TIMEOUT,
      rate:
        agreedContracts.size === 0 ? 0 : byReason.DEPOSIT_TIMEOUT / agreedContracts.size,
    },
    reportRate: {
      chatRooms: source.chatRoomCount,
      reportedRooms: reportedRooms.size,
      reports: source.reports.length,
      reportsPerChatRoom:
        source.chatRoomCount === 0 ? 0 : source.reports.length / source.chatRoomCount,
      rate: source.chatRoomCount === 0 ? 0 : reportedRooms.size / source.chatRoomCount,
      byAction,
    },
  };
}
