/**
 * Gate 0: HTTP 공통 응답 봉투와 오류 매핑.
 *
 * 성공: `{ data }` / 목록 `{ data, meta }`
 * 오류: `{ error: { code, message, requestId } }`
 * 도메인 오류는 status/code를 가진 객체로 판별하고, 그 외는 500으로 숨긴다.
 */
import type { Response } from 'express';

export interface ErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly requestId: string;
  };
}

/** 라우터 입력 검증 실패처럼 HTTP 계층에서 만드는 오류. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

interface DomainErrorLike {
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

function isDomainError(value: unknown): value is DomainErrorLike {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<DomainErrorLike>;
  return (
    typeof candidate.status === 'number' &&
    typeof candidate.code === 'string' &&
    typeof candidate.message === 'string'
  );
}

export function requestIdOf(res: Response): string {
  return res.locals.requestId as string;
}

export function sendData(
  res: Response,
  data: unknown,
  meta?: Readonly<Record<string, unknown>>,
): void {
  if (meta === undefined) {
    res.status(200).json({ data });
    return;
  }
  res.status(200).json({ data, meta });
}

export function sendCreated(res: Response, data: unknown): void {
  res.status(201).json({ data });
}

export function toErrorBody(error: unknown, requestId: string): ErrorBody {
  if (isDomainError(error)) {
    return {
      error: { code: error.code, message: error.message, requestId },
    };
  }
  return {
    error: {
      code: 'INTERNAL_ERROR',
      message: '요청을 처리하지 못했습니다.',
      requestId,
    },
  };
}

/** Express 오류 미들웨어. 라우터에서 throw한 도메인 오류를 봉투로 바꾼다. */
export function errorHandler(
  error: unknown,
  _request: unknown,
  response: Response,
  next: (error?: unknown) => void,
): void {
  if (response.headersSent) {
    next(error);
    return;
  }
  const body = toErrorBody(error, requestIdOf(response));
  const status = isDomainError(error) ? error.status : 500;
  if (!isDomainError(error) && process.env.NODE_ENV !== 'production') {
    console.error(`[${requestIdOf(response)}]`, error);
  }
  response.status(status).json(body);
}
