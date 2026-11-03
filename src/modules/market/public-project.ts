/**
 * B-00: A가 제공하는 Project/SpecItem 공개 projection의 B 쪽 계약.
 *
 * 공개 범위(PRD 7.1):
 * - 전체 공개: 업종, 요약, 명세 항목 이름/수, 희망 예산 구간, 마감일, 필요 기술 스택
 * - 상세 공개: 기능 설명, 정할 것+메모, 화면 초안, 정확한 희망 예산, 의뢰인 공개 프로필
 * - 절대 비공개: 계정 이메일, 의뢰인 원문, AI 단가/예상 총액, 증빙/정산 정보
 *
 * A의 응답은 신뢰 경계 밖 입력이므로 런타임으로 검증한다. Gate 0에서 공통 validator가
 * 동결되기 전까지 B 로컬 최소 검증기를 사용한다.
 */

export const PROJECT_STATUSES = [
  'SCHEDULED',
  'RECRUITING',
  'SELECTING',
  'ACCEPTED',
  'CONTRACTED',
  'EXPIRED',
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export interface HopeBudgetRange {
  readonly minKrw: number;
  readonly maxKrw: number;
}

/** 목록/카드에 쓰는 전체 공개 projection. */
export interface PublicProjectSummary {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly industryCode: string;
  readonly requiredSkills: readonly string[];
  readonly hopeBudgetRange: HopeBudgetRange | null;
  readonly deadline: Date | null;
  readonly status: ProjectStatus;
  readonly publishedAt: Date | null;
  readonly currentSpecVersion: number;
  readonly specItemCount: number;
  readonly specItemTitles: readonly string[];
}

/** 상세에서만 쓰는 명세 항목 요약. versionNo는 지원 회차의 기준 버전이다. */
export interface PublicSpecItemSummary {
  readonly id: string;
  readonly versionNo: number;
  readonly title: string;
}

/** 상세 공개 projection. 실제 상세 필드 검증은 B-01에서 확장한다. */
export interface PublicProjectDetail extends PublicProjectSummary {
  readonly exactHopeBudgetKrw: number | null;
  readonly specItems: readonly PublicSpecItemSummary[];
}

export class MarketError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'MarketError';
    this.status = status;
    this.code = code;
  }
}

export type PublicProjectContractViolationReason =
  | 'UNKNOWN_FIELD'
  | 'SENSITIVE_FIELD'
  | 'INVALID_VALUE';

export class PublicProjectContractError extends MarketError {
  readonly field: string;
  readonly reason: PublicProjectContractViolationReason;

  constructor(field: string, reason: PublicProjectContractViolationReason) {
    super(
      502,
      'PUBLIC_PROJECT_CONTRACT_VIOLATION',
      `공개 프로젝트 응답이 계약과 다릅니다: ${field}`,
    );
    this.name = 'PublicProjectContractError';
    this.field = field;
    this.reason = reason;
  }
}

const PUBLIC_PROJECT_KEYS = new Set<string>([
  'id',
  'title',
  'summary',
  'industryCode',
  'requiredSkills',
  'hopeBudgetRange',
  'deadline',
  'status',
  'publishedAt',
  'currentSpecVersion',
  'specItemCount',
  'specItemTitles',
]);

/**
 * 공개 응답에 절대 포함되면 안 되는 필드. 값이 null이어도 필드 자체를 거부한다.
 * A가 실수로 내부 projection을 그대로 넘기는 경우를 계약 위반으로 만든다.
 */
const SENSITIVE_PROJECT_KEYS = new Set<string>([
  'unitPrice',
  'estimatedTotal',
  'estimatedTotalWithClientFee',
  'aiUnitPrice',
  'aiEstimatedTotal',
  'clientEmail',
  'email',
  'clientUtterance',
  'utterance',
  'rawText',
  'rawContent',
  'payoutAccount',
  'bankAccount',
  'accountNumber',
  'residentRegistrationNumber',
  'password',
  'passwordHash',
  'accessToken',
  'refreshToken',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidField(field: string): PublicProjectContractError {
  return new PublicProjectContractError(field, 'INVALID_VALUE');
}

function assertProjectKeys(record: Record<string, unknown>): void {
  for (const key of Object.keys(record)) {
    if (SENSITIVE_PROJECT_KEYS.has(key)) {
      throw new PublicProjectContractError(key, 'SENSITIVE_FIELD');
    }
    if (!PUBLIC_PROJECT_KEYS.has(key)) {
      throw new PublicProjectContractError(key, 'UNKNOWN_FIELD');
    }
  }
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) throw invalidField(key);
  return value;
}

function readNonNegativeInt(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw invalidField(key);
  }
  return value;
}

