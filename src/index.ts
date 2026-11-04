import { PrismaClient } from "@prisma/client";
import { createIntegrationPorts } from "./integration/external-ports.js";
import { createPrismaIntegrationDb, createPrismaPorts } from "./integration/prisma-wiring.js";
import { createApp } from "./app.js";
import { createBRouters } from "./server.js";

const databaseUrl = process.env.DATABASE_URL;
const tokenSecret = process.env.TOKEN_SECRET;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!tokenSecret || Buffer.byteLength(tokenSecret) < 32) throw new Error("TOKEN_SECRET must be at least 32 bytes");

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("PORT must be a valid TCP port");
const google = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI
  ? {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri: process.env.GOOGLE_REDIRECT_URI,
    }
  : undefined;

const db = new PrismaClient();
const now = () => new Date();
const integrationPorts = createIntegrationPorts(createPrismaIntegrationDb(db), { now });
const bRouters = createBRouters(createPrismaPorts(db), integrationPorts).map(
  (mounted) => mounted.router,
);

const app = createApp({
  db,
  tokenSecret,
  google,
  projectDisclosureConsentVersion: () => process.env.PROJECT_DISCLOSURE_CONSENT_VERSION ?? null,
  profile: {
    encryptionKey: process.env.PROFILE_DATA_KEY,
    supplierNdaVersion: process.env.SUPPLIER_NDA_VERSION,
  },
  routers: bRouters,
});
const server = app.listen(port);

async function shutdown(): Promise<void> {
  server.close(async () => {
    await db.$disconnect();
    process.exitCode = 0;
  });
}

process.once("SIGINT", () => { void shutdown(); });
process.once("SIGTERM", () => { void shutdown(); });
