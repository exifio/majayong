/**
 * B-04: AI 정할 것 태그와 최종 합의 내용 확인.
 *
 * LLM 응답은 신뢰 경계 밖 입력이므로 다음을 도메인에서 강제한다.
 * - 존재하는 Block/SpecItem 조건만 반영한다.
 * - DECIDED는 양측(서로 다른 발신자 2명)의 근거 메시지가 있을 때만 인정한다.
 * - 같은 조건의 여러 합의 중 근거 시각이 가장 최근 것을 쓴다.
 * - LLM이 말하지 않은 조건은 UNDECIDED로 유지한다.
 * - LLM 오류 시 새 합의를 만들지 않고 이전 캐시 또는 전부 UNDECIDED로 안전 실패한다.
 *
 * `Application.agreementDraft`는 캐시이며, 새 메시지가 오면 무효화한다.
 */
import type { ApplicationRecord } from '../application/dto.js';

export type ConditionState = 'DECIDED' | 'PROPOSED' | 'UNDECIDED';

export interface AgreementMessage {
  readonly id: string;
  readonly senderId: string | null;
  readonly body: string;
  readonly createdAt: Date;
}

export interface AgreementSpecCondition {
  readonly key: string;
  readonly text: string;
}

export interface AgreementSpecItem {
  readonly blockId: string;
  readonly specItemId: string | null;
  readonly title: string;
  readonly stage: 'INTERIM' | 'FINAL';
  readonly conditions: readonly AgreementSpecCondition[];
}

export interface AgreementSpec {
  readonly items: readonly AgreementSpecItem[];
  readonly defaultInterimRatio: number;
}

export interface AgreementCondition {
  readonly key: string;
  readonly text: string;
  readonly state: ConditionState;
  readonly evidenceMessageIds: readonly string[];
}

export interface AgreementItem {
  readonly blockId: string;
  readonly specItemId: string | null;
  readonly title: string;
  readonly stage: 'INTERIM' | 'FINAL';
  readonly conditions: readonly AgreementCondition[];
}

export interface AgreementDraft {
  readonly items: readonly AgreementItem[];
  readonly interimRatio: number;
  readonly ratioState: ConditionState;
  /** 캐시 기준 시각. */
  readonly cachedAt: Date;
  /** 이 초안이 반영한 마지막 메시지 시각. 새 메시지가 더 최근이면 캐시가 낡았다. */
  readonly lastMessageAt: Date | null;
}

export class AgreementExtractionError extends Error {
  readonly status = 502;
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'AgreementExtractionError';
    this.code = code;
  }
}

/** 추출기가 돌려줘야 하는 최소 형태. 필드 존재·타입은 빌더가 다시 검사한다. */
export interface AgreementExtractionCondition {
  readonly key: string;
  readonly state: ConditionState;
  readonly evidenceMessageIds?: readonly string[];
}

export interface AgreementExtractionItem {
  readonly blockId: string;
  readonly conditions?: readonly AgreementExtractionCondition[];
}

export interface AgreementExtraction {
  readonly items: readonly AgreementExtractionItem[];
  readonly interimRatio?: number;
  readonly ratioState?: ConditionState;
}

/** LLM/규칙 추출기. 반환값은 검증 전 unknown이다. */
export interface AgreementExtractionPort {
  extract(input: {
    readonly messages: readonly AgreementMessage[];
    readonly spec: AgreementSpec;
  }): Promise<unknown>;
}

export interface AgreementRefreshResult {
  readonly draft: AgreementDraft;
  readonly refreshed: boolean;
  readonly failed: boolean;
  readonly stale: boolean;
  readonly errorCode: string | null;
}

