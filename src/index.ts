import { PrismaClient } from "@prisma/client";
import {
  createIntegrationPorts,
  createPublicProjectPorts,
  createReportAccountActionPort,
} from "./integration/external-ports.js";
import {
  createAProjectApplicationPort,
  createAProjectSearchPort,
  createAProjectViewPort,
  createProjectCandidatePort,
} from "./integration/a-ports.js";
import { createDraftCatalogAdapter } from "./integration/draft-catalog-adapter.js";
import { createCatalogAdminPort } from "./integration/catalog-admin-port.js";
import { createOpenAiCatalogBlockGenerator, createOpenAiCatalogFeatureExtractor } from "./modules/catalog/index.js";
import { createProjectSearchPort } from "./modules/market/project-search.js";
import type { ProjectPorts } from "./modules/project/ports.js";
import {
  createProjectCandidateDb,
  createAProjectDb,
  createPrismaIntegrationDb,
  createPrismaPorts,
} from "./integration/prisma-wiring.js";
import { createApp } from "./app.js";
import { createBRouters } from "./server.js";
import { createAppHandler } from "./composition.js";
import { createProfileRatingPort } from "./modules/profile/api.js";
import { requireActor } from "./modules/identity/session.js";
import { createMarketplaceAutoRejectPort } from "./modules/application/marketplace-port.js";
import {
  createApplicationTx,
  createPrismaApplicationReadPort,
  createPrismaApplicationUnitOfWork,
  type ApplicationDbClient,
} from "./modules/application/prisma-adapter.js";
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
const integrationDb = createPrismaIntegrationDb(db);
const publicPorts = createPublicProjectPorts(
  integrationDb,
  createProjectCandidatePort(createProjectCandidateDb(db)),
);
const integrationPorts = createIntegrationPorts(integrationDb, {
  ...publicPorts,
  reportAccounts: createReportAccountActionPort(integrationDb),
  now,
});
const prismaPorts = createPrismaPorts(db);
const applicationRead = createPrismaApplicationReadPort(prismaPorts.applicationRead);
const bRouters = createBRouters(prismaPorts, integrationPorts, applicationRead).map(
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
        // C 예치 완료가 넘긴 Prisma tx를 B ApplicationTx로 매핑해 같은 트랜잭션에 쓴다.
        (tx) => createApplicationTx(tx as ApplicationDbClient),
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
        ...createCatalogAdminPort(db),
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
  { deferUnmatched: true },
);

// A의 공개 프로젝트 라우트에 B 검색·열람·지원 어댑터를 주입한다.
// ponytail: 마감 알림(notification)은 DEADLINE_EXTENDED가 B 15종에 없어 D-10 정책 결정 전까지
// 미주입 → 연장 알림 경로는 알림 없이 동작하고, 정책 승인 후 이 객체에 추가한다.
const aProjectDb = createAProjectDb(db);
// 단일 경계 캐스트: A 서비스는 실제 Prisma tx를 넘기고, 어댑터는 테스트 가능한 구조 타입(AProjectDb)을 받는다.
const projectPorts: ProjectPorts = {
  supplierNdaVersion: process.env.SUPPLIER_NDA_VERSION,
  search: createAProjectSearchPort(
    createProjectSearchPort(createProjectCandidatePort(createProjectCandidateDb(db))),
  ),
  view: createAProjectViewPort(aProjectDb),
  application: createAProjectApplicationPort(aProjectDb) as unknown as ProjectPorts["application"],
};

const app = createApp({
  db,
  tokenSecret,
  google,
  projectDisclosureConsentVersion: () => process.env.PROJECT_DISCLOSURE_CONSENT_VERSION ?? null,
  project: projectPorts,
  draft: {
    catalog: createDraftCatalogAdapter(db, {
      extractor: createOpenAiCatalogFeatureExtractor(
        process.env.OPENAI_API_KEY,
        process.env.OPENAI_MODEL,
        process.env.OPENAI_USD_TO_KRW_RATE,
      ),
      generator: createOpenAiCatalogBlockGenerator(
        process.env.OPENAI_API_KEY,
        process.env.OPENAI_MODEL,
        process.env.OPENAI_USD_TO_KRW_RATE,
      ),
    }),
  },
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
