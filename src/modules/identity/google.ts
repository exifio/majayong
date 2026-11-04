export type GoogleIdentity = {
  subject: string;
  email: string;
  emailVerified: true;
  name?: string;
};

export type GoogleOAuthConfig = { clientId: string; clientSecret: string; redirectUri: string };

export class GoogleOAuthError extends Error {
  constructor(readonly code: string) { super(code); }
}

export async function exchangeGoogleCode(
  code: string,
  config: GoogleOAuthConfig,
  fetcher: typeof fetch = fetch,
): Promise<GoogleIdentity> {
  if (!code || !config.clientId || !config.clientSecret || !config.redirectUri) {
    throw new GoogleOAuthError("GOOGLE_CONFIG_OR_CODE_INVALID");
  }

  let accessToken: string;
  try {
    const response = await fetcher("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: "authorization_code",
      }),
      cache: "no-store",
    });
    const body: unknown = await response.json();
    if (!response.ok || !isRecord(body) || typeof body.access_token !== "string" || !body.access_token) {
      throw new Error();
    }
    accessToken = body.access_token;
  } catch {
    throw new GoogleOAuthError("GOOGLE_EXCHANGE_FAILED");
  }

  try {
    const response = await fetcher("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    const body: unknown = await response.json();
    if (!response.ok || !isRecord(body) || typeof body.sub !== "string" || typeof body.email !== "string") {
      throw new Error();
    }
    if (body.email_verified !== true) throw new GoogleOAuthError("GOOGLE_EMAIL_UNVERIFIED");
    return {
      subject: body.sub,
      email: body.email,
      emailVerified: true,
      ...(typeof body.name === "string" ? { name: body.name } : {}),
    };
  } catch (error) {
    if (error instanceof GoogleOAuthError) throw error;
    throw new GoogleOAuthError("GOOGLE_PROFILE_FAILED");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