export function buildAgreementDraft(
  extraction: unknown,
  input: {
    readonly spec: AgreementSpec;
    readonly messages: readonly AgreementMessage[];
    readonly now: Date;
  },
): AgreementDraft {
  const rawItems = readExtractionItems(extraction);
  const messagesById = new Map(input.messages.map((message) => [message.id, message]));
  const specBlocks = new Map(input.spec.items.map((item) => [item.blockId, item]));
  const best = new Map<string, Candidate>();

  rawItems.forEach((rawItem, itemOrder) => {
    if (!isRecord(rawItem)) invalidExtraction('항목이 객체가 아닙니다.');
    const blockId = rawItem.blockId;
    if (typeof blockId !== 'string') invalidExtraction('blockId가 문자열이 아닙니다.');

    const specItem = specBlocks.get(blockId);
    if (specItem === undefined) {
      throw new AgreementExtractionError('UNKNOWN_BLOCK', `명세에 없는 블록입니다: ${blockId}`);
    }

    const specConditions = new Map(
      specItem.conditions.map((condition) => [condition.key, condition]),
    );
    const rawConditions = rawItem.conditions;
    if (rawConditions !== undefined && !Array.isArray(rawConditions)) {
      invalidExtraction('conditions가 배열이 아닙니다.');
    }

    (rawConditions ?? []).forEach((rawCondition, conditionOrder) => {
      if (!isRecord(rawCondition)) invalidExtraction('조건이 객체가 아닙니다.');
      const key = rawCondition.key;
      if (typeof key !== 'string') invalidExtraction('조건 key가 문자열이 아닙니다.');
      if (!specConditions.has(key)) {
        throw new AgreementExtractionError(
          'UNKNOWN_CONDITION',
          `블록 ${blockId}에 없는 조건입니다: ${key}`,
        );
      }

      const state = readConditionState(rawCondition.state);
      if (state === null) invalidExtraction(`알 수 없는 조건 상태입니다: ${String(rawCondition.state)}`);

      const evidence = readEvidence(rawCondition.evidenceMessageIds, messagesById);
      if (state === 'DECIDED') {
        const senders = new Set(
          evidence
            .map((id) => messagesById.get(id)?.senderId)
            .filter((senderId): senderId is string => typeof senderId === 'string'),
        );
        if (senders.size < 2) {
          throw new AgreementExtractionError(
            'AGREEMENT_EVIDENCE_REQUIRED',
            `양측 근거가 없어 합의로 확정할 수 없습니다: ${blockId}/${key}`,
          );
        }
      }

      const candidate: Candidate = {
        state,
        evidenceMessageIds: evidence,
        latestAt: latestMessageTime(evidence, messagesById),
        order: itemOrder * 1_000 + conditionOrder,
      };
      const mapKey = `${blockId}\u0000${key}`;
      const existing = best.get(mapKey);
      if (
        existing === undefined ||
        candidate.latestAt > existing.latestAt ||
        (candidate.latestAt === existing.latestAt && candidate.order >= existing.order)
      ) {
        best.set(mapKey, candidate);
      }
    });
  });

  const items = input.spec.items.map((specItem): AgreementItem => ({
    blockId: specItem.blockId,
    specItemId: specItem.specItemId,
    title: specItem.title,
    stage: specItem.stage,
    conditions: specItem.conditions.map((specCondition): AgreementCondition => {
      const candidate = best.get(`${specItem.blockId}\u0000${specCondition.key}`);
      return {
        key: specCondition.key,
        text: specCondition.text,
        state: candidate?.state ?? 'UNDECIDED',
        evidenceMessageIds: candidate?.evidenceMessageIds ?? [],
      };
    }),
  }));

  const record = extraction as Record<string, unknown>;
  let interimRatio = input.spec.defaultInterimRatio;
  const rawRatio = record.interimRatio;
  if (rawRatio !== undefined) {
    if (
      typeof rawRatio !== 'number' ||
      !Number.isInteger(rawRatio) ||
      rawRatio < 10 ||
      rawRatio > 90
    ) {
      throw new AgreementExtractionError(
        'INVALID_INTERIM_RATIO',
        '중간 지급 비율은 10~90 사이 정수여야 합니다.',
      );
    }
    interimRatio = rawRatio;
  }

  let ratioState: ConditionState = 'UNDECIDED';
  if (record.ratioState !== undefined) {
    const parsed = readConditionState(record.ratioState);
    if (parsed === null) {
      invalidExtraction(`알 수 없는 비율 상태입니다: ${String(record.ratioState)}`);
    }
    ratioState = parsed;
  }

  const lastMessageAt = latestMessageTime(
    input.messages.map((message) => message.id),
    messagesById,
  );

  return {
    items,
    interimRatio,
    ratioState,
    cachedAt: input.now,
    lastMessageAt:
      lastMessageAt === Number.NEGATIVE_INFINITY ? null : new Date(lastMessageAt),
  };
}

