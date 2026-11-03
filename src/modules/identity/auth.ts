import { AuthProvider, Prisma, PrismaClient, Role } from "@prisma/client";
import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

export type IdentityAccount = {
  id: string;
  email: string;
  role: Role;
  passwordHash: string | null;
  termsVersion: string | null;
  termsAgreedAt: Date | null;
  suspendedAt: Date | null;
  withdrawnAt: Date | null;
  authProvider?: AuthProvider | null;
  providerUserId?: string | null;
};

export type IdentityStore = {
  findByEmail(email: string): Promise<IdentityAccount | null>;
  createUser(input: {
    email: string;
    passwordHash: string;
    role: Role;
    termsVersion: string;
    termsAgreedAt: Date;
  }): Promise<IdentityAccount>;
};
export type GoogleIdentityStore = IdentityStore & {
  findByGoogleSubject(subject: string): Promise<IdentityAccount | null>;
  linkGoogle(userId: string, subject: string): Promise<IdentityAccount>;
  createGoogleUser(input: {
    email: string;
    subject: string;
    role: Role;
    termsVersion: string;
    termsAgreedAt: Date;
  }): Promise<IdentityAccount>;
};
export type AccountIdentityStore = IdentityStore & {
  findById(userId: string): Promise<IdentityAccount | null>;
};
export type PasswordResetStore = AccountIdentityStore & {
  updatePasswordHashIfCurrent(userId: string, currentHash: string | null, nextHash: string): Promise<boolean>;
};
export type GoogleDisconnectStore = AccountIdentityStore & {
  disconnectGoogleIfCurrent(userId: string, subject: string, passwordHash: string): Promise<boolean>;
};
export type WithdrawalStore = {
  // Contract state check and withdrawnAt update must share one database transaction.
  withdrawIfNoBlockingContracts(userId: string, withdrawnAt: Date): Promise<"WITHDRAWN" | "BLOCKED" | "NOT_FOUND" | "ALREADY_WITHDRAWN" | "CHANGED">;
};
export type EmailChangeStore = AccountIdentityStore & {
  updateEmailIfCurrent(userId: string, currentEmail: string, nextEmail: string): Promise<boolean>;
};

const SCRYPT_COST = 32_768;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;

function derivePasswordKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, SCRYPT_KEY_LENGTH, {
      N: SCRYPT_COST,
      r: SCRYPT_BLOCK_SIZE,
      p: SCRYPT_PARALLELIZATION,
      maxmem: SCRYPT_MAX_MEMORY,
    }, (error, key) => error ? reject(error) : resolve(key));
  });
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new Error("WEAK_PASSWORD");
  }
  const salt = randomBytes(16);
  const key = await derivePasswordKey(password, salt);
  return `scrypt$${SCRYPT_COST}$${SCRYPT_BLOCK_SIZE}$${SCRYPT_PARALLELIZATION}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, cost, blockSize, parallelization, saltText, keyText, extra] = encoded.split("$");
  if (
    algorithm !== "scrypt" || cost !== String(SCRYPT_COST) || blockSize !== String(SCRYPT_BLOCK_SIZE) ||
    parallelization !== String(SCRYPT_PARALLELIZATION) || !saltText || !keyText || extra !== undefined
  ) return false;
  try {
    const salt = Buffer.from(saltText, "base64url");
    const expected = Buffer.from(keyText, "base64url");
    if (salt.length !== 16 || expected.length !== SCRYPT_KEY_LENGTH) return false;
    const actual = await derivePasswordKey(password, salt);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export type AccessClaims = { userId: string; role: Role; expiresAt: number };
export type GoogleOnboardingIdentity = { subject: string; email: string };
type SignedPayload = Record<string, string | number>;

function tokenHmac(value: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(value).digest();
}

function validateTokenSecret(secret: string): void {
  if (Buffer.byteLength(secret) < 32) throw new Error("TOKEN_SECRET_TOO_SHORT");
}

function signToken(payload: SignedPayload, secret: string): string {
  validateTokenSecret(secret);
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${tokenHmac(body, secret).toString("base64url")}`;
}

