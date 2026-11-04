import { describe, expect, it, jest } from "@jest/globals";
import { AuthProvider, Role } from "@prisma/client";
import { GoogleDisconnectStore, disconnectGoogle } from "./auth.ts";

describe("Google account disconnect", () => {
  it("requires a password before disconnecting a Google-only account", async () => {
    const now = new Date("2026-11-03T00:00:00.000Z");
    const store: GoogleDisconnectStore = {
      findByEmail: jest.fn(async () => null),
      createUser: jest.fn(async () => { throw new Error("unused"); }),
      findById: jest.fn(async () => ({
        id: "user-1", email: "person@example.com", role: Role.CLIENT, passwordHash: null,
        termsVersion: "v0.7", termsAgreedAt: now, suspendedAt: null, withdrawnAt: null,
        authProvider: AuthProvider.GOOGLE, providerUserId: "google-subject",
      })),
      disconnectGoogleIfCurrent: jest.fn(async () => true),
    };

    await expect(disconnectGoogle(store, "user-1", "AnyPass123"))
      .rejects.toMatchObject({ code: "PASSWORD_REQUIRED" });
    expect(store.disconnectGoogleIfCurrent).not.toHaveBeenCalled();
  });
});
