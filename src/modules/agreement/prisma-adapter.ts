import type { AgreementDraft, AgreementItem } from './draft.js';

export interface AgreementDraftDelegate {
  findUnique(input: {
    readonly where: { readonly id: string };
    readonly select: { readonly agreementDraft: true };
  }): Promise<{ readonly agreementDraft: unknown } | null>;
  update(input: {
    readonly where: { readonly id: string };
    readonly data: { readonly agreementDraft: unknown };
  }): Promise<unknown>;
}

export interface AgreementDraftPrismaClient {
  readonly application: AgreementDraftDelegate;
}

export interface AgreementDraftStore {
  get(applicationId: string): Promise<AgreementDraft | null>;
  save(applicationId: string, draft: AgreementDraft): Promise<void>;
  invalidate(applicationId: string): Promise<void>;
}

export function createPrismaAgreementDraftStore(
  prisma: AgreementDraftPrismaClient,
  options: { readonly databaseNull: unknown },
): AgreementDraftStore {
  return {
    async get(applicationId) {
      const row = await prisma.application.findUnique({
        where: { id: applicationId },
        select: { agreementDraft: true },
      });
      if (row === null || row.agreementDraft === null || row.agreementDraft === options.databaseNull) {
        return null;
      }
      return parseAgreementDraft(row.agreementDraft);
    },
    async save(applicationId, draft) {
      await prisma.application.update({
        where: { id: applicationId },
        data: { agreementDraft: JSON.parse(JSON.stringify(draft)) },
      });
    },
    async invalidate(applicationId) {
      await prisma.application.update({
        where: { id: applicationId },
        data: { agreementDraft: options.databaseNull },
      });
    },
  };
}

export function parseAgreementDraft(value: unknown): AgreementDraft {
  if (!isRecord(value) || !Array.isArray(value.items)) throw new Error('Invalid agreementDraft JSON');
  if (typeof value.interimRatio !== 'number' || !Number.isInteger(value.interimRatio) ||
    value.interimRatio < 10 || value.interimRatio > 90) {
    throw new Error('Invalid agreementDraft interimRatio');
  }
  if (!isState(value.ratioState)) throw new Error('Invalid agreementDraft ratioState');
  const cachedAt = parseDate(value.cachedAt);
  if (value.lastMessageAt !== null && value.lastMessageAt !== undefined &&
    (typeof value.lastMessageAt !== 'string' || Number.isNaN(Date.parse(value.lastMessageAt)))) {
    throw new Error('Invalid agreementDraft lastMessageAt');
  }
  const lastMessageAt = value.lastMessageAt === null || value.lastMessageAt === undefined
    ? null
    : parseDate(value.lastMessageAt);
  const items: AgreementItem[] = value.items.map((rawItem): AgreementItem => {
    if (!isRecord(rawItem) || typeof rawItem.blockId !== 'string' || typeof rawItem.title !== 'string') {
      throw new Error('Invalid agreementDraft item');
    }
    if (rawItem.specItemId !== null && rawItem.specItemId !== undefined &&
      typeof rawItem.specItemId !== 'string') throw new Error('Invalid agreementDraft specItemId');
    if (rawItem.stage !== 'INTERIM' && rawItem.stage !== 'FINAL') throw new Error('Invalid agreementDraft stage');
    if (!Array.isArray(rawItem.conditions)) throw new Error('Invalid agreementDraft conditions');
    const conditions = rawItem.conditions.map((rawCondition) => {
      if (!isRecord(rawCondition) || typeof rawCondition.key !== 'string' || typeof rawCondition.text !== 'string') {
        throw new Error('Invalid agreementDraft condition');
      }
      if (!isState(rawCondition.state) || !Array.isArray(rawCondition.evidenceMessageIds) ||
        !rawCondition.evidenceMessageIds.every((id) => typeof id === 'string')) {
        throw new Error('Invalid agreementDraft condition state/evidence');
      }
      return {
        key: rawCondition.key,
        text: rawCondition.text,
        state: rawCondition.state,
        evidenceMessageIds: [...rawCondition.evidenceMessageIds],
      };
    });
    return {
      blockId: rawItem.blockId,
      specItemId: rawItem.specItemId ?? null,
      title: rawItem.title,
      stage: rawItem.stage,
      conditions,
    };
  });
  return {
    items,
    interimRatio: value.interimRatio,
    ratioState: value.ratioState,
    cachedAt,
    lastMessageAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isState(value: unknown): value is AgreementDraft['ratioState'] {
  return value === 'DECIDED' || value === 'PROPOSED' || value === 'UNDECIDED';
}

function parseDate(value: unknown): Date {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new Error('Invalid agreementDraft date');
  return new Date(value);
}
