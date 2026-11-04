import { describe, expect, it } from "@jest/globals";
import { sanitizeUserText } from "../../src/core/privacy.ts";
import { normalizeFunctionSummary, parseGeneratedBlock } from "../../src/modules/catalog/rules.ts";

const privateValues = ["Cafe Blue", "김하나", "서울 마포구 월드컵로 12"];

function validBlock(): Record<string, unknown> {
  return {
    name: "Reservation calendar",
    functionSummary: "show and edit available reservation hours",
    description: "Lets staff manage booking times.",
    techTags: ["calendar", "booking"],
    wireframe: {
      parts: [
        { type: "CALENDAR" }, { type: "FORM", label: "Customer name", props: { required: true } }, { type: "LIST" },
        { type: "BUTTON" }, { type: "TEXT" }, { type: "PREVIEW" },
      ],
    },
    conditions: [
      { key: "timezone", text: "Choose the store timezone." },
      { key: "capacity", text: "Set the available reservation capacity." },
    ],
    unitPrice: 120000,
    priceBasis: "Implement reservation calendar and API.\nConnect booking data and validation.\nFinal scope may change the effort.",
  };
}

describe("A-03 catalog core rules", () => {
  it("removes account and profile private values before provider input", () => {
    const input = "Cafe Blue 김하나 서울 마포구 월드컵로 12 010-1234-5678 hana@example.invalid 예약 달력";
    const safe = sanitizeUserText(input, privateValues);

    for (const value of [...privateValues, "010-1234-5678", "hana@example.invalid"]) {
      expect(safe).not.toContain(value);
    }
    expect(safe).toContain("예약 달력");
  });

  it("removes labeled name, store name, and address fields even when absent from the profile", () => {
    const safe = sanitizeUserText("이름: 홍길동, 상호명: 네모 카페, 주소: 서울 마포구 월드컵로 12, 기능: 예약 달력", []);

    for (const value of ["홍길동", "네모 카페", "서울 마포구 월드컵로 12"]) expect(safe).not.toContain(value);
    expect(safe).toContain("기능: 예약 달력");
    expect(sanitizeUserText("상호작용 로그를 보여줘", [])).toBe("상호작용 로그를 보여줘");
  });

  it("removes an unlabelled Korean road address", () => {
    const safe = sanitizeUserText("매장 위치는 서울특별시 마포구 월드컵로 12입니다. 예약 기능이 필요해요.", []);

    expect(safe).not.toContain("서울특별시 마포구 월드컵로 12");
    expect(safe).toContain("예약 기능이 필요해요");
  });

  it("removes labeled business registration and account numbers", () => {
    const safe = sanitizeUserText("사업자등록번호: 123-45-67890, 계좌번호: 1234567890, 예약 기능", []);

    expect(safe).not.toContain("123-45-67890");
    expect(safe).not.toContain("1234567890");
    expect(safe).toContain("예약 기능");
  });

  it("accepts the schema-backed block shape and all six wireframe part types", () => {
    const parsed = parseGeneratedBlock(validBlock(), privateValues);
    expect(parsed).toMatchObject({
      name: "Reservation calendar",
      unitPrice: 120000,
      conditions: [
        { key: "timezone", text: "Choose the store timezone." },
        { key: "capacity", text: "Set the available reservation capacity." },
      ],
    });
    expect(parsed.wireframe).toHaveProperty("parts.1.props.required", true);
    expect(parsed.wireframe).toHaveProperty("parts.1.label", "Customer name");
  });

  it.each([
    ["fractional price", { unitPrice: 12.5 }],
    ["non-integer database range", { unitPrice: 2_147_483_648 }],
    ["too few conditions", { conditions: [{ key: "one", text: "Only one." }] }],
    ["non-three-line price basis", { priceBasis: "One line.\nTwo lines." }],
    ["unknown wireframe type", { wireframe: { parts: [{ type: "CHART" }] } }],
  ])("rejects %s", (_label, override) => {
    expect(() => parseGeneratedBlock({ ...validBlock(), ...override }, privateValues)).toThrow();
  });

  it("rejects private values repeated in nested provider output", () => {
    const block = validBlock();
    block.wireframe = { parts: [{ type: "FORM", props: { placeholder: "Cafe Blue" } }] };

    expect(() => parseGeneratedBlock(block, privateValues)).toThrow();
  });

  it("normalizes function summaries conservatively for duplicate matching", () => {
    expect(normalizeFunctionSummary(" ＢＯＯＫＩＮＧ   HOURS\nCalendar ")).toBe("booking hours calendar");
  });
});
