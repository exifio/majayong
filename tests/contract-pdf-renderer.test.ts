import { expect, test } from "@jest/globals";
import { renderContractPdf, type ContractPdfDocument } from "../src/contracts/contract-pdf-renderer.ts";
import { formatCalendarDuration } from "../src/trade/contract-pdf.ts";

const document: ContractPdfDocument = {
  contractId: "contract-1",
  projectTitle: "예약 관리 화면 제작",
  clientName: "의뢰인",
  supplierName: "공급자",
  specVersionNo: 2,
  agreedAmount: 1_000_000,
  durationDays: 30,
  includedItems: [{
    title: "예약 등록",
    description: "고객이 예약을 등록하고 확인할 수 있습니다.",
    amount: 600_000,
    installmentStage: "INTERIM",
  }],
  excludedItems: [{ title: "문자 발송", reason: "NOT_QUOTED" }],
  clientSignedAt: null,
  supplierSignedAt: null,
};

test("한국어 계약 합의 내용을 PDF 바이트로 생성한다", async () => {
  const bytes = await renderContractPdf(document);
  const pdf = Buffer.from(bytes).toString("latin1");

  expect(pdf.slice(0, 5)).toBe("%PDF-");
  expect(pdf).toContain("NotoSansKR");
  expect(pdf.endsWith("%%EOF\n")).toBe(true);
  expect(bytes.byteLength).toBeGreaterThan(10_000);
});

test("계약 기간은 달력일이며 공휴일을 포함한다고 표시한다", () => {
  expect(formatCalendarDuration(14)).toBe("14일 (달력일, 공휴일 포함)");
});

test("서명 시각이 달라지면 렌더된 계약 PDF도 달라진다", async () => {
  const unsigned = await renderContractPdf(document);
  const signed = await renderContractPdf({
    ...document,
    clientSignedAt: "2026-10-28T01:00:00.000Z",
    supplierSignedAt: "2026-10-28T02:00:00.000Z",
  });

  expect(Buffer.from(signed)).not.toEqual(Buffer.from(unsigned));
});

test("작업 항목의 검수 구간이 달라지면 계약 PDF 내용도 달라진다", async () => {
  const interim = await renderContractPdf(document);
  const final = await renderContractPdf({
    ...document,
    includedItems: document.includedItems.map((item) => ({ ...item, installmentStage: "FINAL" })),
  });
  const withoutCreationDate = (bytes: Uint8Array) =>
    Buffer.from(bytes)
      .toString("latin1")
      .replace(/\(D:\d{14}Z\)/gu, "(D:00000000000000Z)")
      .replace(/\/ID \[<[^>]+> <[^>]+>\]/u, "/ID [<fixed> <fixed>]");

  expect(withoutCreationDate(interim)).not.toBe(withoutCreationDate(final));
});

test("음수 합의 금액은 PDF로 렌더링하지 않는다", async () => {
  await expect(renderContractPdf({ ...document, agreedAmount: -1 })).rejects.toThrow(RangeError);
});
