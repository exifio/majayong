import { describe, expect, it, jest } from "@jest/globals";
import { Role } from "@prisma/client";
import {
  EmailChangeStore,
  completeEmailChange,
  requestEmailChange,
} from "../../src/modules/identity/auth.ts";

describe("verified email change", () => {
  it("updates only after the signed link is used and cannot reuse it", async () => {
    const now = 1_800_000_000_000;
    const secret = "a-test-secret-that-is-at-least-32-characters";
    let email = "person@example.com";
    let deliveredToken = "";
    const account = () => ({
      id: "user-1", email, role: Role.CLIENT, passwordHash: null,
      termsVersion: "v0.7", termsAgreedAt: new Date(now), suspendedAt: null, withdrawnAt: null,
    });
    const store: EmailChangeStore = {
      findByEmail: jest.fn(async requested => requested === email ? account() : null),
      createUser: jest.fn(async () => { throw new Error("unused"); }),
      findById: jest.fn(async () => account()),
      updateEmailIfCurrent: jest.fn(async (_id: string, current: string, next: string) => {
        if (email !== current) return false;
        email = next;
        return true;
      }),
    };

    await requestEmailChange(store, "user-1", "new@example.com", secret, now + 3_600_000, async (_email, token) => {
      deliveredToken = token;
    });
    expect(email).toBe("person@example.com");
    await completeEmailChange(store, deliveredToken, secret, now + 1_000);
    expect(email).toBe("new@example.com");
    await expect(completeEmailChange(store, deliveredToken, secret, now + 2_000))
      .rejects.toMatchObject({ code: "EMAIL_TOKEN_INVALID" });
  });
});
