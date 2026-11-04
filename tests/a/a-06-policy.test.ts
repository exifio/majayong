import { describe, expect, it } from "@jest/globals";
import { ProjectStatus } from "@prisma/client";
import {
  canDeleteProject,
  canEditSpec,
  canExtendDeadline,
  hopeBudgetBand,
  isWithinExtensionCap,
  publicProjectDetail,
  publicProjectSummary,
  resolveClosingOutcome,
  type PublicProjectRow,
} from "../../src/modules/project/policy.ts";

const row: PublicProjectRow = {
  id: "project-1",
  title: "예약 달력 외 2개 기능",
  industryCode: "RESTAURANT",
  requiredSkills: ["react", "payments"],
  status: ProjectStatus.RECRUITING,
  deadline: new Date("2026-11-10T09:00:00.000Z"),
  hopeBudget: 4_000_000,
};

describe("A-06 project policy", () => {
  it("freezes the spec once a contract is in progress", () => {
    for (const status of [ProjectStatus.SCHEDULED, ProjectStatus.RECRUITING, ProjectStatus.SELECTING, ProjectStatus.EXPIRED]) {
      expect(canEditSpec(status)).toBe(true);
      expect(canDeleteProject(status)).toBe(true);
    }
    for (const status of [ProjectStatus.ACCEPTED, ProjectStatus.CONTRACTED]) {
      expect(canEditSpec(status)).toBe(false);
      expect(canDeleteProject(status)).toBe(false);
    }
  });

  it("allows deadline extension only from an open recruitment state", () => {
    expect(canExtendDeadline(ProjectStatus.RECRUITING)).toBe(true);
    expect(canExtendDeadline(ProjectStatus.SELECTING)).toBe(true);
    expect(canExtendDeadline(ProjectStatus.EXPIRED)).toBe(true);
    expect(canExtendDeadline(ProjectStatus.SCHEDULED)).toBe(false);
    expect(canExtendDeadline(ProjectStatus.ACCEPTED)).toBe(false);
    expect(canExtendDeadline(ProjectStatus.CONTRACTED)).toBe(false);
  });

  it("picks SELECTING when applicants wait and EXPIRED when none does", () => {
    expect(resolveClosingOutcome(0)).toBe("EXPIRED");
    expect(resolveClosingOutcome(1)).toBe("SELECTING");
    expect(resolveClosingOutcome(4)).toBe("SELECTING");
  });

  it("caps a deadline extension at exactly fourteen days", () => {
    const from = new Date("2026-11-10T09:00:00.000Z");
    expect(isWithinExtensionCap(from, new Date(from.getTime() + 14 * 24 * 60 * 60 * 1000))).toBe(true);
    expect(isWithinExtensionCap(from, new Date(from.getTime() + 14 * 24 * 60 * 60 * 1000 + 1))).toBe(false);
    expect(isWithinExtensionCap(from, new Date(from.getTime()))).toBe(false);
    expect(isWithinExtensionCap(from, new Date(from.getTime() - 1))).toBe(false);
  });

  it("bands the hope budget so the exact amount never leaves the server", () => {
    expect(hopeBudgetBand(null)).toBeNull();
    expect(hopeBudgetBand(900_000)).toBe("100만원 미만");
    expect(hopeBudgetBand(4_000_000)).toBe("400~500만원");
    expect(hopeBudgetBand(12_000_000)).toBe("500만원 이상");
  });

  it("returns only allowlisted public summary fields", () => {
    const summary = publicProjectSummary(row, 3);
    expect(Object.keys(summary).sort()).toEqual([
      "deadline", "hopeBudgetBand", "industryCode", "itemCount", "projectId", "requiredSkills", "status", "title",
    ]);
    expect(summary.hopeBudgetBand).toBe("400~500만원");
    expect(summary).not.toHaveProperty("hopeBudget");
    expect(JSON.stringify(summary)).not.toContain("4000000");
  });

  it("returns detail fields without any internal price or contact data", () => {
    const detail = publicProjectDetail(row, {
      summary: "예약 관련 기능 3종",
      items: [{ title: "예약 달력", description: "달력 조회", conditions: [{ key: "k", text: "조건" }], wireframe: { parts: [] } }],
      client: {
        name: "김의뢰", businessName: "카페 블루", industryField: "카페", storeAddress: "서울 마포구",
        bio: "소개", websiteUrl: "https://cafe.example.invalid", ratingAvg: 4.5, reviewCount: 3,
      },
    });
    expect(detail).toMatchObject({ projectId: "project-1", itemCount: 1, hopeBudget: 4_000_000, summary: "예약 관련 기능 3종" });
    expect(detail.items[0]).toMatchObject({ title: "예약 달력" });
    expect(detail.client).toMatchObject({ businessName: "카페 블루", name: "김의뢰" });
    for (const forbidden of ["unitPrice", "estimatedTotal", "clientFee", "email", "utterance"]) {
      expect(detail).not.toHaveProperty(forbidden);
    }
  });
});
