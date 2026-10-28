import type { NextFunction, Request, RequestHandler, Response } from "express";
import { Role } from "@prisma/client";
import { AppError } from "./errors.ts";

export interface AuthUser {
  userId: string;
  role: Role;
  sessionId?: string;
}

export type AuthVerifier = (req: Request) => Promise<AuthUser | null> | AuthUser | null;

declare global {
  namespace Express {
    interface Request {
      auth?: AuthUser;
    }
  }
}

function isRole(value: string): value is Role {
  return value === Role.CLIENT || value === Role.SUPPLIER || value === Role.ADMIN;
}

function parseHeaderAuth(req: Request): AuthUser | null {
  if (process.env.NODE_ENV === "production" || process.env.ALLOW_HEADER_AUTH !== "true") {
    return null;
  }
  const userId = req.header("x-user-id")?.trim();
  const roleRaw = req.header("x-user-role")?.trim();
  if (!userId || !roleRaw) {
    return null;
  }
  if (!isRole(roleRaw)) {
    throw new AppError(401, "UNAUTHORIZED", "유효하지 않은 사용자 역할 정보입니다.");
  }
  const rawSessionId = req.header("x-session-id")?.trim();
  const sessionId =
    rawSessionId !== undefined && rawSessionId.length > 0 ? rawSessionId : undefined;
  return { userId, role: roleRaw, sessionId };
}

export function attachAuth(verifier?: AuthVerifier): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const verified = verifier ? await verifier(req) : parseHeaderAuth(req);
    if (verified) {
      req.auth = verified;
    }
    next();
  };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.auth) {
    throw new AppError(401, "UNAUTHORIZED", "로그인이 필요합니다.");
  }
  next();
};

export function getRequiredAuth(req: Request): AuthUser {
  if (!req.auth) {
    throw new AppError(401, "UNAUTHORIZED", "로그인이 필요합니다.");
  }
  return req.auth;
}

export function requireRole(...allowedRoles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) {
      throw new AppError(401, "UNAUTHORIZED", "로그인이 필요합니다.");
    }
    if (!allowedRoles.includes(req.auth.role)) {
      throw new AppError(403, "FORBIDDEN", "해당 작업을 수행할 권한이 없습니다.");
    }
    next();
  };
}
