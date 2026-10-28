import { readFile } from "node:fs/promises";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import type { ExcludedReason } from "../trade/contract.ts";
import { formatCalendarDuration } from "../trade/contract-pdf.ts";

export interface ContractPdfDocument {
  contractId: string;
  projectTitle: string;
  clientName: string;
  supplierName: string;
  specVersionNo: number;
  agreedAmount: number;
  durationDays: number;
  includedItems: readonly {
    title: string;
    description: string;
    amount: number | null;
    installmentStage: "INTERIM" | "FINAL";
  }[];
  excludedItems: readonly { title: string; reason: ExcludedReason }[];
  clientSignedAt: Date | string | null;
  supplierSignedAt: Date | string | null;
}

const excludedReasonLabels: Record<ExcludedReason, string> = {
  SPEC_EXCLUDED: "명세에서 제외",
  SPEC_NEEDS_CONFIRMATION: "확인 필요",
  NOT_QUOTED: "지원서 견적 없음",
  SUPPLIER_UNAVAILABLE: "공급자 수행 불가",
};

const koreanDateTime = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Seoul",
});

let fontPromise: Promise<Buffer> | undefined;

export async function renderContractPdf(input: ContractPdfDocument): Promise<Uint8Array> {
  assertValidDocument(input);
  const font = await loadKoreanFont();
  const document = new PDFDocument({
    size: "A4",
    margin: 52,
    info: {
      Title: "계약 합의 내용",
      Subject: `계약 ${input.contractId}`,
      Creator: "Majayong",
    },
  });
  const chunks: Buffer[] = [];

  const output = new Promise<Uint8Array>((resolve, reject) => {
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.once("error", reject);
    document.once("end", () => resolve(Buffer.concat(chunks)));
  });

  document.font(font).fillColor("#0B2545").fontSize(20).text("계약 합의 내용");
  document.moveDown(1);

  addSection(document, font, "계약 정보");
  addLine(document, font, "계약 ID", input.contractId);
  addLine(document, font, "프로젝트", input.projectTitle);
  addLine(document, font, "명세 버전", `v${input.specVersionNo}`);
  addLine(document, font, "합의 금액", formatWon(input.agreedAmount));
  addLine(document, font, "작업 기간", formatCalendarDuration(input.durationDays));

  addSection(document, font, "포함 범위");
  for (const item of input.includedItems) {
    document.font(font).fillColor("#0F172A").fontSize(11).text(item.title, { lineGap: 2 });
    if (item.description.trim()) {
      document.font(font).fillColor("#475569").fontSize(10).text(item.description, { lineGap: 2 });
    }
    addLine(document, font, "검수 구간", item.installmentStage === "INTERIM" ? "중간 구간" : "최종 구간");
    if (item.amount !== null) addLine(document, font, "항목 금액", formatWon(item.amount));
    document.moveDown(0.45);
  }

  if (input.excludedItems.length > 0) {
    addSection(document, font, "제외 범위");
    for (const item of input.excludedItems) {
      addLine(document, font, item.title, excludedReasonLabels[item.reason]);
    }
  }

  addSection(document, font, "당사자 서명 기록");
  addLine(document, font, "의뢰인", input.clientName);
  addLine(document, font, "의뢰인 서명 시각", formatSignedAt(input.clientSignedAt));
  addLine(document, font, "공급자", input.supplierName);
  addLine(document, font, "공급자 서명 시각", formatSignedAt(input.supplierSignedAt));

  document.end();
  return output;
}

function addSection(document: PDFKit.PDFDocument, font: Buffer, title: string): void {
  document.moveDown(0.8).font(font).fillColor("#0B2545").fontSize(14).text(title);
  document.moveDown(0.35);
}

function addLine(document: PDFKit.PDFDocument, font: Buffer, label: string, value: string): void {
  document.font(font).fillColor("#334155").fontSize(10).text(`${label}: ${value}`, { lineGap: 2 });
}

function formatWon(amount: number): string {
  return `${new Intl.NumberFormat("ko-KR").format(amount)}원`;
}

function formatSignedAt(value: Date | string | null): string {
  if (value === null) return "서명 대기";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError("서명 시각 형식이 올바르지 않습니다.");
  return koreanDateTime.format(date);
}

function assertValidDocument(input: ContractPdfDocument): void {
  if (
    !input.contractId.trim() ||
    !input.projectTitle.trim() ||
    !input.clientName.trim() ||
    !input.supplierName.trim() ||
    !Number.isSafeInteger(input.specVersionNo) || input.specVersionNo < 1 ||
    !Number.isSafeInteger(input.agreedAmount) || input.agreedAmount < 0 ||
    !Number.isSafeInteger(input.durationDays) || input.durationDays < 1 ||
    !Array.isArray(input.includedItems) || input.includedItems.length === 0 ||
    !Array.isArray(input.excludedItems)
  ) {
    throw new RangeError("계약 PDF 데이터가 올바르지 않습니다.");
  }

  if (input.includedItems.some((item) =>
    typeof item !== "object" || item === null || Array.isArray(item) ||
    typeof item.title !== "string" || !item.title.trim() ||
    typeof item.description !== "string" ||
    (item.installmentStage !== "INTERIM" && item.installmentStage !== "FINAL") ||
    (item.amount !== null && (!Number.isSafeInteger(item.amount) || item.amount < 0))
  )) {
    throw new RangeError("계약 포함 항목 데이터가 올바르지 않습니다.");
  }

  if (input.excludedItems.some((item) =>
    typeof item !== "object" || item === null || Array.isArray(item) ||
    typeof item.title !== "string" || !item.title.trim() ||
    !Object.hasOwn(excludedReasonLabels, item.reason)
  )) {
    throw new RangeError("계약 제외 항목 데이터가 올바르지 않습니다.");
  }

  formatSignedAt(input.clientSignedAt);
  formatSignedAt(input.supplierSignedAt);
}

function loadKoreanFont(): Promise<Buffer> {
  fontPromise ??= readFile(join(process.cwd(), "assets", "fonts", "NotoSansKR.ttf"));
  return fontPromise;
}
