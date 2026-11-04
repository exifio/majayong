/** Gate 0: 라우터 입력 파서. 알 수 없는 필드는 거부하고 타입을 좁힌다. */
import { HttpError } from './envelope.js';

export function bodyObject(
  value: unknown,
  allowed: readonly string[],
): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HttpError(400, 'INVALID_REQUEST', '요청 본문은 객체여야 합니다.');
  }
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new HttpError(400, 'UNKNOWN_FIELD', `허용되지 않은 필드입니다: ${unknown.join(', ')}`);
  }
  return record;
}

export function text(
  value: unknown,
  field: string,
  options: { readonly max: number; readonly optional?: boolean },
): string | undefined {
  if (value === undefined) {
    if (options.optional === true) return undefined;
    throw new HttpError(400, 'INVALID_REQUEST', `${field}가 필요합니다.`);
  }
  if (typeof value !== 'string' || value.length === 0 || value.length > options.max) {
    throw new HttpError(400, 'INVALID_REQUEST', `${field} 형식이 올바르지 않습니다.`);
  }
  return value;
}

export function nullableText(
  value: unknown,
  field: string,
  max: number,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > max) {
    throw new HttpError(400, 'INVALID_REQUEST', `${field} 형식이 올바르지 않습니다.`);
  }
  return value;
}

export function integer(
  value: unknown,
  field: string,
  options: { readonly min?: number; readonly max?: number } = {},
): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new HttpError(400, 'INVALID_REQUEST', `${field}는 정수여야 합니다.`);
  }
  if (options.min !== undefined && value < options.min) {
    throw new HttpError(400, 'INVALID_REQUEST', `${field}가 너무 작습니다.`);
  }
  if (options.max !== undefined && value > options.max) {
    throw new HttpError(400, 'INVALID_REQUEST', `${field}가 너무 큽니다.`);
  }
  return value;
}

export function boolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new HttpError(400, 'INVALID_REQUEST', `${field}는 boolean이어야 합니다.`);
  }
  return value;
}

export function stringArray(
  value: unknown,
  field: string,
  options: { readonly max?: number } = {},
): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new HttpError(400, 'INVALID_REQUEST', `${field}는 문자열 배열이어야 합니다.`);
  }
  if (options.max !== undefined && value.length > options.max) {
    throw new HttpError(400, 'INVALID_REQUEST', `${field}가 너무 많습니다.`);
  }
  return value as readonly string[];
}

export function oneOf<Value extends string>(
  value: unknown,
  field: string,
  allowed: readonly Value[],
): Value {
  const found = allowed.find((candidate) => candidate === value);
  if (found === undefined) {
    throw new HttpError(400, 'INVALID_REQUEST', `${field} 값이 올바르지 않습니다.`);
  }
  return found;
}

export function questions(
  value: unknown,
  max: number,
): readonly { readonly text: string }[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > max) {
    throw new HttpError(400, 'TOO_MANY_QUESTIONS', `질문은 최대 ${max}개입니다.`);
  }
  return value.map((item) => {
    const record = bodyObject(item, ['text']);
    const text = record.text;
    if (typeof text !== 'string' || text.length === 0 || text.length > 500) {
      throw new HttpError(400, 'INVALID_REQUEST', '질문 형식이 올바르지 않습니다.');
    }
    return { text };
  });
}

export function items(
  value: unknown,
): readonly { readonly specItemId: string; readonly isAvailable: boolean }[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new HttpError(400, 'INVALID_REQUEST', 'items는 배열이어야 합니다.');
  }
  return value.map((item) => {
    const record = bodyObject(item, ['specItemId', 'isAvailable']);
    return {
      specItemId: text(record.specItemId, 'specItemId', { max: 64 }) as string,
      isAvailable: boolean(record.isAvailable, 'isAvailable'),
    };
  });
}
