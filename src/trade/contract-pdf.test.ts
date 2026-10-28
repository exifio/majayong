import { expect, test } from '@jest/globals';
import { TradeError } from './errors.js';
import {
  CALENDAR_DURATION_LABEL,
  assertCalendarDurationDays,
  formatCalendarDuration,
} from './contract-pdf.js';

test('계약서 PDF의 작업 소요일수는 공휴일 포함 달력일로 표시한다', () => {
  expect(CALENDAR_DURATION_LABEL).toBe('작업 소요일수(달력일, 공휴일 포함)');
  expect(formatCalendarDuration(1)).toBe('1일 (달력일, 공휴일 포함)');
  expect(formatCalendarDuration(30)).toBe('30일 (달력일, 공휴일 포함)');
});

test('작업 소요일수가 1일 미만이거나 정수가 아니면 계약서를 만들지 않는다', () => {
  for (const bad of [0, -1, 1.5, Number.NaN]) {
    let thrown: unknown;
    try {
      assertCalendarDurationDays(bad);
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TradeError);
    expect(thrown).toHaveProperty('code', 'INVALID_DURATION_DAYS');
  }
});
