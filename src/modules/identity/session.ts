import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Prisma, PrismaClient, Role } from "@prisma/client";
import { issueAccessToken, verifyAccessToken } from "./auth.js";

export type SessionTokens = {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
};
export type Actor = { userId: string; role: Role };

export const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function refreshTokenHash(token: string): string | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return createHash("sha256").update(token).digest("hex");
}

function newRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

function tokenPair(userId: string, role: Role, refreshToken: string, refreshExpiresAt: Date, secret: string, now: Date): SessionTokens {
  const accessExpiresAt = now.getTime() + ACCESS_TOKEN_TTL_MS;
  return {
    accessToken: issueAccessToken({ userId, role, expiresAt: accessExpiresAt }, secret),
    refreshToken,
    accessExpiresAt,
    refreshExpiresAt: refreshExpiresAt.getTime(),
  };
}

async function revokeFamily(tx: Prisma.TransactionClient, familyId: string, now: Date): Promise<void> {
  await tx.refreshSession.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: now },
  });
}

export class SessionError extends Error {
  constructor(readonly code: string) { super(code); }
}

export async function createSessionTokens(db: PrismaClient, userId: string, secret: string, now: Date): Promise<SessionTokens> {
  if (Buffer.byteLength(secret) < 32 || Number.isNaN(now.getTime())) throw new SessionError("AUTH_CONFIG_INVALID");
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true, suspendedAt: true, withdrawnAt: true } });
  if (!user) throw new SessionError("ACCOUNT_NOT_FOUND");
  if (user.suspendedAt || user.withdrawnAt) throw new SessionError("ACCOUNT_INACTIVE");

  const refreshToken = newRefreshToken();
  const refreshExpiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);
  await db.refreshSession.create({
    data: {
      userId,
      familyId: randomUUID(),
      tokenHash: refreshTokenHash(refreshToken)!,
      expiresAt: refreshExpiresAt,
    },
  });
  return tokenPair(userId, user.role, refreshToken, refreshExpiresAt, secret, now);
}

export async function rotateRefreshToken(db: PrismaClient, token: string, secret: string, now: Date): Promise<SessionTokens> {
  const tokenHash = refreshTokenHash(token);
  if (!tokenHash) throw new SessionError("REFRESH_TOKEN_INVALID");
  if (Buffer.byteLength(secret) < 32 || Number.isNaN(now.getTime())) throw new SessionError("AUTH_CONFIG_INVALID");

  const result = await db.$transaction(async tx => {
    const session = await tx.refreshSession.findUnique({ where: { tokenHash } });
    if (!session) return { error: "REFRESH_TOKEN_INVALID" } as const;
    if (session.revokedAt) {
      await revokeFamily(tx, session.familyId, now);
      return { error: "REFRESH_TOKEN_REUSED" } as const;
    }
    if (session.expiresAt <= now) {
      await revokeFamily(tx, session.familyId, now);
      return { error: "REFRESH_TOKEN_EXPIRED" } as const;
    }

    const user = await tx.user.findUnique({
      where: { id: session.userId },
      select: { role: true, suspendedAt: true, withdrawnAt: true },
    });
    if (!user || user.suspendedAt || user.withdrawnAt) {
      await revokeFamily(tx, session.familyId, now);
      return { error: "ACCOUNT_INACTIVE" } as const;
    }

    const refreshToken = newRefreshToken();
    const replacementId = randomUUID();
    await tx.refreshSession.create({
      data: {
        id: replacementId,
        userId: session.userId,
        familyId: session.familyId,
        tokenHash: refreshTokenHash(refreshToken)!,
        expiresAt: session.expiresAt,
      },
    });
    const updated = await tx.refreshSession.updateMany({
      where: { id: session.id, revokedAt: null, expiresAt: { gt: now } },
      data: { revokedAt: now, replacedById: replacementId },
    });
    if (updated.count !== 1) {
      await tx.refreshSession.delete({ where: { id: replacementId } });
      await revokeFamily(tx, session.familyId, now);
      return { error: "REFRESH_TOKEN_REUSED" } as const;
    }
    return { tokens: tokenPair(session.userId, user.role, refreshToken, session.expiresAt, secret, now) } as const;
  });

  if (result.error !== undefined) throw new SessionError(result.error);
  return result.tokens;
}

export async function revokeRefreshTokenFamily(db: PrismaClient, token: string, now: Date): Promise<void> {
  const tokenHash = refreshTokenHash(token);
  if (!tokenHash) return;
  await db.$transaction(async tx => {
    const session = await tx.refreshSession.findUnique({ where: { tokenHash }, select: { familyId: true } });
    if (session) await revokeFamily(tx, session.familyId, now);
  });
}

export async function requireActor(db: PrismaClient, token: string, secret: string, now: number): Promise<Actor> {
  const claims = verifyAccessToken(token, secret, now);
  if (!claims) throw new SessionError("INVALID_ACCESS_TOKEN");
  const user = await db.user.findUnique({
    where: { id: claims.userId },
    select: { role: true, suspendedAt: true, withdrawnAt: true },
  });
  if (!user || user.suspendedAt || user.withdrawnAt) throw new SessionError("ACCOUNT_INACTIVE");
  if (user.role !== claims.role) throw new SessionError("INVALID_ACCESS_TOKEN");
  return { userId: claims.userId, role: user.role };
}
