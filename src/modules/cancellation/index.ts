export class CancellationHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "CancellationHttpError";
    this.status = status;
  }
}

export type CancelCause = "CLIENT" | "SUPPLIER" | "MUTUAL";
export type CancelResolution = "AGREED" | "ADMIN_DECIDED";

export interface CancellationContractEntity {
  id: string;
  clientUserId: string;
  supplierUserId: string;
  status: string;
  paymentStatus: string;
  agreedAmount: number;
  clientFee: number;
  totalDeposited: number;
  interimRatio: number;
  depositedAt: Date | null;
  cancelCause: CancelCause | null;
  cancelRequestedBy: string | null;
  cancelRequestedAt: Date | null;
  cancelNote: string | null;
  objectionNote: string | null;
  objectionRate: number | null;
  cancelEvidence: unknown | null;
  cancelEscalatedAt: Date | null;
  compensationRate: number | null;
  cancelResolution: CancelResolution | null;
  cancelResolvedAt: Date | null;
  refundAmount: number | null;
  clientFeeRefund: number | null;
  settledAmount: number | null;
  refundReason: string | null;
  refundedAt: Date | null;
  cancelPayoutAt: Date | null;
}

export interface CancellationInstallmentInfo {
  id: string;
  contractId: string;
  stage: "INTERIM" | "FINAL";
  amount: number;
  status: "PENDING" | "DELIVERED" | "REWORK_REQUESTED" | "APPROVED" | "RELEASED" | "REFUNDED";
}

export interface CancellationRepository {
  seedContract(contract: CancellationContractEntity): void;
  seedInstallments(installments: CancellationInstallmentInfo[]): void;
  getContract(id: string): Promise<CancellationContractEntity | null>;
  updateContract(id: string, patch: Partial<CancellationContractEntity>): Promise<CancellationContractEntity>;
  listInstallments(contractId: string): Promise<CancellationInstallmentInfo[]>;
  updateInstallment(
    id: string,
    patch: Partial<CancellationInstallmentInfo>,
  ): Promise<CancellationInstallmentInfo>;
}

export function createInMemoryCancellationRepository(): CancellationRepository {
  const contracts = new Map<string, CancellationContractEntity>();
  const installments = new Map<string, CancellationInstallmentInfo>();

  return {
    seedContract(contract) {
      contracts.set(contract.id, { ...contract });
    },
    seedInstallments(items) {
      for (const item of items) {
        installments.set(item.id, { ...item });
      }
    },
    async getContract(id) {
      return contracts.get(id) ?? null;
    },
    async updateContract(id, patch) {
      const c = contracts.get(id);
      if (!c) throw new CancellationHttpError(404, "계약을 찾을 수 없습니다.");
      const updated = { ...c, ...patch };
      contracts.set(id, updated);
      return updated;
    },
    async listInstallments(contractId) {
      return Array.from(installments.values()).filter((i) => i.contractId === contractId);
    },
    async updateInstallment(id, patch) {
      const inst = installments.get(id);
      if (!inst) throw new CancellationHttpError(404, "구간을 찾을 수 없습니다.");
      const updated = { ...inst, ...patch };
      installments.set(id, updated);
      return updated;
    },
  };
}

export interface CancellationServiceOptions {
  repo: CancellationRepository;
  clock?: { now(): Date };
}

export class CancellationService {
  private readonly repo: CancellationRepository;
  private readonly clock: { now(): Date };

  constructor(options: CancellationServiceOptions) {
    this.repo = options.repo;
    this.clock = options.clock ?? { now: () => new Date() };
  }

