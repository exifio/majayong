import { describe, expect, it, jest } from "@jest/globals";
import { AuthProvider, Role } from "@prisma/client";
import { PasswordResetStore, hashPassword, setPassword } from "../../src/modules/identity/auth.ts";

describe("account password change", () => {
  it("lets an authenticated Google-only account create a password", async () => {
    let currentHash: string | null = null;
    const store: PasswordResetStore = {
      findByEmail: jest.fn(async () => null),
      createUser: jest.fn(async () => { throw new Error("unused"); }),
      findById: jest.fn(async () => ({
        id: "user-1", email: "person@example.com", role: Role.CLIENT, passwordHash: currentHash,
        termsVersion: "v0.7", termsAgreedAt: new Date(), suspendedAt: null, withdrawnAt: null,
        authProvider: AuthProvider.GOOGLE, providerUserId: "google-subject",
      })),
      updatePasswordHashIfCurrent: jest.fn(async (_id: string, expected: string | null, next: string) => {
        if (currentHash !== expected) return false;
        currentHash = next;
        return true;
      }),
    };

    await expect(setPassword(store, "user-1", undefined, "NewPass456")).resolves.toBeUndefined();
    expect(currentHash).not.toBeNull();
    await expect(setPassword(store, "user-1", undefined, "AnotherPass789"))
      .rejects.toMatchObject({ code: "CURRENT_PASSWORD_REQUIRED" });
  });
});
