import { DraftStatus, Prisma, PrismaClient, ProjectStatus, SpecItemStatus } from "@prisma/client";
import { DraftError } from "../draft/rules.js";

export const PROJECT_DISCLOSURE_CONSENT_DRAFT_VERSION = "project-disclosure-v0.1-draft";

export type PublishDraftInput = {
  recruitStartAt?: Date;
  deadline: Date;
  disclosureConsentVersion: string;
  disclosureScope: "FULL" | "DETAIL";
  disclosureConsent: true;
};

export type PublishedProject = {
  projectId: string;
  title: string;
  summary: string;
  currentVersion: 1;
  status: ProjectStatus;
  recruitStartAt: Date;
  deadline: Date;
  itemCount: number;
};

const publishDraftDetails = {
  client: { select: { clientProfile: { select: { businessName: true } } } },
  blocks: {
    where: { status: "ADDED" as const },
    orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }],
    include: {
      block: {
        select: {
          name: true,
          functionSummary: true,
          description: true,
          industryCode: true,
          techTags: true,
          wireframe: true,
          conditions: true,
        },
      },
    },
  },
} satisfies Prisma.DraftInclude;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readConditions(value: Prisma.JsonValue | null): { key: string; text: string }[] {
  if (value === null) return [];
  if (!Array.isArray(value)) throw new DraftError("SPEC_CONDITIONS_INVALID", 409);
  const conditions: { key: string; text: string }[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.key !== "string" || typeof item.text !== "string") {
      throw new DraftError("SPEC_CONDITIONS_INVALID", 409);
    }
    conditions.push({ key: item.key, text: item.text });
  }
  return conditions;
}

function mergeConditionNotes(
  conditionsValue: Prisma.JsonValue | null,
  notesValue: Prisma.JsonValue | null,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  const conditions = readConditions(conditionsValue);
  const notes = notesValue === null ? [] : Array.isArray(notesValue) ? notesValue : null;
  if (notes === null) throw new DraftError("SPEC_CONDITION_NOTES_INVALID", 409);
  const noteByKey = new Map<string, string>();
  for (const item of notes) {
    if (!isRecord(item) || typeof item.key !== "string" || typeof item.note !== "string") {
      throw new DraftError("SPEC_CONDITION_NOTES_INVALID", 409);
    }
    if (item.note.trim()) noteByKey.set(item.key, item.note.trim());
  }
  if ([...noteByKey.keys()].some(key => !conditions.some(condition => condition.key === key))) {
    throw new DraftError("SPEC_CONDITION_NOTE_MISMATCH", 409);
  }
  const copied = conditions.map(condition => {
    const note = noteByKey.get(condition.key);
    return note === undefined ? condition : { ...condition, note };
  });
  return copied.length === 0 ? Prisma.DbNull : copied;
}

function databaseJson(value: Prisma.JsonValue | null): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null ? Prisma.DbNull : value;
}

function projectTitle(names: string[]): string {
  return names.length <= 2 ? names.join(", ") : `${names.slice(0, 2).join(", ")} 외 ${names.length - 2}개 기능`;
}

