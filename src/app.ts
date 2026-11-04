import { Role } from "@prisma/client";
import express, { type ErrorRequestHandler, type Express, type Request, type RequestHandler, type Response, type Router } from "express";
import { createRequestId, errorResponse } from "./core/observability.js";
import {
  authenticateWithEmail,
  authenticateWithGoogle,
  completeEmailChange,
  completePasswordReset,
  createPrismaIdentityStore,
  disconnectGoogle,
  IdentityError,
  issueGoogleOnboardingToken,
  issuePasswordResetToken,
  registerWithEmail,
  requestEmailChange,
  setPassword,
  verifyGoogleOnboardingToken,
  withdrawAccount,
} from "./modules/identity/auth.js";
import { exchangeGoogleCode, GoogleOAuthError, type GoogleOAuthConfig } from "./modules/identity/google.js";
import {
  createSessionTokens,
  requireActor,
  revokeRefreshTokenFamily,
  rotateRefreshToken,
  SessionError,
  type Actor,
  type SessionTokens,
} from "./modules/identity/session.js";
import { createPrismaWithdrawalStore } from "./modules/identity/withdrawal.js";
import { mountProfileApi, type ProfilePorts } from "./modules/profile/api.js";
import { ProfileError } from "./modules/profile/errors.js";
import { mountPricingApi } from "./modules/pricing/api.js";
import { mountProjectApi } from "./modules/project/api.js";
import type { PrismaClient } from "@prisma/client";

export type AppOptions = {
  db: PrismaClient;
  tokenSecret: string;
  now?: () => Date;
  google?: GoogleOAuthConfig;
  googleFetcher?: typeof fetch;
  sendPasswordReset?: (email: string, token: string) => Promise<void>;
  sendEmailChange?: (email: string, token: string) => Promise<void>;
  projectDisclosureConsentVersion?: () => string | null;
  profile?: ProfilePorts;
  /** B/C 라우터. A와 같은 세션 인증으로 `/api/v1` 아래에 mount한다. */
  routers?: readonly Router[];
};

class ApiError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}

type IdentityUser = { id: string; email: string; role: Role };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requestBody(req: Request): Record<string, unknown> {
  if (!isRecord(req.body)) throw new ApiError("INVALID_REQUEST", 400);
  return req.body;
}

function only(body: Record<string, unknown>, fields: string[]): void {
  if (Object.keys(body).some(field => !fields.includes(field))) throw new ApiError("INVALID_REQUEST", 400);
}

function string(body: Record<string, unknown>, field: string, maxLength = 4096): string {
  const value = body[field];
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) throw new ApiError("INVALID_REQUEST", 400);
  return value;
}

function optionalNullableString(body: Record<string, unknown>, field: string, maxLength: number): string | null | undefined {
  if (!(field in body)) return undefined;
  const value = body[field];
  if (value === null) return null;
  if (typeof value !== "string" || value.length > maxLength) throw new ApiError("INVALID_REQUEST", 400);
  return value;
}

function role(value: unknown): Role {
  if (value !== Role.CLIENT && value !== Role.SUPPLIER) throw new IdentityError("INVALID_ROLE");
  return value;
}

function sessionData(user: IdentityUser, tokens: SessionTokens) {
  return {
    user,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accessExpiresAt: new Date(tokens.accessExpiresAt).toISOString(),
    refreshExpiresAt: new Date(tokens.refreshExpiresAt).toISOString(),
  };
}

