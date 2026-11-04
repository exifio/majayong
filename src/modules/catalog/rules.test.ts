import { describe, expect, it } from "@jest/globals";
import { sanitizeUserText } from "../../core/privacy.ts";
import { normalizeFunctionSummary, parseGeneratedBlock } from "./rules.ts";

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

describe("A-03 카탈로그 핵심 규칙", () => {
  it("제공자 입력 전에 계정·프로필 개인정보 값을 제거한다", () => {
    const input = "Cafe Blue 김하나 서울 마포구 월드컵로 12 010-1234-5678 hana@example.invalid 예약 달력";
    const safe = sanitizeUserText(input, privateValues);

    for (const value of [...privateValues, "010-1234-5678", "hana@example.invalid"]) {
      expect(safe).not.toContain(value);
    }
    expect(safe).toContain("예약 달력");
  });

  it("프로필에 없더라도 이름·상호·주소로 표시된 필드는 제거한다", () => {
    const safe = sanitizeUserText("이름: 홍길동, 상호명: 네모 카페, 주소: 서울 마포구 월드컵로 12, 기능: 예약 달력", []);

    for (const value of ["홍길동", "네모 카페", "서울 마포구 월드컵로 12"]) expect(safe).not.toContain(value);
    expect(safe).toContain("기능: 예약 달력");
    expect(sanitizeUserText("상호작용 로그를 보여줘", [])).toBe("상호작용 로그를 보여줘");
  });

  it("라벨 없는 한국 도로명 주소도 제거한다", () => {
    const safe = sanitizeUserText("매장 위치는 서울특별시 마포구 월드컵로 12입니다. 예약 기능이 필요해요.", []);

    expect(safe).not.toContain("서울특별시 마포구 월드컵로 12");
    expect(safe).toContain("예약 기능이 필요해요");
  });

  it("사업자등록번호·계좌번호로 표시된 값을 제거한다", () => {
    const safe = sanitizeUserText("사업자등록번호: 123-45-67890, 계좌번호: 1234567890, 예약 기능", []);

    expect(safe).not.toContain("123-45-67890");
    expect(safe).not.toContain("1234567890");
    expect(safe).toContain("예약 기능");
  });

  it("스키마 기반 블록 형태와 6가지 와이어프레임 파트 타입을 모두 허용한다", () => {
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
    ["too many conditions", { conditions: [
      { key: "one", text: "First." },
      { key: "two", text: "Second." },
      { key: "three", text: "Third." },
    ] }],
    ["non-three-line price basis", { priceBasis: "One line.\nTwo lines." }],
    ["unknown wireframe type", { wireframe: { parts: [{ type: "CHART" }] } }],
  ])("rejects %s", (_label, override) => {
    expect(() => parseGeneratedBlock({ ...validBlock(), ...override }, privateValues)).toThrow();
  });

  it("중첩된 제공자 출력에 반복된 개인정보 값을 거부한다", () => {
    const block = validBlock();
    block.wireframe = { parts: [{ type: "FORM", props: { placeholder: "Cafe Blue" } }] };

    expect(() => parseGeneratedBlock(block, privateValues)).toThrow();
  });

  it("중복 매칭을 위해 기능 요약을 보수적으로 정규화한다", () => {
    expect(normalizeFunctionSummary(" ＢＯＯＫＩＮＧ   HOURS\nCalendar ")).toBe("booking hours calendar");
  });
});