export async function publishDraft(
  db: PrismaClient,
  draftId: string,
  clientId: string,
  input: PublishDraftInput,
  activeConsentVersion: string | null,
  now: Date,
): Promise<PublishedProject> {
  if (Number.isNaN(now.getTime())) throw new DraftError("INVALID_TIME", 500);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM drafts WHERE id = ${draftId} FOR UPDATE`;
    const draft = await tx.draft.findFirst({
      where: { id: draftId, clientId, deletedAt: null },
      include: publishDraftDetails,
    });
    if (!draft) throw new DraftError("DRAFT_NOT_FOUND", 404);
    if (draft.status === DraftStatus.CONFIRMED) throw new DraftError("DRAFT_ALREADY_CONFIRMED", 409);
    if (draft.status !== DraftStatus.IN_PROGRESS) throw new DraftError("DRAFT_NOT_IN_PROGRESS", 409);
    if (await tx.project.findUnique({ where: { draftId }, select: { id: true } })) {
      throw new DraftError("DRAFT_ALREADY_CONFIRMED", 409);
    }
    if (!draft.client.clientProfile?.businessName?.trim()) throw new DraftError("CLIENT_PROFILE_INCOMPLETE", 422);
    if (Array.isArray(draft.pendingFeatures) && draft.pendingFeatures.length > 0) {
      throw new DraftError("DRAFT_FEATURES_PENDING", 409);
    }
    if (!activeConsentVersion?.trim()) throw new DraftError("DISCLOSURE_CONSENT_UNAVAILABLE", 503);
    if (input.disclosureConsent !== true) throw new DraftError("DISCLOSURE_CONSENT_REQUIRED", 422);
    if (!input.disclosureConsentVersion.trim()) throw new DraftError("DISCLOSURE_CONSENT_REQUIRED", 422);
    if (activeConsentVersion !== PROJECT_DISCLOSURE_CONSENT_DRAFT_VERSION || input.disclosureConsentVersion !== activeConsentVersion) {
      throw new DraftError("DISCLOSURE_CONSENT_VERSION_MISMATCH", 409);
    }
    if (input.disclosureScope !== "FULL" && input.disclosureScope !== "DETAIL") throw new DraftError("INVALID_DISCLOSURE_SCOPE", 422);
    if (Number.isNaN(input.deadline.getTime()) || (input.recruitStartAt !== undefined && Number.isNaN(input.recruitStartAt.getTime()))) {
      throw new DraftError("INVALID_RECRUITMENT_PERIOD", 422);
    }

    const recruitStartAt = input.recruitStartAt ?? now;
    if (recruitStartAt.getTime() >= input.deadline.getTime() || input.deadline.getTime() <= now.getTime()) {
      throw new DraftError("INVALID_RECRUITMENT_PERIOD", 422);
    }
    if (draft.blocks.length === 0) throw new DraftError("NO_SELECTED_BLOCKS", 409);
    const industryCodes = new Set(draft.blocks.map(block => block.block.industryCode));
    if (industryCodes.size !== 1) throw new DraftError("BLOCK_INDUSTRY_MISMATCH", 422);

    const title = projectTitle(draft.blocks.map(block => block.block.name));
    const summary = draft.blocks.map(block => block.block.description).join("\n\n");
    const requiredSkills = [...new Set(draft.blocks.flatMap(block => block.block.techTags))];
    const status = recruitStartAt.getTime() > now.getTime() ? ProjectStatus.SCHEDULED : ProjectStatus.RECRUITING;
    const firstBlock = draft.blocks[0];
    if (!firstBlock) throw new DraftError("NO_SELECTED_BLOCKS", 409);
    const project = await tx.project.create({
      data: {
        draftId,
        currentVersion: 1,
        confirmedAt: now,
        disclosureConsentVersion: PROJECT_DISCLOSURE_CONSENT_DRAFT_VERSION,
        title,
        summary,
        industryCode: firstBlock.block.industryCode,
        requiredSkills,
        hopeBudget: draft.hopeBudget,
        recruitStartAt,
        deadline: input.deadline,
        status,
        publishedAt: status === ProjectStatus.RECRUITING ? now : null,
      },
    });
    const inserted = await tx.specItem.createMany({
      data: draft.blocks.map(block => ({
        projectId: project.id,
        versionNo: 1,
        blockId: block.blockId,
        title: block.block.name,
        description: block.block.description,
        wireframe: databaseJson(block.block.wireframe),
        conditions: mergeConditionNotes(block.block.conditions, block.conditionNotes),
        origin: block.origin,
        status: SpecItemStatus.INCLUDED,
        unitPrice: block.unitPrice,
        sortOrder: block.sortOrder,
      })),
    });
    if (inserted.count !== draft.blocks.length) throw new DraftError("SPEC_COPY_INCOMPLETE", 500);
    await tx.draft.update({ where: { id: draftId }, data: { status: DraftStatus.CONFIRMED, lastActiveAt: now } });
    await tx.eventLog.create({
      data: {
        userId: clientId,
        projectId: project.id,
        type: "PROJECT_PUBLISHED",
        payload: { disclosureScope: input.disclosureScope, disclosureConsentVersion: PROJECT_DISCLOSURE_CONSENT_DRAFT_VERSION },
      },
    });
    return {
      projectId: project.id,
      title: project.title,
      summary: project.summary,
      currentVersion: 1,
      status: project.status,
      recruitStartAt,
      deadline: input.deadline,
      itemCount: inserted.count,
    };
  });
}
