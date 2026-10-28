import { randomUUID } from "node:crypto";
import { prisma } from "../src/db.ts";

export interface ProjectFixtureOptions {
  title?: string;
  summary?: string;
  industryCode?: string;
  requiredSkills?: string[];
  hopeBudget?: number | null;
  status?: "SCHEDULED" | "RECRUITING" | "ACCEPTED" | "CONTRACTED" | "EXPIRED";
  deleted?: boolean;
  published?: boolean;
  recruitStartAt?: Date | null;
  deadline?: Date | null;
  itemStatuses?: Array<"INCLUDED" | "EXCLUDED" | "NEEDS_CONFIRMATION">;
}

export async function createProjectFixture(options: ProjectFixtureOptions = {}) {
  const suffix = randomUUID();
  const client = await prisma.user.create({
    data: {
      email: `client-${suffix}@test.local`,
      name: "의뢰인 이름",
      role: "CLIENT",
      clientProfile: {
        create: {
          businessName: "비공개 상호",
          phone: "010-1234-5678",
          region: "서울",
        },
      },
    },
  });
  const draft = await prisma.draft.create({
    data: { clientId: client.id, entryType: "SENTENCE", status: "CONFIRMED" },
  });
  const project = await prisma.project.create({
    data: {
      draftId: draft.id,
      confirmedAt: new Date("2026-10-27T00:00:00Z"),
      disclosureConsentVersion: "v1",
      title: options.title ?? "예약 캘린더 프로젝트",
      summary: options.summary ?? "예약 일정과 관리 기능",
      industryCode: options.industryCode ?? "RESTAURANT_RESERVATION",
      requiredSkills: options.requiredSkills ?? ["React", "PostgreSQL"],
      hopeBudget: options.hopeBudget === undefined ? 1_250_000 : options.hopeBudget,
      status: options.status ?? "RECRUITING",
      deletedAt: options.deleted ? new Date() : null,
      publishedAt: options.published === false ? null : new Date(),
      recruitStartAt: options.recruitStartAt === undefined ? null : options.recruitStartAt,
      deadline:
        options.deadline === undefined
          ? new Date(Date.now() + 86_400_000)
          : options.deadline,
    },
  });
  const utterance = await prisma.clientUtterance.create({
    data: {
      draftId: draft.id,
      kind: "FIRST_SENTENCE",
      content: "원문 연락처 010-9876-5432와 private@example.test",
    },
  });
  const itemStatuses = options.itemStatuses ?? ["INCLUDED"];
  const items = await Promise.all(
    itemStatuses.map((status, index) =>
      prisma.specItem.create({
        data: {
          projectId: project.id,
          versionNo: 1,
          title: `기능 ${index + 1}`,
          description: `공개 가능한 기능 설명 ${index + 1}`,
          rawText: "가려진 원문 사본",
          isRedacted: true,
          origin: "FIRST_SENTENCE",
          status,
          sortOrder: index,
        },
      }),
    ),
  );
  return { clientId: client.id, draftId: draft.id, projectId: project.id, itemIds: items.map((item) => item.id), utteranceId: utterance.id };
}

export async function createSupplierFixture() {
  const suffix = randomUUID();
  return prisma.user.create({
    data: {
      email: `supplier-${suffix}@test.local`,
      name: "공급자",
      role: "SUPPLIER",
      supplierProfile: {
        create: {
          displayName: "공급자 표시명",
          ndaAgreedAt: new Date(),
          ndaVersion: "v1",
        },
      },
    },
  });
}
