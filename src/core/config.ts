export type CoreConfig = {
  databaseUrl: string;
  tokenSecret: string;
  port: number;
};

const minimumTokenSecretBytes = 32;
const defaultPort = 3000;

export function loadCoreConfig(env: Record<string, string | undefined>): CoreConfig {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const tokenSecret = env.TOKEN_SECRET;
  if (!tokenSecret || Buffer.byteLength(tokenSecret) < minimumTokenSecretBytes) {
    throw new Error("TOKEN_SECRET must be at least 32 bytes");
  }

  const rawPort = env.PORT?.trim();
  const port = rawPort === undefined || rawPort === "" ? defaultPort : Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("PORT must be a valid TCP port");

  return { databaseUrl, tokenSecret, port };
}
