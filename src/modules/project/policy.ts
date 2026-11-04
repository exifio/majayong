import { ProjectStatus } from "@prisma/client";

export type PublicProjectRow = {
  id: string;
  title: string;
  industryCode: string;
  requiredSkills: string[];
  status: ProjectStatus;
  deadline: Date | null;
  hopeBudget: number | null;
};

export type PublicProjectSummary = {
  projectId: string;
  title: string;
  industryCode: string;
  requiredSkills: string[];
  status: ProjectStatus;
  deadline: string | null;
  itemCount: number;
  hopeBudgetBand: string | null;
};

export type PublicSpecItem = {
  title: string;
  description: string;
  conditions: unknown;
  wireframe: unknown;
};

export type PublicClientCard = {
  name: string | null;
  businessName: string;
  industryField: string | null;
  storeAddress: string | null;
  bio: string | null;
  websiteUrl: string | null;
  ratingAvg: number | null;
  reviewCount: number;
};

export type PublicProjectDetail = PublicProjectSummary & {
  summary: string;
  hopeBudget: number | null;
  items: PublicSpecItem[];
  client: PublicClientCard;
};

const editableStatuses: ProjectStatus[] = [
  ProjectStatus.SCHEDULED,
  ProjectStatus.RECRUITING,
  ProjectStatus.SELECTING,
  ProjectStatus.EXPIRED,
];
const extendableStatuses: ProjectStatus[] = [
  ProjectStatus.RECRUITING,
  ProjectStatus.SELECTING,
  ProjectStatus.EXPIRED,
];
const oneDayMs = 24 * 60 * 60 * 1000;
export const EXTENSION_CAP_MS = 14 * oneDayMs;

export function canEditSpec(status: ProjectStatus): boolean {
  return editableStatuses.includes(status);
}

export function canDeleteProject(status: ProjectStatus): boolean {
  return editableStatuses.includes(status);
}

export function canExtendDeadline(status: ProjectStatus): boolean {
  return extendableStatuses.includes(status);
}

export function resolveClosingOutcome(pendingCount: number): "SELECTING" | "EXPIRED" {
  return pendingCount > 0 ? "SELECTING" : "EXPIRED";
}

export function isWithinExtensionCap(from: Date, to: Date): boolean {
  const delta = to.getTime() - from.getTime();
  return delta > 0 && delta <= EXTENSION_CAP_MS;
}

export function hopeBudgetBand(hopeBudget: number | null): string | null {
  if (hopeBudget === null) return null;
  if (hopeBudget < 1_000_000) return "100만원 미만";
  if (hopeBudget < 3_000_000) return "100만원~300만원";
  if (hopeBudget < 5_000_000) return "300만원~500만원";
  if (hopeBudget < 10_000_000) return "500만원~1000만원";
  return "1000만원 이상";
}

export function publicProjectSummary(row: PublicProjectRow, itemCount: number): PublicProjectSummary {
  return {
    projectId: row.id,
    title: row.title,
    industryCode: row.industryCode,
    requiredSkills: row.requiredSkills,
    status: row.status,
    deadline: row.deadline === null ? null : row.deadline.toISOString(),
    itemCount,
    hopeBudgetBand: hopeBudgetBand(row.hopeBudget),
  };
}

export function publicProjectDetail(row: PublicProjectRow, detail: {
  summary: string;
  items: PublicSpecItem[];
  client: PublicClientCard;
}): PublicProjectDetail {
  return {
    ...publicProjectSummary(row, detail.items.length),
    summary: detail.summary,
    hopeBudget: row.hopeBudget,
    items: detail.items,
    client: detail.client,
  };
}
