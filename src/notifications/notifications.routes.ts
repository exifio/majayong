import type { PrismaClient } from "@prisma/client";
import { Router } from "express";
import { getRequiredAuth, requireAuth } from "../shared/auth.ts";

export function createNotificationsRouter(prismaClient: PrismaClient): Router {
  const router = Router();

  router.get("/api/notifications", requireAuth, async (req, res) => {
    const { userId } = getRequiredAuth(req);
    const items = await prismaClient.notification.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
      select: { id: true, type: true, targetId: true, targetUrl: true, isRead: true, createdAt: true },
    });
    res.json({ items });
  });

  router.get("/api/notifications/unread-count", requireAuth, async (req, res) => {
    const { userId } = getRequiredAuth(req);
    const unreadCount = await prismaClient.notification.count({ where: { userId, isRead: false } });
    res.json({ unreadCount });
  });

  router.post("/api/notifications/read-all", requireAuth, async (req, res) => {
    const { userId } = getRequiredAuth(req);
    const result = await prismaClient.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
    res.json({ updatedCount: result.count });
  });

  return router;
}
