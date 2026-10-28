import { TradeError } from './errors.js';
import { computeMoney } from './money.js';
import type { InstallmentStage } from './settlement.js';

export type { InstallmentStage };

export type SpecItemStatus = 'INCLUDED' | 'EXCLUDED' | 'NEEDS_CONFIRMATION';
export type ExcludedReason = 'SPEC_EXCLUDED' | 'SPEC_NEEDS_CONFIRMATION' | 'NOT_QUOTED' | 'SUPPLIER_UNAVAILABLE';
export type ContractStatus = 'PENDING_CONSENT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
export type ContractConsent = {
  status: ContractStatus;
  contentHash: string | null;
  clientSignedAt: Date | null;
  supplierSignedAt: Date | null;
};

// A의 getAcceptedApplicationContext가 돌려줄 값에 대해 B가 기대하는 형식이다. M0 합의 전이다.
export type AcceptedContext = {
  application: { id: string; status: string; specVersionNo: number; totalAmount: number; durationDays: number };
  specItems: { id: string; versionNo: number; title: string; description: string; status: SpecItemStatus; sortOrder: number }[];
  appItems: { specItemId: string; isAvailable: boolean; amount: number | null }[];
};

export type Scope = {
  specVersionNo: number;
  included: {
    specItemId: string;
    title: string;
    description: string;
    amount: number | null;
    installmentStage: InstallmentStage;
  }[];
  excluded: { specItemId: string; title: string; reason: ExcludedReason }[];
};

export function recordContractSignature(
  contract: ContractConsent,
  signature: { party: 'CLIENT' | 'SUPPLIER'; contentHash: string; signedAt: Date },
): ContractConsent {
  if (contract.status !== 'PENDING_CONSENT') throw new TradeError('CONTRACT_NOT_PENDING');
  if (!signature.contentHash.trim()) throw new TradeError('INVALID_CONTENT_HASH');
  if (Number.isNaN(signature.signedAt.getTime())) throw new TradeError('INVALID_SIGNATURE_TIME');

  const previousSignatureAt = signature.party === 'CLIENT' ? contract.clientSignedAt : contract.supplierSignedAt;
  if (previousSignatureAt !== null) throw new TradeError('ALREADY_SIGNED');
  if (contract.contentHash !== null && contract.contentHash !== signature.contentHash) {
    throw new TradeError('CONTRACT_CONTENT_MISMATCH');
  }

  const clientSignedAt = signature.party === 'CLIENT' ? signature.signedAt : contract.clientSignedAt;
  const supplierSignedAt = signature.party === 'SUPPLIER' ? signature.signedAt : contract.supplierSignedAt;
  return {
    status: clientSignedAt !== null && supplierSignedAt !== null ? 'ACTIVE' : 'PENDING_CONSENT',
    contentHash: signature.contentHash,
    clientSignedAt,
    supplierSignedAt,
  };
}

// 계약 범위 = 명세에 INCLUDED이면서 공급자가 수행 가능한 항목(PRD F-12).
// 구간 배정(INTERIM/FINAL)은 A가 명세 항목별로 확정해 넘긴다. 포함 항목마다 하나씩 있어야 한다.
export function buildScope(
  { application, specItems, appItems }: AcceptedContext,
  installmentStageBySpecItemId: Readonly<Record<string, InstallmentStage>>,
): Scope {
  if (typeof installmentStageBySpecItemId !== 'object' || installmentStageBySpecItemId === null || Array.isArray(installmentStageBySpecItemId)) {
    throw new TradeError('INVALID_INSTALLMENT_STAGE_ASSIGNMENT');
  }
  if (application.status !== 'ACCEPTED') throw new TradeError('APPLICATION_NOT_ACCEPTED');
  if (specItems.some((s) => s.versionNo !== application.specVersionNo)) {
    throw new TradeError('SPEC_VERSION_MISMATCH');
  }
  const specIds = new Set(specItems.map((s) => s.id));
  if (appItems.some((a) => !specIds.has(a.specItemId))) throw new TradeError('FOREIGN_APPLICATION_ITEM');

  const quoted = new Map(appItems.map((a) => [a.specItemId, a]));
  const scope: Scope = { specVersionNo: application.specVersionNo, included: [], excluded: [] };
  for (const s of [...specItems].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const a = quoted.get(s.id);
    const reason: ExcludedReason | null =
      s.status === 'EXCLUDED' ? 'SPEC_EXCLUDED'
      : s.status === 'NEEDS_CONFIRMATION' ? 'SPEC_NEEDS_CONFIRMATION'
      : !a ? 'NOT_QUOTED'
      : !a.isAvailable ? 'SUPPLIER_UNAVAILABLE'
      : null;
    if (reason) scope.excluded.push({ specItemId: s.id, title: s.title, reason });
    else {
      const installmentStage = installmentStageBySpecItemId[s.id];
      if (installmentStage !== 'INTERIM' && installmentStage !== 'FINAL') {
        throw new TradeError('INVALID_INSTALLMENT_STAGE_ASSIGNMENT');
      }
      scope.included.push({
        specItemId: s.id,
        title: s.title,
        description: s.description,
        amount: a?.amount ?? null,
        installmentStage,
      });
    }
  }
  if (scope.included.length === 0) throw new TradeError('EMPTY_SCOPE');
  // 제외된 항목에 배정이 남아 있으면 잘못된 입력이다.
  const includedIds = new Set(scope.included.map(({ specItemId }) => specItemId));
  if (Object.keys(installmentStageBySpecItemId).some((specItemId) => !includedIds.has(specItemId))) {
    throw new TradeError('INVALID_INSTALLMENT_STAGE_ASSIGNMENT');
  }
  return scope;
}

// 합의 금액은 지원서의 제안 금액과 다를 수 있어 따로 받는다.
// 수수료 면제는 계약 생성 때 적용하지 않는다. 첫 공급자 지급 때 planPayoutCoupon으로 처리한다.
export function planContract(
  ctx: AcceptedContext,
  terms: {
    agreedAmount: number;
    interimRatio?: number;
    installmentStageBySpecItemId: Readonly<Record<string, InstallmentStage>>;
  },
) {
  const scope = buildScope(ctx, terms.installmentStageBySpecItemId);
  const interimRatio = terms.interimRatio ?? 50;
  const durationDays = ctx.application.durationDays;
  if (!Number.isInteger(durationDays) || durationDays < 1) throw new TradeError('INVALID_DURATION_DAYS');
  const money = computeMoney(terms.agreedAmount, interimRatio, false);
  return {
    applicationId: ctx.application.id,
    status: 'PENDING_CONSENT' as const,
    contentHash: null,
    clientSignedAt: null,
    supplierSignedAt: null,
    specVersionNo: scope.specVersionNo,
    // 계약서 PDF에 표시할 작업 소요일수(달력일, 공휴일 포함)도 서명 시점 스냅샷에 고정한다.
    specSnapshot: { ...scope, durationDays },
    durationDays,
    agreedAmount: terms.agreedAmount,
    clientFee: money.clientFee,
    supplierFee: money.supplierFee,
    interimRatio,
    installments: money.installments,
  };
}