function statusFor(error: unknown): { status: number; code: string; message: string } {
  if (error instanceof ApiError) return { status: error.status, code: error.code, message: error.status >= 500 ? "요청을 처리할 수 없습니다." : "요청을 확인해 주세요." };
  if (error instanceof ProfileError) return { status: error.status, code: error.code, message: error.status >= 500 ? "요청을 처리할 수 없습니다." : "요청을 확인해 주세요." };
  if (error instanceof SessionError) {
    const status = error.code === "ACCOUNT_INACTIVE" ? 403 : error.code === "ACCOUNT_NOT_FOUND" ? 404 : 401;
    return { status, code: error.code, message: "인증 정보를 확인해 주세요." };
  }
  if (error instanceof GoogleOAuthError) {
    const status = error.code === "GOOGLE_CONFIG_OR_CODE_INVALID" ? 503 : 401;
    return { status, code: error.code, message: "Google 인증을 완료할 수 없습니다." };
  }
  if (error instanceof IdentityError) {
    if (["INVALID_CREDENTIALS", "RESET_TOKEN_INVALID", "EMAIL_TOKEN_INVALID", "GOOGLE_ONBOARDING_TOKEN_INVALID"].includes(error.code))
      return { status: 401, code: error.code, message: "인증 정보를 확인해 주세요." };
    if (error.code === "ACCOUNT_INACTIVE") return { status: 403, code: error.code, message: "이 계정은 사용할 수 없습니다." };
    if (["EMAIL_ALREADY_REGISTERED", "ROLE_MISMATCH", "GOOGLE_ACCOUNT_CONFLICT", "ACCOUNT_CHANGED", "ACTIVE_CONTRACTS_EXIST", "GOOGLE_NOT_CONNECTED"].includes(error.code))
      return { status: 409, code: error.code, message: "현재 상태에서는 요청을 완료할 수 없습니다." };
    if (error.code === "ACCOUNT_NOT_FOUND") return { status: 404, code: error.code, message: "계정을 찾을 수 없습니다." };
    if (error.code === "DELIVERY_UNAVAILABLE") return { status: 503, code: error.code, message: "인증 메일 발송을 사용할 수 없습니다." };
    return { status: 422, code: error.code, message: "요청 값을 확인해 주세요." };
  }
  if (isRecord(error) && typeof error.status === "number" && typeof error.code === "string") {
    const status = error.status;
    const message = typeof error.message === "string" ? error.message : "요청을 확인해 주세요.";
    return { status, code: error.code, message };
  }
  const parserStatus = isRecord(error) && typeof error.status === "number" ? error.status : 0;
  if (parserStatus === 400 || parserStatus === 413) {
    return { status: parserStatus, code: parserStatus === 413 ? "REQUEST_TOO_LARGE" : "INVALID_JSON", message: "요청 형식을 확인해 주세요." };
  }
  return { status: 500, code: "INTERNAL_ERROR", message: "요청을 처리하지 못했습니다." };
}

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next) => { void handler(req, res).catch(next); };
}

function authenticated(options: AppOptions, handler: (req: Request, res: Response, actor: Actor) => Promise<void>): RequestHandler {
  return asyncRoute(async (req, res) => {
    const match = /^Bearer ([^\s]+)$/.exec(req.get("authorization") ?? "");
    if (!match) throw new SessionError("INVALID_ACCESS_TOKEN");
    const actor = await requireActor(options.db, match[1]!, options.tokenSecret, (options.now?.() ?? new Date()).getTime());
    await handler(req, res, actor);
  });
}

function requireActorMiddleware(options: AppOptions): RequestHandler {
  return (req, _res, next) => {
    void (async () => {
      const match = /^Bearer ([^\s]+)$/.exec(req.get("authorization") ?? "");
      if (!match) throw new SessionError("INVALID_ACCESS_TOKEN");
      const actor = await requireActor(
        options.db,
        match[1]!,
        options.tokenSecret,
        (options.now?.() ?? new Date()).getTime(),
      );
      (req as Request & { actor?: Actor }).actor = actor;
      next();
    })().catch(next);
  };
}

function sendSession(res: Response, user: IdentityUser, tokens: SessionTokens, status = 200): void {
  res.status(status).json({ data: sessionData(user, tokens) });
}

