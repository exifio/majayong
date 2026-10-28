import type { Server } from "node:http";
import { prisma } from "../src/db.ts";
import { isRecord } from "../src/shared/events.ts";

export function getServerPort(server: Server): number {
  const addr = server.address();
  if (addr === null || typeof addr === "string") {
    throw new Error("서버 포트를 확인할 수 없습니다.");
  }
  return addr.port;
}

export function assertRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error("객체 형식이어야 합니다.");
  }
  return value;
}

export async function resetDatabase() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "inspection_requests",
      "deliveries",
      "payment_installments",
      "payment_events",
      "escrow_deposits",
      "reviews",
      "contracts",
      "application_items",
      "applications",
      "bookmarks",
      "spec_items",
      "projects",
      "draft_blocks",
      "client_utterances",
      "drafts",
      "supplier_rates",
      "block_catalog",
      "notifications",
      "event_logs",
      "supplier_profiles",
      "client_profiles",
      "users"
    RESTART IDENTITY CASCADE
  `);
}
