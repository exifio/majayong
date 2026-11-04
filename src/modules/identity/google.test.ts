import { describe, expect, it, jest } from "@jest/globals";
import { exchangeGoogleCode } from "./google.ts";

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

describe("Google 인가 코드 교환", () => {
  it("검증된 이메일이 확인된 뒤에만 제공자 subject를 반환한다", async () => {
    const fetcher = fetchReplies(true);
    await expect(exchangeGoogleCode("authorization-code", config, fetcher)).resolves.toEqual({
      subject: "google-user-1",
      email: "person@example.com",
      emailVerified: true,
      name: "Person",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("검증되지 않은 Google 이메일은 거부한다", async () => {
    await expect(exchangeGoogleCode("authorization-code", config, fetchReplies(false)))
      .rejects.toMatchObject({ code: "GOOGLE_EMAIL_UNVERIFIED" });
  });
});