  async requestCancellation(
    actor: { userId: string; role: string },
    input: {
      contractId: string;
      cause: CancelCause;
      note: string;
      evidence?: unknown;
    },
  ): Promise<CancellationContractEntity> {
    const contract = await this.repo.getContract(input.contractId);
    if (!contract) throw new CancellationHttpError(404, "계약을 찾을 수 없습니다.");

    const isParty = actor.userId === contract.clientUserId || actor.userId === contract.supplierUserId;
    if (!isParty) {
      throw new CancellationHttpError(403, "계약 당사자만 취소를 요청할 수 있습니다.");
    }

    if (contract.paymentStatus !== "DEPOSITED") {
      throw new CancellationHttpError(
        409,
        "예치 완료된 계약만 취소를 요청할 수 있습니다. 예치 전 계약은 기한 경과 시 자동 결렬됩니다.",
      );
    }

    if (contract.status === "CANCEL_REQUESTED" || contract.status === "CANCELLED") {
      throw new CancellationHttpError(409, "이미 취소 진행 중이거나 취소된 계약입니다.");
    }

    return this.repo.updateContract(contract.id, {
      status: "CANCEL_REQUESTED",
      cancelCause: input.cause,
      cancelRequestedBy: actor.userId,
      cancelRequestedAt: this.clock.now(),
      cancelNote: input.note,
      cancelEvidence: input.evidence ?? null,
    });
  }

  async agreeCancellation(
    actor: { userId: string; role: string },
    input: { contractId: string },
  ): Promise<CancellationContractEntity> {
    const contract = await this.repo.getContract(input.contractId);
    if (!contract) throw new CancellationHttpError(404, "계약을 찾을 수 없습니다.");

    if (contract.status !== "CANCEL_REQUESTED") {
      throw new CancellationHttpError(409, "취소 요청 상태의 계약이 아닙니다.");
    }

    if (contract.cancelResolvedAt) {
      throw new CancellationHttpError(409, "이미 확정된 취소 건입니다.");
    }

    if (contract.cancelEscalatedAt) {
      throw new CancellationHttpError(409, "3일 무응답으로 운영자 판정 대기 중입니다.");
    }

    // 상대방인지 확인
    const isCounterparty =
      (contract.cancelRequestedBy === contract.clientUserId && actor.userId === contract.supplierUserId) ||
      (contract.cancelRequestedBy === contract.supplierUserId && actor.userId === contract.clientUserId);

    if (!isCounterparty) {
      throw new CancellationHttpError(403, "취소를 요청한 상대방만 동의할 수 있습니다.");
    }

    const defaultRate = contract.cancelCause === "CLIENT" ? 50 : 0;
    const split = await this.calculateCancellationSplit(contract.id, defaultRate);

    return this.repo.updateContract(contract.id, {
      cancelResolution: "AGREED",
      cancelResolvedAt: this.clock.now(),
      status: "CANCELLED",
      compensationRate: defaultRate,
      refundAmount: split.refundAmount,
      settledAmount: split.settledAmount,
      clientFeeRefund: split.clientFeeRefund,
    });
  }

  async objectCancellation(
    actor: { userId: string; role: string },
    input: { contractId: string; objectionRate: number; note: string },
  ): Promise<CancellationContractEntity> {
    const contract = await this.repo.getContract(input.contractId);
    if (!contract) throw new CancellationHttpError(404, "계약을 찾을 수 없습니다.");

    if (contract.status !== "CANCEL_REQUESTED") {
      throw new CancellationHttpError(409, "취소 요청 상태의 계약이 아닙니다.");
    }

    if (contract.cancelResolvedAt) {
      throw new CancellationHttpError(409, "이미 동의 또는 판정 완료된 계약입니다.");
    }

    return this.repo.updateContract(contract.id, {
      objectionRate: input.objectionRate,
      objectionNote: input.note,
      cancelEscalatedAt: this.clock.now(), // 이의 제기 시 운영자 판정 대기로 전환
    });
  }

  async checkCancellationDeadlines(
    contractId: string,
    now: Date,
  ): Promise<{ escalatedToAdmin: boolean }> {
    const contract = await this.repo.getContract(contractId);
    if (!contract || contract.status !== "CANCEL_REQUESTED") return { escalatedToAdmin: false };

    if (!contract.cancelResolvedAt && !contract.cancelEscalatedAt && contract.cancelRequestedAt) {
      const diffMs = now.getTime() - contract.cancelRequestedAt.getTime();
      const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
      if (diffMs >= threeDaysMs) {
        await this.repo.updateContract(contract.id, {
          cancelEscalatedAt: now,
        });
        return { escalatedToAdmin: true };
      }
    }

    return { escalatedToAdmin: false };
  }

