import { afterAll, describe, expect, it } from "@jest/globals";
import { PrismaClient } from "@prisma/client";
import { assertTestDatabase } from "../../src/core/test-database.ts";

process.env.DATABASE_URL = assertTestDatabase(process.env.TEST_DATABASE_URL);

const prisma = new PrismaClient();

afterAll(async () => prisma.$disconnect());

describe("v0.7 PostgreSQL migration", () => {
  it("creates the 25 v0.7 tables, A-01 refresh sessions, and 33 enums", async () => {
    const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    `;
    const enums = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count
      FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typtype = 'e'
    `;

    expect(tables.map(({ tablename }) => tablename).sort()).toEqual([
      "application_items",
      "application_messages",
      "applications",
      "block_catalog",
      "bookmarks",
      "client_profiles",
      "client_utterances",
      "contract_items",
      "contracts",
      "deliveries",
      "draft_blocks",
      "drafts",
      "escrow_deposits",
      "event_logs",
      "inspection_requests",
      "notifications",
      "payment_events",
      "payment_installments",
      "projects",
      "refresh_sessions",
      "reports",
      "reviews",
      "spec_items",
      "supplier_profiles",
      "support_inquiries",
      "users",
    ]);
    expect(Number(enums[0]?.count)).toBe(33);
  });

  it("applies every required raw database constraint", async () => {
    const constraints = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT conname AS name FROM pg_constraint WHERE connamespace = 'public'::regnamespace
      UNION
      SELECT indexname AS name FROM pg_indexes WHERE schemaname = 'public'
    `;

    expect(constraints.map(({ name }) => name)).toEqual(expect.arrayContaining([
      "application_one_accepted",
      "application_one_active",
      "recruit_before_deadline",
      "dedupkey_required_for_callback",
      "deposit_one_open",
      "compensation_rate_floor",
      "interim_ratio_range",
      "block_not_merged_into_self",
      "review_rating_range",
      "report_one_open_per_reporter",
    ]));
  });
});
