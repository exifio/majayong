import { describe, expect, it, jest } from "@jest/globals";
import * as catalog from "../../src/modules/catalog/index.ts";

const generatedBlock = {
  name: "예약 시간 선택",
  functionSummary: "고객이 예약 가능한 시간을 선택한다",
  description: "예약 가능 시간대를 보여주고 고객이 하나를 선택한다.",
  techTags: ["예약", "달력"],
  wireframe: { parts: [{ type: "CALENDAR", label: "예약 시간", props: "{}" }] },
  conditions: [
    { key: "timeSlot", text: "예약 시간 간격을 정한다." },
    { key: "capacity", text: "시간대별 예약 인원을 정한다." },
  ],
  unitPrice: 240000,
  priceBasis: "예약 시간 선택 화면과 조회 기능을 구현한다.\n저장 및 가능 시간 검증을 포함한 초기 추정이다.\n운영 정책 검증 전 참고 금액이다.",
};

function response(text: string) {
  return new Response(JSON.stringify({
    status: "completed",
    model: "gpt-5.4-mini-2026-03-17",
    output: [{ type: "message", content: [{ type: "output_text", text }] }],
    usage: { input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 200 } },
  }), { status: 200 });
}

describe("A-03 OpenAI block generator", () => {
  it("exports a generator factory", () => {
    expect(typeof catalog.createOpenAiCatalogBlockGenerator).toBe("function");
  });

  it("uses strict structured output and returns parsed data with metered cost", async () => {
    const fetcher = jest.fn<typeof fetch>().mockResolvedValue(response(JSON.stringify(generatedBlock)));
    const create = catalog.createOpenAiCatalogBlockGenerator;
    expect(typeof create).toBe("function");
    if (typeof create !== "function") return;
    const generator = create("test-secret-never-print", "gpt-5.4-mini", "1341", fetcher);
    expect(generator).toBeDefined();
    if (!generator) return;

    const result = await generator({ industryCode: "RESTAURANT_RESERVATION", text: "예약 가능한 시간을 선택한다" });
    const request = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(request).toMatchObject({ model: "gpt-5.4-mini", store: false, text: { format: { type: "json_schema", strict: true } } });
    expect(result.content).toMatchObject({ name: "예약 시간 선택", wireframe: { parts: [{ props: {} }] } });
    expect(result.metadata).toEqual({
      model: "gpt-5.4-mini-2026-03-17",
      tokens: { input: 1000, output: 100 },
      costKrw: 2,
      latencyMs: expect.any(Number),
    });
  });

  it("rejects provider errors without exposing provider response text", async () => {
    const fetcher = jest.fn<typeof fetch>().mockResolvedValue(new Response("private provider error body", { status: 500 }));
    const create = catalog.createOpenAiCatalogBlockGenerator;
    expect(typeof create).toBe("function");
    if (typeof create !== "function") return;
    const generator = create("test-secret-never-print", "gpt-5.4-mini", "1341", fetcher);
    expect(generator).toBeDefined();
    if (!generator) return;
    await expect(generator({ industryCode: "RESTAURANT_RESERVATION", text: "예약 시간" })).rejects.toMatchObject({
      code: "CATALOG_GENERATION_FAILED",
      status: 503,
    });
  });
});
