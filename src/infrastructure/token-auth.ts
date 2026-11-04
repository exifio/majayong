import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { HttpActor } from "../c-app.ts";

const HEADER = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");

export interface TokenClaims extends HttpActor {
  exp: number;
}

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

/** A 인증 모듈이 발급하는 토큰과 동일 형식(HS256 JWT). 테스트/개발 발급용. */
export function signAccessToken(claims: TokenClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify({ sub: claims.userId, role: claims.role, exp: claims.exp })).toString("base64url");
  const data = `${HEADER}.${payload}`;
  return `${data}.${sign(data, secret)}`;
}

export function verifyAccessToken(token: string, secret: string, now: Date): HttpActor | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  if (header !== HEADER) return null;
  const expected = sign(`${header}.${payload}`, secret);
  const provided = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (provided.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(provided, expectedBuffer)) return null;

  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof claims !== "object" || claims === null || Array.isArray(claims)) return null;
  const value = claims as Record<string, unknown>;
  if (typeof value.sub !== "string" || value.sub.length === 0) return null;
  if (typeof value.role !== "string" || value.role.length === 0) return null;
  if (typeof value.exp !== "number" || value.exp * 1000 <= now.getTime()) return null;
  return { userId: value.sub, role: value.role };
}

export function createTokenAuthenticator(
  secret: string,
  clock: { now(): Date } = { now: () => new Date() },
): (req: IncomingMessage) => HttpActor | null {
  if (!secret) throw new Error("AUTH_TOKEN_SECRET is required");
  return (req) => {
    const header = req.headers.authorization;
    if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;
    return verifyAccessToken(header.slice("Bearer ".length).trim(), secret, clock.now());
  };
}