function readSignedToken(token: string, secret: string): SignedPayload | null {
  try {
    validateTokenSecret(secret);
    const [body, signature, extra] = token.split(".");
    if (!body || !signature || extra !== undefined) return null;
    const received = Buffer.from(signature, "base64url");
    const expected = tokenHmac(body, secret);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
    const payload: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload as SignedPayload : null;
  } catch {
    return null;
  }
}

export function issueAccessToken(claims: AccessClaims, secret: string): string {
  if (!claims.userId || !Number.isSafeInteger(claims.expiresAt) || !Object.values(Role).includes(claims.role)) {
    throw new Error("INVALID_ACCESS_CLAIMS");
  }
  return signToken({ v: 1, typ: "access", sub: claims.userId, role: claims.role, exp: claims.expiresAt }, secret);
}

export function verifyAccessToken(token: string, secret: string, now: number): AccessClaims | null {
  const payload = readSignedToken(token, secret);
  if (
    payload?.v !== 1 || payload.typ !== "access" || typeof payload.sub !== "string" || !payload.sub ||
    !Object.values(Role).includes(payload.role as Role) || !Number.isSafeInteger(payload.exp) ||
    (payload.exp as number) <= now
  ) return null;
  return { userId: payload.sub, role: payload.role as Role, expiresAt: payload.exp as number };
}

export function issueGoogleOnboardingToken(
  identity: GoogleOnboardingIdentity,
  secret: string,
  now: number,
): string {
  if (!identity.subject || !Number.isSafeInteger(now)) throw new IdentityError("GOOGLE_IDENTITY_INVALID");
  return signToken({
    v: 1,
    typ: "google-onboarding",
    sub: identity.subject,
    email: normalizeEmail(identity.email),
    exp: now + 10 * 60 * 1000,
  }, secret);
}

export function verifyGoogleOnboardingToken(
  token: string,
  secret: string,
  now: number,
): GoogleOnboardingIdentity | null {
  const payload = readSignedToken(token, secret);
  if (
    payload?.v !== 1 || payload.typ !== "google-onboarding" || typeof payload.sub !== "string" || !payload.sub ||
    typeof payload.email !== "string" || !Number.isSafeInteger(payload.exp) || (payload.exp as number) <= now
  ) return null;
  try {
    return { subject: payload.sub, email: normalizeEmail(payload.email) };
  } catch {
    return null;
  }
}

export function issuePasswordResetToken(userId: string, passwordHash: string, secret: string, now: number): string {
  if (!userId || !passwordHash || !Number.isSafeInteger(now)) throw new Error("INVALID_RESET_TOKEN_INPUT");
  const passwordFingerprint = tokenHmac(`password:${passwordHash}`, secret).toString("base64url");
  return signToken({ v: 1, typ: "password-reset", sub: userId, pwd: passwordFingerprint, exp: now + 30 * 60 * 1000 }, secret);
}

function issueEmailChangeToken(userId: string, currentEmail: string, nextEmail: string, secret: string, expiresAt: number): string {
  if (!userId || !Number.isSafeInteger(expiresAt)) throw new IdentityError("INVALID_EMAIL_TOKEN_INPUT");
  return signToken({
    v: 1,
    typ: "email-change",
    sub: userId,
    from: normalizeEmail(currentEmail),
    to: normalizeEmail(nextEmail),
    exp: expiresAt,
  }, secret);
}