export function isDraftFresh(
  draft: AgreementDraft,
  messages: readonly AgreementMessage[],
): boolean {
  const latest = messages.reduce<number>(
    (max, message) => Math.max(max, message.createdAt.getTime()),
    Number.NEGATIVE_INFINITY,
  );

  if (draft.lastMessageAt === null) return latest === Number.NEGATIVE_INFINITY;
  if (latest === Number.NEGATIVE_INFINITY) return false;
  return latest <= draft.lastMessageAt.getTime();
}

export async function refreshAgreementDraft(
  port: AgreementExtractionPort,
  input: {
    readonly spec: AgreementSpec;
    readonly messages: readonly AgreementMessage[];
    readonly now: Date;
    readonly previous?: AgreementDraft | null;
  },
): Promise<AgreementRefreshResult> {
  const previous = input.previous ?? null;
  if (previous !== null && isDraftFresh(previous, input.messages)) {
    return {
      draft: previous,
      refreshed: false,
      failed: false,
      stale: false,
      errorCode: null,
    };
  }

  try {
    const extraction = await port.extract({
      messages: input.messages,
      spec: input.spec,
    });
    const draft = buildAgreementDraft(extraction, {
      spec: input.spec,
      messages: input.messages,
      now: input.now,
    });
    return {
      draft,
      refreshed: true,
      failed: false,
      stale: false,
      errorCode: null,
    };
  } catch (error) {
    return {
      draft: previous ?? emptyDraft(input.spec, input.now),
      refreshed: false,
      failed: true,
      stale: true,
      errorCode:
        error instanceof AgreementExtractionError ? error.code : 'EXTRACTION_FAILED',
    };
  }
}

interface Candidate {
  readonly state: ConditionState;
  readonly evidenceMessageIds: readonly string[];
  readonly latestAt: number;
  readonly order: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidExtraction(message: string): never {
  throw new AgreementExtractionError('INVALID_EXTRACTION', message);
}

function readExtractionItems(extraction: unknown): readonly unknown[] {
  if (!isRecord(extraction)) invalidExtraction('추출 결과가 객체가 아닙니다.');
  const items = extraction.items;
  if (!Array.isArray(items)) invalidExtraction('items가 배열이 아닙니다.');
  return items;
}

function readConditionState(value: unknown): ConditionState | null {
  if (value === 'DECIDED' || value === 'PROPOSED' || value === 'UNDECIDED') {
    return value;
  }
  return null;
}

function readEvidence(
  value: unknown,
  messagesById: ReadonlyMap<string, AgreementMessage>,
): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) invalidExtraction('evidenceMessageIds가 배열이 아닙니다.');

  const ids: string[] = [];
  for (const id of value) {
    if (typeof id !== 'string') invalidExtraction('근거 메시지 ID가 문자열이 아닙니다.');
    if (!messagesById.has(id)) {
      throw new AgreementExtractionError(
        'UNKNOWN_EVIDENCE',
        `대화에 없는 근거 메시지입니다: ${id}`,
      );
    }
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

function latestMessageTime(
  ids: readonly string[],
  messagesById: ReadonlyMap<string, AgreementMessage>,
): number {
  return ids.reduce((latest, id) => {
    const createdAt = messagesById.get(id)?.createdAt.getTime();
    if (createdAt === undefined) return latest;
    return Math.max(latest, createdAt);
  }, Number.NEGATIVE_INFINITY);
}

function emptyDraft(spec: AgreementSpec, now: Date): AgreementDraft {
  return {
    items: spec.items.map((item) => ({
      blockId: item.blockId,
      specItemId: item.specItemId,
      title: item.title,
      stage: item.stage,
      conditions: item.conditions.map((condition) => ({
        key: condition.key,
        text: condition.text,
        state: 'UNDECIDED' as const,
        evidenceMessageIds: [],
      })),
    })),
    interimRatio: spec.defaultInterimRatio,
    ratioState: 'UNDECIDED',
    cachedAt: now,
    lastMessageAt: null,
  };
}

/** 미래 확장용 참조: 합의 초안은 Application 행에 JSON 캐시로 붙는다. */
export type AgreementDraftOwner = Pick<ApplicationRecord, 'id'>;
