import { PrismaClient } from "@prisma/client";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { RequestHandler } from "express";
import { renderCatalog } from "./lib/catalog.js";
import { renderScreen, WEB_ROOT } from "./lib/page.js";
import { screens } from "./screens/index.js";
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
import { createSupabaseStorageAdapter } from "./integration/supabase-storage.js";
import { createTossSandboxVerifier } from "./integration/toss-verifier.js";
import { createOpenAiCatalogBlockGenerator, createOpenAiCatalogFeatureExtractor } from "./modules/catalog/index.js";
import { createProjectSearchPort } from "./modules/market/project-search.js";
import { runProjectDeadlineBatch } from "./modules/project/service.js";
import { breakExpiredContracts } from "./modules/contract/lifecycle.js";
import { createPrismaContractUnitOfWork } from "./modules/contract/prisma-adapter.js";
import type { ProjectPorts } from "./modules/project/ports.js";
import {
  createProjectCandidateDb,
  createAProjectDb,
  createPrismaIntegrationDb,
  createPrismaPorts,
} from "./integration/prisma-wiring.js";
import { createApp } from "./app.js";
import { createBRouters } from "./server.js";
import { createIntegrationServices } from "./composition.js";
import { createHttpHandler } from "./c-app.js";
import { startDueJobScheduler } from "./jobs/index.js";
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
import { createPrismaNotificationTx, type NotificationDbClient } from "./modules/notification/prisma-adapter.js";
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
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const storageBucket = process.env.SUPABASE_STORAGE_BUCKET;
const storageAdapter =
  supabaseUrl && supabaseKey && storageBucket
    ? createSupabaseStorageAdapter({ url: supabaseUrl, serviceRoleKey: supabaseKey })
    : undefined;
const tossVerifier = process.env.TOSS_SECRET_KEY
  ? createTossSandboxVerifier({
      secretKey: process.env.TOSS_SECRET_KEY,
      baseUrl: process.env.TOSS_SANDBOX_BASE_URL,
    })
  : undefined;
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

// A의 공개 프로젝트 라우트에 B 검색·열람·지원 어댑터를 주입한다.
// D-10-R 승인(2026-11-04): 알림 15종 불변. 마감 연장(DEADLINE_EXTENDED)은 A EventLog에만
// 남기고 B 알림은 만들지 않는다. 따라서 projectPorts.notification을 주입하지 않는다.
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
const contractJobUow = createPrismaContractUnitOfWork(prismaPorts.contract, integrationPorts.depositAttempts);
const bRouters = createBRouters(prismaPorts, integrationPorts, applicationRead).map(
  (mounted) => mounted.router,
);

const pending = (name: string): never => {
  throw new HttpError(503, "INTEGRATION_PENDING", `${name} Port가 아직 연결되지 않았습니다.`);
};
const ratingPort = createProfileRatingPort(db);
const integrationConfig = {
  prisma: db,
  webhookSecret: process.env.TOSS_WEBHOOK_SECRET ?? "",
  ...(storageBucket === undefined ? {} : { bucket: storageBucket }),
  clock: { now },
  ports: {
    marketplace: createMarketplaceAutoRejectPort(
      createPrismaApplicationUnitOfWork(prismaPorts.application),
      // C 예치 완료가 넘긴 Prisma tx를 B ApplicationTx로 매핑해 같은 트랜잭션에 쓴다.
      (tx) => createApplicationTx(tx as ApplicationDbClient),
    ),
    notifications: createNotificationBridge(
      createPrismaNotificationTx(prismaPorts.notification),
      { now, notificationTxFor: (tx) => createPrismaNotificationTx(tx as NotificationDbClient) },
    ),
    profileReview: {
      async updateProfileReviewStats(input: { targetUserId: string }, tx: unknown) {
        await ratingPort.refresh(
          input.targetUserId,
          tx as import("@prisma/client").Prisma.TransactionClient | undefined,
        );
        return { success: true };
      },
    },
    storage: storageAdapter ?? {
      async createUploadUrl() { return pending("Storage"); },
      async createDownloadUrl() { return pending("Storage"); },
    },
    ...(tossVerifier === undefined ? {} : { tossVerifier }),
    projectDeadlines: (now: Date) => runProjectDeadlineBatch(db, projectPorts, now),
    contractBreaks: (now: Date) => breakExpiredContracts(contractJobUow, { now }),
    catalogAdmin: {
      ...createCatalogAdminPort(db),
    },
  },
};
const { services: cServices, runner: jobRunner } = createIntegrationServices(integrationConfig);
const cHandler = createHttpHandler(
  { services: cServices, authenticate: async (req) => {
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
  }, deferUnmatched: true },
);

const WEB_MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".pdf": "application/pdf",
};
const webScreens = new Map(screens.map((screen) => [screen.id === "Main" ? "/" : `/${screen.id}`, screen]));

const webHandler: RequestHandler = (request, response, next) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    next();
    return;
  }
  const url = new URL(request.originalUrl, "http://localhost");
  const pathname = decodeURIComponent(url.pathname).replace(/\/+$/, "") || "/";
  if (pathname.startsWith("/api/") || pathname === "/health") {
    next();
    return;
  }
  void (async () => {
    if (pathname.startsWith("/assets/") && !pathname.includes("..")) {
      const file = await readFile(new URL(`.${pathname}`, WEB_ROOT)).catch(() => null);
      if (!file) {
        response.status(404).type("text/plain").send("Not found");
        return;
      }
      response.setHeader("content-type", WEB_MIME[extname(pathname)] ?? "application/octet-stream");
      response.setHeader("cache-control", /\.(?:js|css)$/i.test(pathname) ? "no-cache" : "public, max-age=3600");
      response.send(file);
      return;
    }
    if (pathname === "/screens") {
      response.type("html").send(renderCatalog(screens));
      return;
    }
    const screen = webScreens.get(pathname);
    if (!screen) {
      response.status(404).type("html").send(renderCatalog(screens));
      return;
    }
    response.type("html").send(await renderScreen(screen, url.searchParams));
  })().catch(next);
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
  web: webHandler,
});
const server = createServer(app);
export default server;
if (!process.env.VERCEL) server.listen(port);

const stopScheduler =
  process.env.JOB_SCHEDULER_ENABLED === "true"
    ? startDueJobScheduler(jobRunner, {
        intervalMs: 60_000,
        onError: (err) => console.error("due job scheduler error", err),
      })
    : undefined;

async function shutdown(): Promise<void> {
  stopScheduler?.();
  server.close(async () => {
    await db.$disconnect();
    process.exitCode = 0;
  });
}

process.once("SIGINT", () => { void shutdown(); });
process.once("SIGTERM", () => { void shutdown(); });