export function verifyPasswordResetToken(
  token: string,
  userId: string,
  passwordHash: string,
  secret: string,
  now: number,
): boolean {
  const payload = readSignedToken(token, secret);
  if (
    !passwordHash || payload?.v !== 1 || payload.typ !== "password-reset" || payload.sub !== userId ||
    typeof payload.pwd !== "string" || !Number.isSafeInteger(payload.exp) || (payload.exp as number) <= now
  ) return false;
  const actual = tokenHmac(`password:${passwordHash}`, secret);
  const expected = Buffer.from(payload.pwd, "base64url");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function passwordResetUserId(token: string, secret: string, now: number): string | null {
  const payload = readSignedToken(token, secret);
  return payload?.v === 1 && payload.typ === "password-reset" && typeof payload.sub === "string" &&
    Number.isSafeInteger(payload.exp) && (payload.exp as number) > now ? payload.sub : null;
}

export async function requestEmailChange(
  store: EmailChangeStore,
  userId: string,
  requestedEmail: string,
  secret: string,
  expiresAt: number,
  send: (email: string, token: string) => Promise<void>,
): Promise<void> {
  const account = await store.findById(userId);
  if (!account) throw new IdentityError("ACCOUNT_NOT_FOUND");
  if (account.suspendedAt || account.withdrawnAt) throw new IdentityError("ACCOUNT_INACTIVE");
  const nextEmail = normalizeEmail(requestedEmail);
  if (normalizeEmail(account.email) === nextEmail) throw new IdentityError("EMAIL_UNCHANGED");
  if (await store.findByEmail(nextEmail)) throw new IdentityError("EMAIL_ALREADY_REGISTERED");
  await send(nextEmail, issueEmailChangeToken(account.id, account.email, nextEmail, secret, expiresAt));
}

export async function completeEmailChange(
  store: EmailChangeStore,
  token: string,
  secret: string,
  now: number,
): Promise<void> {
  const payload = readSignedToken(token, secret);
  if (
    payload?.v !== 1 || payload.typ !== "email-change" || typeof payload.sub !== "string" ||
    typeof payload.from !== "string" || typeof payload.to !== "string" || !Number.isSafeInteger(payload.exp) ||
    (payload.exp as number) <= now
  ) throw new IdentityError("EMAIL_TOKEN_INVALID");
  const account = await store.findById(payload.sub);
  if (!account || normalizeEmail(account.email) !== payload.from) throw new IdentityError("EMAIL_TOKEN_INVALID");
  if (await store.findByEmail(payload.to)) throw new IdentityError("EMAIL_ALREADY_REGISTERED");
  try {
    if (!await store.updateEmailIfCurrent(account.id, account.email, payload.to)) {
      throw new IdentityError("EMAIL_TOKEN_INVALID");
    }
  } catch (error) {
    if (isUniqueViolation(error)) throw new IdentityError("EMAIL_ALREADY_REGISTERED");
    throw error;
  }
}

export async function authenticateWithGoogle(_store: GoogleIdentityStore, _input: {
  subject: string;
  email: string;
  emailVerified: true;
  role?: Role;
  termsVersion?: string;
  now: Date;
}): Promise<Pick<IdentityAccount, "id" | "email" | "role">> {
  if (_input.emailVerified !== true || !_input.subject) throw new IdentityError("GOOGLE_EMAIL_UNVERIFIED");
  const email = normalizeEmail(_input.email);
  const bySubject = await _store.findByGoogleSubject(_input.subject);
  if (bySubject) {
    if (bySubject.suspendedAt || bySubject.withdrawnAt) throw new IdentityError("ACCOUNT_INACTIVE");
    return publicIdentity(bySubject);
  }

  const existing = await _store.findByEmail(email);
  if (existing) {
    if (_input.role !== undefined && _input.role !== existing.role) throw identityErrorForExisting(existing, _input.role);
    if (existing.suspendedAt || existing.withdrawnAt) throw new IdentityError("ACCOUNT_INACTIVE");
    try {
      return publicIdentity(await _store.linkGoogle(existing.id, _input.subject));
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const racedAccount = await _store.findByGoogleSubject(_input.subject);
      if (racedAccount && normalizeEmail(racedAccount.email) === email) return publicIdentity(racedAccount);
      throw new IdentityError("GOOGLE_ACCOUNT_CONFLICT");
    }
  }

  if (_input.role !== Role.CLIENT && _input.role !== Role.SUPPLIER) throw new IdentityError("ROLE_REQUIRED");
  if (!_input.termsVersion?.trim() || Number.isNaN(_input.now.getTime())) throw new IdentityError("TERMS_REQUIRED");
  try {
    return publicIdentity(await _store.createGoogleUser({
      email,
      subject: _input.subject,
      role: _input.role,
      termsVersion: _input.termsVersion,
      termsAgreedAt: _input.now,
    }));
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const racedSubject = await _store.findByGoogleSubject(_input.subject);
    if (racedSubject && normalizeEmail(racedSubject.email) === email) return publicIdentity(racedSubject);
    const racedEmail = await _store.findByEmail(email);
    if (racedEmail) {
      if (racedEmail.role !== _input.role) throw identityErrorForExisting(racedEmail, _input.role);
      return publicIdentity(await _store.linkGoogle(racedEmail.id, _input.subject));
    }
    throw new IdentityError("GOOGLE_ACCOUNT_CONFLICT");
  }
}

export async function completePasswordReset(_store: PasswordResetStore, _input: {
  token: string;
  newPassword: string;
  secret: string;
  now: number;
}): Promise<void> {
  const userId = passwordResetUserId(_input.token, _input.secret, _input.now);
  if (!userId) throw new IdentityError("RESET_TOKEN_INVALID");
  const account = await _store.findById(userId);
  if (!account?.passwordHash || !verifyPasswordResetToken(
    _input.token, account.id, account.passwordHash, _input.secret, _input.now,
  )) throw new IdentityError("RESET_TOKEN_INVALID");
  const nextHash = await hashPassword(_input.newPassword);
  if (!await _store.updatePasswordHashIfCurrent(account.id, account.passwordHash, nextHash)) {
    throw new IdentityError("RESET_TOKEN_INVALID");
  }
}

export async function disconnectGoogle(_store: GoogleDisconnectStore, _userId: string, _password: string): Promise<void> {
  const account = await _store.findById(_userId);
  if (!account) throw new IdentityError("ACCOUNT_NOT_FOUND");
  if (account.suspendedAt || account.withdrawnAt) throw new IdentityError("ACCOUNT_INACTIVE");
  if (account.authProvider !== AuthProvider.GOOGLE || !account.providerUserId) {
    throw new IdentityError("GOOGLE_NOT_CONNECTED");
  }
  if (!account.passwordHash) throw new IdentityError("PASSWORD_REQUIRED");
  if (!await verifyPassword(_password, account.passwordHash)) throw new IdentityError("INVALID_CREDENTIALS");
  if (!await _store.disconnectGoogleIfCurrent(_userId, account.providerUserId, account.passwordHash)) {
    throw new IdentityError("ACCOUNT_CHANGED");
  }
}

export async function withdrawAccount(store: WithdrawalStore, userId: string, now: Date): Promise<void> {
  if (Number.isNaN(now.getTime())) throw new IdentityError("INVALID_TIME");
  const result = await store.withdrawIfNoBlockingContracts(userId, now);
  if (result === "BLOCKED") throw new IdentityError("ACTIVE_CONTRACTS_EXIST");
  if (result === "NOT_FOUND") throw new IdentityError("ACCOUNT_NOT_FOUND");
  if (result === "ALREADY_WITHDRAWN") throw new IdentityError("ACCOUNT_INACTIVE");
  if (result === "CHANGED") throw new IdentityError("ACCOUNT_CHANGED");
}

export async function setPassword(
  store: PasswordResetStore,
  userId: string,
  currentPassword: string | undefined,
  nextPassword: string,
): Promise<void> {
  const account = await store.findById(userId);
  if (!account) throw new IdentityError("ACCOUNT_NOT_FOUND");
  if (account.suspendedAt || account.withdrawnAt) throw new IdentityError("ACCOUNT_INACTIVE");
  if (account.passwordHash) {
    if (!currentPassword) throw new IdentityError("CURRENT_PASSWORD_REQUIRED");
    if (!await verifyPassword(currentPassword, account.passwordHash)) throw new IdentityError("INVALID_CREDENTIALS");
  } else if (account.authProvider !== AuthProvider.GOOGLE) {
    throw new IdentityError("ACCOUNT_UNAVAILABLE");
  }
  const nextHash = await hashPassword(nextPassword);
  if (!await store.updatePasswordHashIfCurrent(userId, account.passwordHash, nextHash)) {
    throw new IdentityError("ACCOUNT_CHANGED");
  }
}

export class IdentityError extends Error {
  constructor(readonly code: string) { super(code); }
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(normalized)) {
    throw new IdentityError("INVALID_EMAIL");
  }
  return normalized;
}

