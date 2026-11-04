import { PrismaClient } from "@prisma/client";
import { createIntegrationPorts } from "./integration/external-ports.js";
import { createPrismaIntegrationDb, createPrismaPorts } from "./integration/prisma-wiring.js";
import { createApp } from "./app.js";
import { createBRouters } from "./server.js";
import { createAppHandler } from "./composition.js";
import { createProfileRatingPort } from "./modules/profile/api.js";
import { requireActor } from "./modules/identity/session.js";
import { createMarketplaceAutoRejectPort } from "./modules/application/marketplace-port.js";
import { createPrismaApplicationUnitOfWork } from "./modules/application/prisma-adapter.js";
import { createNotificationBridge } from "./modules/notification/c-bridge.js";
import { createPrismaNotificationTx } from "./modules/notification/prisma-adapter.js";
import { HttpError } from "./http/envelope.js";

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
const prismaPorts = createPrismaPorts(db);
const bRouters = createBRouters(prismaPorts, integrationPorts).map(
  (mounted) => mounted.router,
);

const pending = (name: string): never => {
  throw new HttpError(503, "INTEGRATION_PENDING", `${name} Port가 아직 연결되지 않았습니다.`);
};
const ratingPort = createProfileRatingPort(db);
const cHandler = createAppHandler(
  {
    prisma: db,
    webhookSecret: process.env.TOSS_WEBHOOK_SECRET ?? "",
    clock: { now },
    ports: {
      marketplace: createMarketplaceAutoRejectPort(
        createPrismaApplicationUnitOfWork(prismaPorts.application),
      ),
      notifications: createNotificationBridge(
        createPrismaNotificationTx(prismaPorts.notification),
        { now },
      ),
      profileReview: {
        async updateProfileReviewStats(input) {
          await ratingPort.refresh(input.targetUserId);
          return { success: true };
        },
      },
      storage: {
        async createUploadUrl() { return pending("Storage"); },
        async createDownloadUrl() { return pending("Storage"); },
      },
      catalogAdmin: {
        async executeBlockAction() { return pending("CatalogAdmin"); },
      },
    },
  },
  async (req) => {
    const header = req.headers.authorization;
    const value = typeof header === "string" ? header : undefined;
    const match = /^Bearer ([^\s]+)$/.exec(value ?? "");
    if (!match) return null;
    try {
      const actor = await requireActor(db, match[1]!, tokenSecret, Date.now());
      return { userId: actor.userId, role: actor.role };
    } catch {
      return null;
    }
  },
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
  fallback: cHandler,
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
