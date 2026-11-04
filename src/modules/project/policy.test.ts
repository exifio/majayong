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
} from "./policy.ts";

const row: PublicProjectRow = {
  id: "project-1",
  title: "예약 달력 외 2개 기능",
  industryCode: "RESTAURANT",
  requiredSkills: ["react", "payments"],
  status: ProjectStatus.RECRUITING,
  deadline: new Date("2026-11-10T09:00:00.000Z"),
  hopeBudget: 4_000_000,
};

describe("A-06 프로젝트 정책", () => {
  it("계약이 진행되면 명세를 고정한다", () => {
    for (const status of [ProjectStatus.SCHEDULED, ProjectStatus.RECRUITING, ProjectStatus.SELECTING, ProjectStatus.EXPIRED]) {
      expect(canEditSpec(status)).toBe(true);
      expect(canDeleteProject(status)).toBe(true);
    }
    for (const status of [ProjectStatus.ACCEPTED, ProjectStatus.CONTRACTED]) {
      expect(canEditSpec(status)).toBe(false);
      expect(canDeleteProject(status)).toBe(false);
    }
  });

  it("모집이 열린 상태에서만 마감 연장을 허용한다", () => {
    expect(canExtendDeadline(ProjectStatus.RECRUITING)).toBe(true);
    expect(canExtendDeadline(ProjectStatus.SELECTING)).toBe(true);
    expect(canExtendDeadline(ProjectStatus.EXPIRED)).toBe(true);
    expect(canExtendDeadline(ProjectStatus.SCHEDULED)).toBe(false);
    expect(canExtendDeadline(ProjectStatus.ACCEPTED)).toBe(false);
    expect(canExtendDeadline(ProjectStatus.CONTRACTED)).toBe(false);
  });

  it("지원자가 대기하면 SELECTING, 없으면 EXPIRED를 선택한다", () => {
    expect(resolveClosingOutcome(0)).toBe("EXPIRED");
    expect(resolveClosingOutcome(1)).toBe("SELECTING");
    expect(resolveClosingOutcome(4)).toBe("SELECTING");
  });

  it("마감 연장을 정확히 14일로 제한한다", () => {
    const from = new Date("2026-11-10T09:00:00.000Z");
    expect(isWithinExtensionCap(from, new Date(from.getTime() + 14 * 24 * 60 * 60 * 1000))).toBe(true);
    expect(isWithinExtensionCap(from, new Date(from.getTime() + 14 * 24 * 60 * 60 * 1000 + 1))).toBe(false);
    expect(isWithinExtensionCap(from, new Date(from.getTime()))).toBe(false);
    expect(isWithinExtensionCap(from, new Date(from.getTime() - 1))).toBe(false);
  });

  it("정확한 금액이 서버를 떠나지 않도록 희망 예산을 구간화한다", () => {
    expect(hopeBudgetBand(null)).toBeNull();
    expect(hopeBudgetBand(900_000)).toBe("100만원 미만");
    expect(hopeBudgetBand(4_000_000)).toBe("400~500만원");
    expect(hopeBudgetBand(12_000_000)).toBe("500만원 이상");
  });

  it("허용 목록에 있는 공개 요약 필드만 반환한다", () => {
    const summary = publicProjectSummary(row, 3);
    expect(Object.keys(summary).sort()).toEqual([
      "deadline", "hopeBudgetBand", "industryCode", "itemCount", "projectId", "requiredSkills", "status", "title",
    ]);
    expect(summary.hopeBudgetBand).toBe("400~500만원");
    expect(summary).not.toHaveProperty("hopeBudget");
    expect(JSON.stringify(summary)).not.toContain("4000000");
  });

  it("내부 가격·연락처 없이 상세 필드를 반환한다", () => {
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