export function createApp(options: AppOptions): Express {
  if (Buffer.byteLength(options.tokenSecret) < 32) throw new Error("TOKEN_SECRET_TOO_SHORT");
  const now = () => options.now?.() ?? new Date();
  const store = createPrismaIdentityStore(options.db);
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const requestId = createRequestId();
    res.locals.requestId = requestId;
    res.setHeader("x-request-id", requestId);
    next();
  });
  app.use(express.json({ limit: "16kb" }));

  const router = express.Router();
  router.post("/auth/register", asyncRoute(async (req, res) => {
    const body = requestBody(req);
    only(body, ["email", "password", "role", "termsVersion"]);
    const user = await registerWithEmail(store, {
      email: string(body, "email", 254),
      password: string(body, "password", 1024),
      role: role(body.role),
      termsVersion: string(body, "termsVersion", 100),
      now: now(),
    });
    const tokens = await createSessionTokens(options.db, user.id, options.tokenSecret, now());
    sendSession(res, user, tokens, 201);
  }));

  router.post("/auth/login", asyncRoute(async (req, res) => {
    const body = requestBody(req);
    only(body, ["email", "password"]);
    const user = await authenticateWithEmail(store, { email: string(body, "email", 254), password: string(body, "password", 1024) });
    sendSession(res, user, await createSessionTokens(options.db, user.id, options.tokenSecret, now()));
  }));

  router.post("/auth/google/exchange", asyncRoute(async (req, res) => {
    const body = requestBody(req);
    only(body, ["code"]);
    const identity = await exchangeGoogleCode(string(body, "code", 4096), options.google ?? { clientId: "", clientSecret: "", redirectUri: "" }, options.googleFetcher);
    try {
      const user = await authenticateWithGoogle(store, { ...identity, now: now() });
      sendSession(res, user, await createSessionTokens(options.db, user.id, options.tokenSecret, now()));
    } catch (error) {
      if (!(error instanceof IdentityError) || error.code !== "ROLE_REQUIRED") throw error;
      const onboardingToken = issueGoogleOnboardingToken(identity, options.tokenSecret, now().getTime());
      res.json({ data: { onboardingRequired: true, onboardingToken } });
    }
  }));

  router.post("/auth/google/complete-onboarding", asyncRoute(async (req, res) => {
    const body = requestBody(req);
    only(body, ["onboardingToken", "role", "termsVersion"]);
    const identity = verifyGoogleOnboardingToken(string(body, "onboardingToken"), options.tokenSecret, now().getTime());
    if (!identity) throw new IdentityError("GOOGLE_ONBOARDING_TOKEN_INVALID");
    const existing = await store.findByGoogleSubject(identity.subject);
    const user = await authenticateWithGoogle(store, {
      ...identity,
      emailVerified: true,
      role: role(body.role),
      termsVersion: string(body, "termsVersion", 100),
      now: now(),
    });
    sendSession(res, user, await createSessionTokens(options.db, user.id, options.tokenSecret, now()), existing ? 200 : 201);
  }));

  router.post("/auth/refresh", asyncRoute(async (req, res) => {
    const body = requestBody(req);
    only(body, ["refreshToken"]);
    const tokens = await rotateRefreshToken(options.db, string(body, "refreshToken"), options.tokenSecret, now());
    const actor = await requireActor(options.db, tokens.accessToken, options.tokenSecret, now().getTime());
    const user = await options.db.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { id: true, email: true, role: true } });
    sendSession(res, user, tokens);
  }));

  router.post("/auth/logout", asyncRoute(async (req, res) => {
    const body = isRecord(req.body) ? req.body : {};
    only(body, ["refreshToken"]);
    if (typeof body.refreshToken === "string") await revokeRefreshTokenFamily(options.db, body.refreshToken, now());
    res.json({ data: { loggedOut: true } });
  }));

  router.post("/auth/password-reset/request", asyncRoute(async (req, res) => {
    if (!options.sendPasswordReset) throw new IdentityError("DELIVERY_UNAVAILABLE");
    const body = requestBody(req);
    only(body, ["email"]);
    const email = string(body, "email", 254).trim().toLowerCase();
    const account = await store.findByEmail(email);
    if (account?.passwordHash) {
      const token = issuePasswordResetToken(account.id, account.passwordHash, options.tokenSecret, now().getTime());
      try { await options.sendPasswordReset(email, token); } catch { /* Keep account existence private. */ }
    }
    res.json({ data: { requested: true } });
  }));

  router.post("/auth/password-reset/confirm", asyncRoute(async (req, res) => {
    const body = requestBody(req);
    only(body, ["token", "newPassword"]);
    await completePasswordReset(store, {
      token: string(body, "token"),
      newPassword: string(body, "newPassword", 1024),
      secret: options.tokenSecret,
      now: now().getTime(),
    });
    res.json({ data: { passwordReset: true } });
  }));

  router.get("/me", authenticated(options, async (_req, res, actor) => {
    const user = await options.db.user.findUnique({
      where: { id: actor.userId },
      select: { id: true, email: true, role: true, name: true, profileImageUrl: true, bio: true, termsVersion: true, termsAgreedAt: true, createdAt: true },
    });
    if (!user) throw new SessionError("ACCOUNT_INACTIVE");
    res.json({ data: user });
  }));

  router.patch("/me", authenticated(options, async (req, res, actor) => {
    const body = requestBody(req);
    only(body, ["name", "profileImageUrl", "bio"]);
    const data: { name?: string | null; profileImageUrl?: string | null; bio?: string | null } = {};
    for (const field of ["name", "profileImageUrl", "bio"] as const) {
      const value = optionalNullableString(body, field, field === "bio" ? 2000 : field === "profileImageUrl" ? 2048 : 100);
      if (value !== undefined) data[field] = value;
    }
    if (!Object.keys(data).length) throw new ApiError("INVALID_REQUEST", 400);
    if (data.profileImageUrl && !/^https:\/\//i.test(data.profileImageUrl)) throw new IdentityError("INVALID_PROFILE_IMAGE_URL");
    const user = await options.db.user.update({
      where: { id: actor.userId },
      data,
      select: { id: true, email: true, role: true, name: true, profileImageUrl: true, bio: true, termsVersion: true, termsAgreedAt: true, createdAt: true },
    });
    res.json({ data: user });
  }));

  router.delete("/me", authenticated(options, async (_req, res, actor) => {
    const withdrawnAt = now();
    await withdrawAccount(createPrismaWithdrawalStore(options.db), actor.userId, withdrawnAt);
    res.json({ data: { withdrawnAt: withdrawnAt.toISOString() } });
  }));

  router.post("/me/password/change", authenticated(options, async (req, res, actor) => {
    const body = requestBody(req);
    only(body, ["currentPassword", "newPassword"]);
    const currentPassword = body.currentPassword === undefined ? undefined : string(body, "currentPassword", 1024);
    await setPassword(store, actor.userId, currentPassword, string(body, "newPassword", 1024));
    res.json({ data: { passwordChanged: true } });
  }));

  router.post("/me/email/change-request", authenticated(options, async (req, res, actor) => {
    if (!options.sendEmailChange) throw new IdentityError("DELIVERY_UNAVAILABLE");
    const body = requestBody(req);
    only(body, ["email"]);
    await requestEmailChange(store, actor.userId, string(body, "email", 254), options.tokenSecret, now().getTime() + 30 * 60 * 1000, options.sendEmailChange);
    res.json({ data: { requested: true } });
  }));

  router.post("/me/email/change-confirm", authenticated(options, async (req, res) => {
    const body = requestBody(req);
    only(body, ["token"]);
    await completeEmailChange(store, string(body, "token"), options.tokenSecret, now().getTime());
    res.json({ data: { emailChanged: true } });
  }));

  router.post("/me/google/disconnect", authenticated(options, async (req, res, actor) => {
    const body = requestBody(req);
    only(body, ["password"]);
    await disconnectGoogle(store, actor.userId, string(body, "password", 1024));
    res.json({ data: { googleDisconnected: true } });
  }));

  mountProfileApi(router, options.db, options.profile ?? {}, now, handler => authenticated(options, handler));
  mountPricingApi(router, options.db, now, handler => authenticated(options, handler));
  mountProjectApi(
    router,
    options.db,
    now,
    options.projectDisclosureConsentVersion ?? (() => null),
    handler => authenticated(options, handler),
  );

  app.use("/api/v1", router);

  const extraAuth = requireActorMiddleware(options);
  for (const extra of options.routers ?? []) {
    app.use("/api/v1", extraAuth, extra);
  }

  app.get("/health", (_req, res) => {
    res.json({ data: { status: "ok" } });
  });

  app.use((_req, res) => {
    const requestId = String(res.locals.requestId);
    res.status(404).json(errorResponse("NOT_FOUND", "경로를 찾을 수 없습니다.", requestId));
  });
  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    const result = statusFor(error);
    res.status(result.status).json(errorResponse(result.code, result.message, String(res.locals.requestId)));
  };
  app.use(errorHandler);
  return app;
}
