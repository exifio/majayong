import { describe, expect, it } from "@jest/globals";
import { Role } from "@prisma/client";
import {
  issueAccessToken,
  issueGoogleOnboardingToken,
  issuePasswordResetToken,
  verifyAccessToken,
  verifyGoogleOnboardingToken,
  verifyPasswordResetToken,
} from "../../src/modules/identity/auth.ts";

const secret = "a-test-secret-that-is-at-least-32-characters";

describe("identity signed tokens", () => {
  it("rejects expired and forged access tokens", () => {
    const now = 1_800_000_000_000;
    const token = issueAccessToken({ userId: "user-1", role: Role.CLIENT, expiresAt: now + 60_000 }, secret);

    expect(verifyAccessToken(token, secret, now)).toEqual({
      userId: "user-1",
      role: Role.CLIENT,
      expiresAt: now + 60_000,
    });
    expect(verifyAccessToken(token, secret, now + 60_000)).toBeNull();
    expect(verifyAccessToken(`${token.slice(0, -1)}x`, secret, now)).toBeNull();
  });

  it("allows password reset up to 30 minutes, then rejects expiry and reuse", () => {
    const now = 1_800_000_000_000;
    const oldHash = "scrypt$old-password-hash";
    const token = issuePasswordResetToken("user-1", oldHash, secret, now);

    expect(verifyPasswordResetToken(token, "user-1", oldHash, secret, now + 1_799_999)).toBe(true);
    expect(verifyPasswordResetToken(token, "user-1", oldHash, secret, now + 1_800_000)).toBe(false);
    expect(verifyPasswordResetToken(token, "user-1", "scrypt$new-password-hash", secret, now + 1_000)).toBe(false);
    expect(verifyPasswordResetToken(token, "user-2", oldHash, secret, now + 1_000)).toBe(false);
  });

  it("limits signed Google onboarding tokens to ten minutes", () => {
    const now = 1_800_000_000_000;
    const token = issueGoogleOnboardingToken({ subject: "google-subject", email: "Person@Example.com" }, secret, now);
    expect(verifyGoogleOnboardingToken(token, secret, now + 599_999)).toEqual({
      subject: "google-subject",
      email: "person@example.com",
    });
    expect(verifyGoogleOnboardingToken(token, secret, now + 600_000)).toBeNull();
    expect(verifyGoogleOnboardingToken(`${token.slice(0, -1)}x`, secret, now + 1)).toBeNull();
  });
});
