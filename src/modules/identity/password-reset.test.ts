import { describe, expect, it, jest } from "@jest/globals";
import { Role } from "@prisma/client";
import {
  PasswordResetStore,
  completePasswordReset,
  hashPassword,
  issuePasswordResetToken,
} from "./auth.ts";

const secret = "a-test-secret-that-is-at-least-32-characters";
const now = 1_800_000_000_000;

describe("password reset completion", () => {
  it("changes the password once and rejects token reuse", async () => {
    let currentHash = await hashPassword("CurrentPass123");
    const originalHash = currentHash;
    const account = {
      id: "user-1", email: "person@example.com", role: Role.CLIENT,
      termsVersion: "v0.7", termsAgreedAt: new Date(now), suspendedAt: null, withdrawnAt: null,
    };
    const store: PasswordResetStore = {
      findByEmail: jest.fn(async () => null),
      createUser: jest.fn(async () => ({ ...account, passwordHash: currentHash })),
      findById: jest.fn(async () => ({ ...account, passwordHash: currentHash })),
      updatePasswordHashIfCurrent: jest.fn(async (_id: string, expected: string, next: string) => {
        if (currentHash !== expected) return false;
        currentHash = next;
        return true;
      }),
    };
    const token = issuePasswordResetToken(account.id, originalHash, secret, now);

    await expect(completePasswordReset(store, {
      token,
      newPassword: "NewPass456",
      secret,
      now: now + 1_000,
    })).resolves.toBeUndefined();
    await expect(completePasswordReset(store, {
      token,
      newPassword: "AnotherPass789",
      secret,
      now: now + 2_000,
    })).rejects.toMatchObject({ code: "RESET_TOKEN_INVALID" });
    expect(currentHash).not.toBe(originalHash);
  });
});