function identityErrorForExisting(account: IdentityAccount, requestedRole: Role): IdentityError {
  return new IdentityError(account.role === requestedRole ? "EMAIL_ALREADY_REGISTERED" : "ROLE_MISMATCH");
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function publicIdentity(account: IdentityAccount): Pick<IdentityAccount, "id" | "email" | "role"> {
  return { id: account.id, email: account.email, role: account.role };
}

export async function registerWithEmail(store: IdentityStore, input: {
  email: string;
  password: string;
  role: Role;
  termsVersion: string;
  now: Date;
}): Promise<Pick<IdentityAccount, "id" | "email" | "role">> {
  const email = normalizeEmail(input.email);
  if (input.role !== Role.CLIENT && input.role !== Role.SUPPLIER) throw new IdentityError("INVALID_ROLE");
  if (!input.termsVersion.trim() || Number.isNaN(input.now.getTime())) throw new IdentityError("TERMS_REQUIRED");

  const existing = await store.findByEmail(email);
  if (existing) throw identityErrorForExisting(existing, input.role);

  const passwordHash = await hashPassword(input.password);
  try {
    return publicIdentity(await store.createUser({
      email,
      passwordHash,
      role: input.role,
      termsVersion: input.termsVersion,
      termsAgreedAt: input.now,
    }));
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const racedAccount = await store.findByEmail(email);
    if (racedAccount) throw identityErrorForExisting(racedAccount, input.role);
    throw error;
  }
}

export async function authenticateWithEmail(store: IdentityStore, input: {
  email: string;
  password: string;
}): Promise<Pick<IdentityAccount, "id" | "email" | "role">> {
  let email: string;
  try { email = normalizeEmail(input.email); } catch { throw new IdentityError("INVALID_CREDENTIALS"); }
  const account = await store.findByEmail(email);
  if (!account?.passwordHash || !await verifyPassword(input.password, account.passwordHash)) {
    throw new IdentityError("INVALID_CREDENTIALS");
  }
  if (account.suspendedAt || account.withdrawnAt) throw new IdentityError("ACCOUNT_INACTIVE");
  return publicIdentity(account);
}

const identitySelect = {
  id: true,
  email: true,
  role: true,
  passwordHash: true,
  termsVersion: true,
  termsAgreedAt: true,
  suspendedAt: true,
  withdrawnAt: true,
  authProvider: true,
  providerUserId: true,
} satisfies Prisma.UserSelect;

export function createPrismaIdentityStore(db: Pick<PrismaClient, "user">): GoogleIdentityStore & PasswordResetStore & GoogleDisconnectStore & EmailChangeStore {
  return {
    findByEmail: email => db.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: identitySelect,
    }),
    createUser: input => db.user.create({ data: input, select: identitySelect }),
findById: userId => db.user.findUnique({ where: { id: userId }, select: identitySelect }),
findByGoogleSubject: subject => db.user.findUnique({
  where: { authProvider_providerUserId: { authProvider: AuthProvider.GOOGLE, providerUserId: subject } },
  select: identitySelect,
}),
linkGoogle: async (userId, subject) => {
  const updated = await db.user.updateMany({
    where: {
      id: userId,
      OR: [
        { authProvider: null, providerUserId: null },
        { authProvider: AuthProvider.GOOGLE, providerUserId: subject },
      ],
    },
    data: { authProvider: AuthProvider.GOOGLE, providerUserId: subject },
  });
  if (updated.count !== 1) throw new IdentityError("GOOGLE_ACCOUNT_CONFLICT");
  const account = await db.user.findUnique({ where: { id: userId }, select: identitySelect });
  if (!account) throw new IdentityError("ACCOUNT_NOT_FOUND");
  return account;
},
createGoogleUser: input => db.user.create({
  data: {
    email: input.email,
    authProvider: AuthProvider.GOOGLE,
    providerUserId: input.subject,
    role: input.role,
    termsVersion: input.termsVersion,
    termsAgreedAt: input.termsAgreedAt,
  },
  select: identitySelect,
}),
updatePasswordHashIfCurrent: async (userId, currentHash, nextHash) => {
  const result = await db.user.updateMany({
    where: { id: userId, passwordHash: currentHash },
    data: { passwordHash: nextHash },
  });
  return result.count === 1;
},
  disconnectGoogleIfCurrent: async (userId, subject, passwordHash) => {
    const result = await db.user.updateMany({
      where: { id: userId, authProvider: AuthProvider.GOOGLE, providerUserId: subject, passwordHash },
      data: { authProvider: null, providerUserId: null },
    });
    return result.count === 1;
  },
  updateEmailIfCurrent: async (userId, currentEmail, nextEmail) => {
    const result = await db.user.updateMany({
      where: { id: userId, email: currentEmail },
      data: { email: nextEmail },
    });
    return result.count === 1;
  },
  };
}
