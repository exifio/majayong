import { assertTestDatabase } from "../core/test-database.ts";

/**
 * DATABASE_URL이 있으면 전용 테스트 DB인지 확인한다.
 * 없으면 undefined를 돌려주어 기존처럼 describe skip으로 처리한다.
 */
export function testDatabaseUrl(): string | undefined {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return undefined;
  return assertTestDatabase(url);
}
