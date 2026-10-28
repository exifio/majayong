import type { ContractStorage } from './contract-workflow.js';
import { createHash } from 'node:crypto';
import { TradeError } from './errors.js';

export type ContractPdfArtifact = { contentHash: string; pdfUrl: string };

// 계약서 PDF의 작업 소요일수는 영업일이 아니라 공휴일을 포함한 달력일이다(PRD F-12).
export const CALENDAR_DURATION_LABEL = '작업 소요일수(달력일, 공휴일 포함)';

export function assertCalendarDurationDays(days: number): void {
  if (!Number.isInteger(days) || days < 1) throw new TradeError('INVALID_DURATION_DAYS');
}

// 승인된 계약서 템플릿이 그대로 출력할 수 있는 문구를 만든다.
export function formatCalendarDuration(days: number): string {
  assertCalendarDurationDays(days);
  return `${days}일 (달력일, 공휴일 포함)`;
}

export async function prepareContractPdf<Document>(input: {
  bucket: string;
  contractId: string;
  document: Document;
  renderPdf: (document: Document) => Promise<Uint8Array>;
  storage: ContractStorage;
  persistArtifact: (artifact: ContractPdfArtifact) => Promise<void>;
}): Promise<ContractPdfArtifact> {
  if (
    !input.contractId.trim() ||
    input.contractId.includes('/') ||
    input.contractId.includes('\\') ||
    input.contractId === '.' ||
    input.contractId === '..'
  ) {
    throw new TradeError('INVALID_CONTRACT_ID');
  }

  const bytes = await input.renderPdf(input.document);
  if (bytes.byteLength < 5 || new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') {
    throw new TradeError('INVALID_CONTRACT_PDF');
  }

  const digest = createHash('sha256').update(bytes).digest('hex');
  const artifact = {
    contentHash: `sha256:${digest}`,
    pdfUrl: `contracts/${input.contractId}/${digest}.pdf`,
  };
  // Content-addressed paths make retries safe to upsert without replacing another document.
  await input.storage.uploadPrivateObject({
    bucket: input.bucket,
    path: artifact.pdfUrl,
    bytes,
    contentType: 'application/pdf',
    upsert: true,
  });
  // shortcut: failed DB persistence can leave an inaccessible private object; add cleanup if retries accumulate objects.
  await input.persistArtifact(artifact);
  return artifact;
}
