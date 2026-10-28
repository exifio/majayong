import express, { type Express, type Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "./db.ts";
import { attachAuth, type AuthVerifier } from "./shared/auth.ts";
import { AppError, errorHandler } from "./shared/errors.ts";
import { createOpenApiRouter } from "./shared/openapi.ts";
import { createRatesRouter } from "./rates/rates.routes.ts";
import { createProjectsRouter } from "./projects/projects.routes.ts";
import { createNotificationsRouter } from "./notifications/notifications.routes.ts";
import { createApplicationsRouter } from "./applications/applications.routes.ts";

export interface CreateAppOptions {
  prismaClient?: PrismaClient;
  authVerifier?: AuthVerifier;
  extraRouters?: Router[];
}

export function createApp(options: CreateAppOptions = {}): Express {
  const prismaClient = options.prismaClient ?? defaultPrisma;
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use(attachAuth(options.authVerifier));

  app.get("/health", async (_req, res) => {
    await prismaClient.$queryRaw`SELECT 1`;
    res.json({ status: "ok" });
  });

  app.use(createOpenApiRouter());
  app.use(createRatesRouter(prismaClient));
  app.use(createProjectsRouter(prismaClient));
  app.use(createNotificationsRouter(prismaClient));
  app.use(createApplicationsRouter(prismaClient));

  for (const router of options.extraRouters ?? []) {
    app.use(router);
  }

  app.use((_req, _res, next) => {
    next(new AppError(404, "NOT_FOUND", "요청한 API 경로를 찾을 수 없습니다."));
  });

  app.use(errorHandler);
  return app;
}