function readNullableDate(record: Record<string, unknown>, key: string): Date | null {
  const value = record[key];
  if (value === null) return null;
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw invalidField(key);
  return value;
}

function readStringArray(record: Record<string, unknown>, key: string): readonly string[] {
  const value = record[key];
  if (!Array.isArray(value)) throw invalidField(key);

  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') throw invalidField(key);
    result.push(item);
  }
  return result;
}

function isProjectStatus(value: unknown): value is ProjectStatus {
  return typeof value === 'string' && PROJECT_STATUSES.some((status) => status === value);
}

function readHopeBudgetRange(
  record: Record<string, unknown>,
  key: string,
): HopeBudgetRange | null {
  const value = record[key];
  if (value === null) return null;
  if (!isRecord(value)) throw invalidField(key);

  const minKrw = readNonNegativeInt(value, 'minKrw');
  const maxKrw = readNonNegativeInt(value, 'maxKrw');
  if (minKrw > maxKrw) throw invalidField(key);

  return { minKrw, maxKrw };
}

export function toPublicProjectSummary(input: unknown): PublicProjectSummary {
  if (!isRecord(input)) throw invalidField('$project');

  assertProjectKeys(input);

  const statusValue = input.status;
  if (!isProjectStatus(statusValue)) throw invalidField('status');

  return {
    id: readString(input, 'id'),
    title: readString(input, 'title'),
    summary: readString(input, 'summary'),
    industryCode: readString(input, 'industryCode'),
    requiredSkills: readStringArray(input, 'requiredSkills'),
    hopeBudgetRange: readHopeBudgetRange(input, 'hopeBudgetRange'),
    deadline: readNullableDate(input, 'deadline'),
    status: statusValue,
    publishedAt: readNullableDate(input, 'publishedAt'),
    currentSpecVersion: readNonNegativeInt(input, 'currentSpecVersion'),
    specItemCount: readNonNegativeInt(input, 'specItemCount'),
    specItemTitles: readStringArray(input, 'specItemTitles'),
  };
}

export interface ProjectReadInput {
  readonly projectId: string;
  readonly viewerId: string;
}

/**
 * A가 구현하는 읽기 Port. 응답 형식:
 * - { kind: 'FOUND', project: PublicProjectSummary }
 * - { kind: 'NOT_FOUND' }
 * - null/undefined/throw = A 서비스 응답 없음
 */
export interface ProjectReadPort {
  findPublicProject(input: ProjectReadInput): Promise<unknown>;
}

const PROJECT_READ_UNAVAILABLE_MESSAGE = '프로젝트 정보를 불러오지 못했습니다.';

export async function readPublicProject(
  port: ProjectReadPort,
  input: ProjectReadInput,
): Promise<PublicProjectSummary> {
  let response: unknown;
  try {
    response = await port.findPublicProject(input);
  } catch {
    throw new MarketError(503, 'PROJECT_READ_UNAVAILABLE', PROJECT_READ_UNAVAILABLE_MESSAGE);
  }

  if (response === null || response === undefined) {
    throw new MarketError(503, 'PROJECT_READ_UNAVAILABLE', PROJECT_READ_UNAVAILABLE_MESSAGE);
  }
  if (!isRecord(response)) throw invalidField('$response');
  if (response.kind === 'NOT_FOUND') {
    throw new MarketError(404, 'PROJECT_NOT_FOUND', '프로젝트를 찾을 수 없습니다.');
  }
  if (response.kind !== 'FOUND') throw invalidField('kind');

  return toPublicProjectSummary(response.project);
}

export interface ErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly requestId: string;
  };
}

interface HttpErrorLike {
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

function isHttpError(error: unknown): error is HttpErrorLike {
  if (typeof error !== 'object' || error === null) return false;
  if (!('status' in error) || !('code' in error) || !('message' in error)) return false;

  return (
    typeof error.status === 'number' &&
    typeof error.code === 'string' &&
    typeof error.message === 'string'
  );
}

/** API_CONTRACT.md의 공통 오류 봉투. 내부 예외 내용은 노출하지 않는다. */
export function errorResponse(error: unknown, requestId: string): ErrorBody {
  if (isHttpError(error)) {
    return { error: { code: error.code, message: error.message, requestId } };
  }
  return {
    error: {
      code: 'INTERNAL_ERROR',
      message: '서버 오류가 발생했습니다.',
      requestId,
    },
  };
}
