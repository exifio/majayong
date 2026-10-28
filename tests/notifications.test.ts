import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import type { Server } from "node:http";
import { createApp } from "../src/app.ts";
import { prisma } from "../src/db.ts";
import { assertRecord, getServerPort, resetDatabase } from "./helpers.ts";
import { createProjectFixture } from "./project-fixtures.ts";

async function startServer(): Promise<{ server: Server; baseUrl: string }> {
  const server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  return { server, baseUrl: `http://127.0.0.1:${getServerPort(server)}` };
}

async function stopServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe("F-11 알림 목록·미확인 개수·모두 읽음", () => {
  beforeEach(async () => {
    await resetDatabase();
    process.env.ALLOW_HEADER_AUTH = "true";
  });

  afterAll(async () => {
    await resetDatabase();
    await prisma.$disconnect();
  });

  it("알림을 로그인 사용자에게만 보여주고 모두 읽음은 본인 미확인 항목만 변경한다", async () => {
    const owner = await createProjectFixture();
    const other = await createProjectFixture();
    await prisma.notification.createMany({
      data: [
        { userId: owner.clientId, type: "APPLICATION_RECEIVED", targetId: "app-1", targetUrl: "/client/applications/app-1" },
        { userId: owner.clientId, type: "PROJECT_CLOSED", targetId: "project-1", targetUrl: "/client/projects/project-1", isRead: true },
        { userId: other.clientId, type: "APPLICATION_RECEIVED", targetId: "app-2", targetUrl: "/client/applications/app-2" },
      ],
    });
    const { server, baseUrl } = await startServer();
    const headers = { "x-user-id": owner.clientId, "x-user-role": "CLIENT" };

    try {
      const listResponse = await fetch(`${baseUrl}/api/notifications`, { headers });
      expect(listResponse.status).toBe(200);
      const listBody = assertRecord(await listResponse.json());
      if (!Array.isArray(listBody.items)) throw new Error("알림 items는 배열이어야 합니다.");
      expect(listBody.items).toHaveLength(2);
      expect(JSON.stringify(listBody.items)).not.toContain("app-2");

      const countResponse = await fetch(`${baseUrl}/api/notifications/unread-count`, { headers });
      expect(assertRecord(await countResponse.json()).unreadCount).toBe(1);

      const readAllResponse = await fetch(`${baseUrl}/api/notifications/read-all`, {
        method: "POST",
        headers,
      });
      expect(readAllResponse.status).toBe(200);
      expect(assertRecord(await readAllResponse.json()).updatedCount).toBe(1);
      expect(await prisma.notification.count({ where: { userId: owner.clientId, isRead: false } })).toBe(0);
      expect(await prisma.notification.count({ where: { userId: other.clientId, isRead: false } })).toBe(1);
    } finally {
      await stopServer(server);
    }
  });
});