  async decideCancellation(input: {
    contractId: string;
    compensationRate: number;
    reason: string;
  }): Promise<CancellationContractEntity> {
    const contract = await this.repo.getContract(input.contractId);
    if (!contract) throw new CancellationHttpError(404, "계약을 찾을 수 없습니다.");

    // D-16 가드레일: 의뢰인 사정 24시간 이내 무납품 전액 환불(0% 보상)은 DB 제약 충돌로 차단
    if (contract.cancelCause === "CLIENT" && input.compensationRate === 0) {
      throw new CancellationHttpError(
        422,
        "D-16 BLOCKED: 의뢰인 사정 전액 환불(0% 보상)은 DB 제약 충돌로 인해 D-16 승인 전까지 차단되어 있습니다.",
      );
    }

    if (input.compensationRate < 0 || input.compensationRate > 100) {
      throw new CancellationHttpError(422, "보상 비율은 0~100 사이여야 합니다.");
    }

    if (contract.cancelCause === "CLIENT" && input.compensationRate < 50) {
      throw new CancellationHttpError(
        422,
        "의뢰인 사정 취소는 보상 비율이 50% 이상이어야 합니다. (raw 제약 6)",
      );
    }

    const split = await this.calculateCancellationSplit(contract.id, input.compensationRate);

    return this.repo.updateContract(contract.id, {
      compensationRate: input.compensationRate,
      refundReason: input.reason,
      refundAmount: split.refundAmount,
      settledAmount: split.settledAmount,
      clientFeeRefund: split.clientFeeRefund,
      cancelResolution: "ADMIN_DECIDED",
      cancelResolvedAt: this.clock.now(),
      status: "CANCELLED",
    });
  }

  async calculateCancellationSplit(
    contractId: string,
    compensationRate: number,
  ): Promise<{
    refundAmount: number;
    settledAmount: number;
    clientFeeRefund: number;
    ongoingStagePaidFull: boolean;
  }> {
    const contract = await this.repo.getContract(contractId);
    if (!contract) throw new CancellationHttpError(404, "계약을 찾을 수 없습니다.");

    const installments = await this.repo.listInstallments(contract.id);
    const interim = installments.find((i) => i.stage === "INTERIM");
    const ongoingStageAmount = interim?.amount ?? Math.floor(contract.agreedAmount / 2);

    // C-06-T10: 진행 구간이 이미 납품(DELIVERED)되었으면 해당 구간 전액 지급
    const ongoingStagePaidFull = interim?.status === "DELIVERED";

    // 보상 원금 산정
    const compensationPrincipal = ongoingStagePaidFull
      ? ongoingStageAmount
      : Math.floor((ongoingStageAmount * compensationRate) / 100);

    const supplierFee = Math.floor((compensationPrincipal * 5) / 100);
    const settledAmount = compensationPrincipal - supplierFee;

    // 수수료 환급: 공급자 지급 확정액에만 양측 5%, 나머지 의뢰인 수수료 환불
    const clientFeeKept = supplierFee;
    const clientFeeRefund = contract.clientFee - clientFeeKept;

    // 의뢰인 환불액 = (총예치액 - 보상 원금 - 공급자 보상 수수료)
    // PRD §9.6: 3,255,000 - 775,000 - 38,750 = 2,441,250원
    const refundAmount = contract.totalDeposited - compensationPrincipal - supplierFee;

    return {
      refundAmount,
      settledAmount,
      clientFeeRefund,
      ongoingStagePaidFull,
    };
  }

  isOperationsPaused(contractId: string): boolean {
    return true; // CANCEL_REQUESTED 중에는 모든 작업 일시정지
  }

  async markProcessed(input: {
    contractId: string;
    operatorId: string;
    refunded: boolean;
    cancelPayout: boolean;
  }): Promise<CancellationContractEntity> {
    const contract = await this.repo.getContract(input.contractId);
    if (!contract) throw new CancellationHttpError(404, "계약을 찾을 수 없습니다.");

    const now = this.clock.now();
    return this.repo.updateContract(contract.id, {
      refundedAt: input.refunded ? now : contract.refundedAt,
      cancelPayoutAt: input.cancelPayout ? now : contract.cancelPayoutAt,
    });
  }
}
