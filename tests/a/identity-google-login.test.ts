import { describe, expect, it, jest } from "@jest/globals";
import { Role } from "@prisma/client";
import { GoogleIdentityStore, authenticateWithGoogle } from "../../src/modules/identity/auth.ts";

const now = new Date("2026-11-03T00:00:00.000Z");
const account = {
  id: "user-1",
  email: "person@example.com",
  role: Role.SUPPLIER,
  passwordHash: null,
  termsVersion: "v0.7",
  termsAgreedAt: now,
  suspendedAt: null,
  withdrawnAt: null,
};

function makeGoogleStore(existingByEmail = null as typeof account | null) {
  const store: GoogleIdentityStore = {
    findByEmail: jest.fn(async () => existingByEmail),
    createUser: jest.fn(async () => account),
    findByGoogleSubject: jest.fn(async () => null),
    linkGoogle: jest.fn(async () => account),
    createGoogleUser: jest.fn(async () => account),
  };
  return store;
}

describe("Google identity login", () => {
  it("creates a first account with the selected role and terms", async () => {
    const store = makeGoogleStore();
    await authenticateWithGoogle(store, {
      subject: "google-subject",
      email: "person@example.com",
      emailVerified: true,
      role: Role.SUPPLIER,
      termsVersion: "v0.7",
      now,
    });
    expect(store.createGoogleUser).toHaveBeenCalledWith({
      email: "person@example.com",
      subject: "google-subject",
      role: Role.SUPPLIER,
      termsVersion: "v0.7",
      termsAgreedAt: now,
    });
  });

  it("links an existing email without changing its fixed role", async () => {
    const store = makeGoogleStore(account);
    await expect(authenticateWithGoogle(store, {
      subject: "google-subject",
      email: "person@example.com",
      emailVerified: true,
      role: Role.SUPPLIER,
      now,
    })).resolves.toEqual({ id: account.id, email: account.email, role: Role.SUPPLIER });
    expect(store.linkGoogle).toHaveBeenCalledWith(account.id, "google-subject");
    expect(store.createGoogleUser).not.toHaveBeenCalled();
  });

  it("rejects an existing email requested under a different role", async () => {
    await expect(authenticateWithGoogle(makeGoogleStore(account), {
      subject: "google-subject",
      email: "person@example.com",
      emailVerified: true,
      role: Role.CLIENT,
      now,
    })).rejects.toMatchObject({ code: "ROLE_MISMATCH" });
  });
});
