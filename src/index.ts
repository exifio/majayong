import { createServer } from "node:http";
import { PrismaClient } from "@prisma/client";
import { createAppHandler, type IntegrationPorts } from "./composition.ts";
import type { HttpActor } from "./app.ts";
import { createInMemoryFileRepository } from "./modules/files/index.ts";

const prisma = new PrismaClient();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`MISSING_ENV:${name}`);
  return value;
}

function createMockPorts(): IntegrationPorts {
  // staging/dev 전용. 실제 A/B 연동 전까지 INTEGRATION_MOCK_PORTS=1로만 켠다.
  return {
    marketplace: {
      async autoRejectCompetingApplications() {
        return { rejectedCount: 0 };
      },
    },
    notifications: {
      async createOnce() {
        return { created: false };
      },
    },
    profileReview: {
      async updateProfileReviewStats() {
        return { success: true };
      },
    },
    storage: {
      async createUploadUrl(bucket, objectKey, expiresInSec) {
        return { uploadUrl: `mock://${bucket}/${objectKey}`, expiresInSec };
      },
      async createDownloadUrl(bucket, objectKey, expiresInSec) {
        return { downloadUrl: `mock://${bucket}/${objectKey}`, expiresInSec };
      },
    },
    catalogAdmin: {
      async executeBlockAction() {
        throw Object.assign(new Error("CATALOG_PORT_UNAVAILABLE"), { status: 503 });
      },
    },
  };
}

async function main() {
  const ports = process.env.INTEGRATION_MOCK_PORTS === "1" ? createMockPorts() : null;
  if (!ports) {
    throw new Error("INTEGRATION_PORTS_REQUIRED: A/B 어댑터를 연결하거나 INTEGRATION_MOCK_PORTS=1로 개발 모드를 켠다.");
  }

  const authenticate = async (req: import("node:http").IncomingMessage): Promise<HttpActor | null> => {
    // 실제 토큰 검증은 A/B 인증 모듈 연결 시 교체한다. 기본은 fail-closed.
    if (process.env.ALLOW_DEV_AUTH !== "1") return null;
    const userId = req.headers["x-user-id"];
    const role = req.headers["x-role"];
    if (typeof userId !== "string" || typeof role !== "string") return null;
    return { userId, role };
  };

  const handler = createAppHandler(
    {
      prisma,
      webhookSecret: requireEnv("TOSS_WEBHOOK_SECRET"),
      bucket: process.env.SUPABASE_STORAGE_BUCKET ?? "private-assets",
      fileRepository: createInMemoryFileRepository(),
      ports,
    },
    authenticate,
  );

  const port = Number(process.env.PORT ?? 3000);
  const server = createServer((req, res) => {
    void handler(req, res);
  });
  server.listen(port, () => {
    console.log(`majayong API listening on :${port}`);
  });
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
