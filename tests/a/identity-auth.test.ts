import { describe, expect, it, jest } from "@jest/globals";
import { Role } from "@prisma/client";
import {
  IdentityError,
  IdentityStore,
  authenticateWithEmail,
  hashPassword,
  registerWithEmail,
} from "../../src/modules/identity/auth.ts";

function makeStore(existing: Awaited<ReturnType<IdentityStore["findByEmail"]>> = null) {
  const store: IdentityStore = {
    findByEmail: jest.fn(async () => existing),
    createUser: jest.fn(async (input: Parameters<IdentityStore["createUser"]>[0]) => ({
      id: "new-user",
      email: input.email,
      role: input.role,
      passwordHash: input.passwordHash,
      termsVersion: input.termsVersion,
      termsAgreedAt: input.termsAgreedAt,
      suspendedAt: null,
      withdrawnAt: null,
    })),
  };
  return store;
}

const input = {
  email: " Person@Example.com ",
  password: "LongPass123",
  role: Role.CLIENT,
  termsVersion: "v0.7",
  now: new Date("2026-11-03T00:00:00.000Z"),
};

describe("identity email authentication", () => {
  it("stores normalized email, fixed role, password hash, and terms consent", async () => {
    const store = makeStore();
    await expect(registerWithEmail(store, input)).resolves.toEqual({
      id: "new-user",
      email: "person@example.com",
      role: Role.CLIENT,
    });
    expect(store.createUser).toHaveBeenCalledWith(expect.objectContaining({
      email: "person@example.com",
      role: Role.CLIENT,
      termsVersion: "v0.7",
      termsAgreedAt: input.now,
    }));
    const created = jest.mocked(store.createUser).mock.calls[0]?.[0];
    expect(created?.passwordHash).not.toBe(input.password);
  });

  it("rejects duplicate emails with same or conflicting role", async () => {
    const account = {
      id: "existing-user",
      email: "person@example.com",
      role: Role.SUPPLIER,
      passwordHash: "stored-hash",
      termsVersion: "v0.7",
      termsAgreedAt: input.now,
      suspendedAt: null,
      withdrawnAt: null,
    };
    const store = makeStore(account);
    await expect(registerWithEmail(store, input)).rejects.toMatchObject({ code: "ROLE_MISMATCH" });
    await expect(registerWithEmail(store, { ...input, role: Role.SUPPLIER })).rejects.toMatchObject({
      code: "EMAIL_ALREADY_REGISTERED",
    });
    expect(store.createUser).not.toHaveBeenCalled();
  });

  it("rejects invalid credentials and inactive accounts", async () => {
    const passwordHash = await hashPassword(input.password);
    const store = makeStore({
      id: "existing-user",
      email: "person@example.com",
      role: Role.CLIENT,
      passwordHash,
      termsVersion: "v0.7",
      termsAgreedAt: input.now,
      suspendedAt: null,
      withdrawnAt: null,
    });
    await expect(authenticateWithEmail(store, { email: input.email, password: "WrongPass123" }))
      .rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await expect(authenticateWithEmail(makeStore({
      id: "withdrawn-user", email: "person@example.com", role: Role.CLIENT, passwordHash,
      termsVersion: "v0.7", termsAgreedAt: input.now, suspendedAt: null, withdrawnAt: input.now,
    }), { email: input.email, password: input.password })).rejects.toBeInstanceOf(IdentityError);
  });
});
