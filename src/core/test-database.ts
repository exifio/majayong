const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);

export function assertTestDatabase(url: string | undefined): string {
  const candidate = url?.trim();
  if (!candidate) throw new Error("TEST_DATABASE_URL is required for database tests");

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("TEST_DATABASE_URL must be a valid URL");
  }

  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error("TEST_DATABASE_URL must be a PostgreSQL URL");
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  if (!localHosts.has(hostname)) {
    throw new Error("Database tests refuse to run outside a local database");
  }
  // `_check`는 INTEGRATION_GATE2 런북의 일회용 검증 DB 이름이다.
  if (!/(_test|_check)$/.test(parsed.pathname.replace(/^\//, ""))) {
    throw new Error("Database tests require a dedicated *_test or *_check database");
  }
  return candidate;
}
