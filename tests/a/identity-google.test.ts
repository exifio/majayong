import { describe, expect, it, jest } from "@jest/globals";
import { exchangeGoogleCode } from "../../src/modules/identity/google.ts";

const config = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  redirectUri: "https://app.example.invalid/oauth/google/callback",
};

function fetchReplies(emailVerified: boolean) {
  const fetcher = jest.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "provider-access-token" }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      sub: "google-user-1",
      email: "person@example.com",
      email_verified: emailVerified,
      name: "Person",
    }), { status: 200 }));
  return fetcher;
}

describe("Google authorization code exchange", () => {
  it("returns provider subject only after verified email is confirmed", async () => {
    const fetcher = fetchReplies(true);
    await expect(exchangeGoogleCode("authorization-code", config, fetcher)).resolves.toEqual({
      subject: "google-user-1",
      email: "person@example.com",
      emailVerified: true,
      name: "Person",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects unverified Google email", async () => {
    await expect(exchangeGoogleCode("authorization-code", config, fetchReplies(false)))
      .rejects.toMatchObject({ code: "GOOGLE_EMAIL_UNVERIFIED" });
  });
});
