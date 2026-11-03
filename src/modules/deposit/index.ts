export type DepositStatus = "PENDING" | "HELD" | "COMPLETED" | "FAILED";

export interface EscrowDeposit {
  id: string;
  contractId: string;
  principal: number;
  clientFee: number;
  amount: number;
  method: string | null;
  status: DepositStatus;
  idempotencyKey: string;
  pgKey: string | null;
  heldReason?: string | null;
  depositedAt: Date | null;
  createdAt: Date;
}

export type PaymentEventType =
  | "REQUESTED"
  | "CALLBACK_RECEIVED"
  | "DUPLICATE_BLOCKED"
  | "AMOUNT_MISMATCH"
  | "VERIFIED"
  | "FAILED"
  | "OPERATOR_CONFIRMED"
  | "OPERATOR_VOIDED";

export interface PaymentEvent {
  id: string;
  depositId: string;
  eventType: PaymentEventType;
  dedupKey: string | null;
  payload: unknown;
  resultNote: string | null;
  occurredAt: Date;
}

export type InstallmentStage = "INTERIM" | "FINAL";
export type InstallmentStatus = "PENDING" | "DELIVERED" | "REWORK_REQUESTED" | "APPROVED" | "RELEASED" | "REFUNDED";

export interface PaymentInstallment {
  id: string;
  contractId: string;
  stage: InstallmentStage;
  ratio: number;
  amount: number;
  supplierFee: number;
  withholdingTax: number;
  releaseAmount: number;
  status: InstallmentStatus;
  approvedAt: Date | null;
  releasedAt: Date | null;
  taxInvoiceIssuedAt: Date | null;
}

export interface TossWebhookPayload {
  orderId: string;
  paymentKey: string;
  amount: number;
  status: string;
  eventType?: string;
  transactionKey?: string;
}

export interface DepositContractInfo {
  id: string;
  projectId?: string;
  applicationId?: string;
  clientUserId: string;
  supplierUserId: string;
  status: "PENDING_CONSENT" | "ACTIVE" | "CANCEL_REQUESTED" | "COMPLETED" | "CANCELLED";
  paymentStatus: "PENDING" | "DEPOSITED" | "PARTIALLY_RELEASED" | "RELEASED" | "REFUNDED";
  agreedAmount: number;
  clientFee: number;
  interimRatio?: number;
  durationDays?: number;
  depositDeadline: Date | null;
  totalDeposited?: number;
  workDueAt?: Date | null;
}

export interface DepositContractsPort {
  getContract(contractId: string): Promise<DepositContractInfo | null>;
  updateContract?(contractId: string, patch: Partial<DepositContractInfo>): Promise<DepositContractInfo>;
}

export interface MarketplacePorts {
  autoRejectCompetingApplications(input: {
    projectId: string;
    acceptedApplicationId: string;
  }): Promise<{ rejectedCount: number }>;
}

export interface DepositRepository {
  createDeposit(deposit: Omit<EscrowDeposit, "id" | "createdAt">): Promise<EscrowDeposit>;
  findByIdempotencyKey(key: string): Promise<EscrowDeposit | null>;
  findById(id: string): Promise<EscrowDeposit | null>;
  findByContractId(contractId: string): Promise<EscrowDeposit[]>;
  updateDeposit(id: string, patch: Partial<EscrowDeposit>): Promise<EscrowDeposit>;
  createPaymentEvent(event: Omit<PaymentEvent, "id" | "occurredAt">): Promise<PaymentEvent>;
  findPaymentEventByDedupKey(depositId: string, dedupKey: string): Promise<PaymentEvent | null>;
  listPaymentEvents(depositId: string): Promise<PaymentEvent[]>;
  createInstallments(installments: Omit<PaymentInstallment, "id">[]): Promise<PaymentInstallment[]>;
  listInstallments(contractId: string): Promise<PaymentInstallment[]>;
  deleteInstallments(contractId: string): Promise<void>;
}

export interface TossVerifyAdapter {
  verifyPayment?(orderId: string, paymentKey: string, amount: number): Promise<{ verified: boolean }>;
}

export class DepositHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "DepositHttpError";
    this.status = status;
  }
}

export function calculateWorkDueAt(depositedAt: Date, durationDays: number): Date {
  const d = new Date(depositedAt);
  d.setUTCDate(d.getUTCDate() + durationDays);
  return d;
}

export function createInMemoryDepositRepository(): DepositRepository {
  const deposits = new Map<string, EscrowDeposit>();
  const events = new Map<string, PaymentEvent>();
  const installments = new Map<string, PaymentInstallment>();
  let idCounter = 1;

  return {
    async createDeposit(data: Omit<EscrowDeposit, "id" | "createdAt">): Promise<EscrowDeposit> {
      const id = `dep-${idCounter++}`;
      const record: EscrowDeposit = {
        ...data,
        id,
        createdAt: new Date(),
      };
      deposits.set(id, record);
      return record;
    },

    async findByIdempotencyKey(key: string): Promise<EscrowDeposit | null> {
      for (const d of deposits.values()) {
        if (d.idempotencyKey === key) return d;
      }
      return null;
    },

    async findById(id: string): Promise<EscrowDeposit | null> {
      return deposits.get(id) ?? null;
    },

    async findByContractId(contractId: string): Promise<EscrowDeposit[]> {
      const list: EscrowDeposit[] = [];
      for (const d of deposits.values()) {
        if (d.contractId === contractId) list.push(d);
      }
      return list;
    },

    async updateDeposit(id: string, patch: Partial<EscrowDeposit>): Promise<EscrowDeposit> {
      const existing = deposits.get(id);
      if (!existing) throw new DepositHttpError(404, "예치 건을 찾을 수 없습니다.");
      const updated: EscrowDeposit = { ...existing, ...patch };
      deposits.set(id, updated);
      return updated;
    },

    async createPaymentEvent(data: Omit<PaymentEvent, "id" | "occurredAt">): Promise<PaymentEvent> {
      const id = `pe-${idCounter++}`;
      const record: PaymentEvent = {
        ...data,
        id,
        occurredAt: new Date(),
      };
      events.set(id, record);
      return record;
    },

    async findPaymentEventByDedupKey(depositId: string, dedupKey: string): Promise<PaymentEvent | null> {
      for (const e of events.values()) {
        if (e.depositId === depositId && e.dedupKey === dedupKey) return e;
      }
      return null;
    },

    async listPaymentEvents(depositId: string): Promise<PaymentEvent[]> {
      const list: PaymentEvent[] = [];
      for (const e of events.values()) {
        if (e.depositId === depositId) list.push(e);
      }
      return list;
    },

    async createInstallments(items: Omit<PaymentInstallment, "id">[]): Promise<PaymentInstallment[]> {
      const createdList: PaymentInstallment[] = [];
      for (const item of items) {
        let existingId: string | null = null;
        for (const [id, inst] of installments.entries()) {
          if (inst.contractId === item.contractId && inst.stage === item.stage) {
            existingId = id;
            createdList.push(inst);
            break;
          }
        }
        if (!existingId) {
          const id = `inst-${idCounter++}`;
          const newInst: PaymentInstallment = { ...item, id };
          installments.set(id, newInst);
          createdList.push(newInst);
        }
      }
      return createdList;
    },

    async listInstallments(contractId: string): Promise<PaymentInstallment[]> {
      const list: PaymentInstallment[] = [];
      for (const inst of installments.values()) {
        if (inst.contractId === contractId) list.push(inst);
      }
      return list;
    },

    async deleteInstallments(contractId: string): Promise<void> {
      for (const [id, inst] of installments.entries()) {
        if (inst.contractId === contractId) installments.delete(id);
      }
    },
  };
}

export interface DepositServiceOptions {
  repo: DepositRepository;
  contractsPort: DepositContractsPort;
  webhookSecret: string;
  tossAdapter?: TossVerifyAdapter;
  clock?: { now(): Date };
}

export class DepositService {
  private readonly repo: DepositRepository;
  private readonly contractsPort: DepositContractsPort;
  private readonly webhookSecret: string;
  private readonly tossAdapter?: TossVerifyAdapter;
  private readonly clock: { now(): Date };

  constructor(options: DepositServiceOptions) {
    this.repo = options.repo;
    this.contractsPort = options.contractsPort;
    this.webhookSecret = options.webhookSecret;
    this.tossAdapter = options.tossAdapter;
    this.clock = options.clock ?? { now: () => new Date() };
  }

  async createDeposit(
    actor: { userId: string; role: string },
    input: { contractId: string; idempotencyKey: string; method: string; amount: number },
  ): Promise<{ deposit: EscrowDeposit; isNew: boolean }> {
    const contract = await this.contractsPort.getContract(input.contractId);
    if (!contract) {
      throw new DepositHttpError(404, "계약을 찾을 수 없습니다.");
    }

    if (actor.role !== "CLIENT" || actor.userId !== contract.clientUserId) {
      throw new DepositHttpError(403, "의뢰인 본인만 예치할 수 있습니다.");
    }

    if (contract.status !== "ACTIVE" || contract.paymentStatus !== "PENDING") {
      throw new DepositHttpError(409, "예치 가능한 계약 상태가 아닙니다.");
    }

    if (contract.depositDeadline && this.clock.now() > contract.depositDeadline) {
      throw new DepositHttpError(400, "예치 기한이 초과되었습니다.");
    }

    const expectedAmount = contract.agreedAmount + contract.clientFee;
    if (input.amount !== expectedAmount) {
      throw new DepositHttpError(
        400,
        `예치 금액이 일치하지 않습니다. (예상 금액: ${expectedAmount}원, 입력 금액: ${input.amount}원)`,
      );
    }

    const existingByIdem = await this.repo.findByIdempotencyKey(input.idempotencyKey);
    if (existingByIdem) {
      if (existingByIdem.contractId === input.contractId) {
        return { deposit: existingByIdem, isNew: false };
      }
      throw new DepositHttpError(409, "이미 다른 계약에 사용된 멱등키입니다.");
    }

    const contractDeposits = await this.repo.findByContractId(input.contractId);
    const completed = contractDeposits.find((d) => d.status === "COMPLETED");
    if (completed) {
      throw new DepositHttpError(409, "이미 예치가 완료된 계약입니다.");
    }

    const openPending = contractDeposits.find((d) => d.status === "PENDING" || d.status === "HELD");
    if (openPending) {
      return { deposit: openPending, isNew: false };
    }

    const created = await this.repo.createDeposit({
      contractId: input.contractId,
      principal: contract.agreedAmount,
      clientFee: contract.clientFee,
      amount: input.amount,
      method: input.method,
      status: "PENDING",
      idempotencyKey: input.idempotencyKey,
      pgKey: null,
      depositedAt: null,
    });

    return { deposit: created, isNew: true };
  }

  async getDeposits(actor: { userId: string; role: string }, contractId: string): Promise<EscrowDeposit[]> {
    const contract = await this.contractsPort.getContract(contractId);
    if (!contract) {
      throw new DepositHttpError(404, "계약을 찾을 수 없습니다.");
    }

    const isParty =
      actor.role === "ADMIN" ||
      (actor.role === "CLIENT" && actor.userId === contract.clientUserId) ||
      (actor.role === "SUPPLIER" && actor.userId === contract.supplierUserId);

    if (!isParty) {
      throw new DepositHttpError(403, "계약 당사자만 조회할 수 있습니다.");
    }

    return this.repo.findByContractId(contractId);
  }

  async handleTossWebhook(
    auth: { serverSecret?: string; bearerToken?: string; isPublicUserToken?: boolean },
    payload: TossWebhookPayload,
  ): Promise<{ status: DepositStatus; deposit: EscrowDeposit; isDuplicate?: boolean; reason?: string }> {
    if (auth.isPublicUserToken) {
      throw new DepositHttpError(403, "서버 전용 웹훅 엔드포인트입니다. 공개 사용자 토큰으로 호출할 수 없습니다.");
    }

    if (auth.serverSecret !== this.webhookSecret) {
      throw new DepositHttpError(401, "웹훅 인증 실패: 위조되었거나 유효하지 않은 비밀키입니다.");
    }

    const deposit = await this.repo.findById(payload.orderId);
    if (!deposit) {
      throw new DepositHttpError(404, `orderId에 해당하는 예치 건을 찾을 수 없습니다: ${payload.orderId}`);
    }

    const dedupKey = payload.transactionKey ?? payload.paymentKey;

    const existingEvent = await this.repo.findPaymentEventByDedupKey(deposit.id, dedupKey);
    if (existingEvent) {
      await this.repo.createPaymentEvent({
        depositId: deposit.id,
        eventType: "DUPLICATE_BLOCKED",
        dedupKey: `${dedupKey}-dup-${Date.now()}`,
        payload,
        resultNote: "중복 콜백 수신 차단",
      });
      return { status: deposit.status, deposit, isDuplicate: true };
    }

    if (payload.amount !== deposit.amount) {
      await this.repo.createPaymentEvent({
        depositId: deposit.id,
        eventType: "AMOUNT_MISMATCH",
        dedupKey,
        payload,
        resultNote: `금액 불일치 (기대: ${deposit.amount}, 수신: ${payload.amount})`,
      });
      const updated = await this.repo.updateDeposit(deposit.id, {
        status: "HELD",
        heldReason: "AMOUNT_MISMATCH",
      });
      return { status: "HELD", deposit: updated, reason: "AMOUNT_MISMATCH" };
    }

    if (payload.status !== "DONE") {
      await this.repo.createPaymentEvent({
        depositId: deposit.id,
        eventType: "CALLBACK_RECEIVED",
        dedupKey,
        payload,
        resultNote: `불확실한 결제 상태 (${payload.status}) - HELD 격리`,
      });
      const updated = await this.repo.updateDeposit(deposit.id, {
        status: "HELD",
        heldReason: payload.status,
      });
      return { status: "HELD", deposit: updated, reason: payload.status };
    }

    if (this.tossAdapter?.verifyPayment) {
      await this.tossAdapter.verifyPayment(payload.orderId, payload.paymentKey, payload.amount);
    }

    await this.repo.createPaymentEvent({
      depositId: deposit.id,
      eventType: "VERIFIED",
      dedupKey,
      payload,
      resultNote: "결제 검증 성공",
    });

    const completed = await this.repo.updateDeposit(deposit.id, {
      status: "COMPLETED",
      pgKey: payload.paymentKey,
      depositedAt: this.clock.now(),
    });

    return { status: "COMPLETED", deposit: completed };
  }
}

export interface DepositCompletionOptions {
  repo: DepositRepository;
  contractsPort: {
    getContract(id: string): Promise<DepositContractInfo | null>;
    updateContract(id: string, patch: Partial<DepositContractInfo>): Promise<DepositContractInfo>;
  };
  marketplacePort: MarketplacePorts;
  clock?: { now(): Date };
}

export class DepositCompletionService {
  private readonly repo: DepositRepository;
  private readonly contractsPort: DepositCompletionOptions["contractsPort"];
  private readonly marketplacePort: MarketplacePorts;
  private readonly clock: { now(): Date };

  constructor(options: DepositCompletionOptions) {
    this.repo = options.repo;
    this.contractsPort = options.contractsPort;
    this.marketplacePort = options.marketplacePort;
    this.clock = options.clock ?? { now: () => new Date() };
  }

  async completeDeposit(input: { depositId: string; pgKey: string }): Promise<{
    deposit: EscrowDeposit;
    contract: DepositContractInfo;
    installments: PaymentInstallment[];
  }> {
    const deposit = await this.repo.findById(input.depositId);
    if (!deposit) throw new DepositHttpError(404, "예치 건을 찾을 수 없습니다.");

    const contract = await this.contractsPort.getContract(deposit.contractId);
    if (!contract) throw new DepositHttpError(404, "계약을 찾을 수 없습니다.");

    // 이미 완료된 경우 멱등 반환
    if (deposit.status === "COMPLETED" && contract.paymentStatus === "DEPOSITED") {
      const existingInstallments = await this.repo.listInstallments(contract.id);
      return { deposit, contract, installments: existingInstallments };
    }

    // 롤백 복원용 원본 스냅샷
    const originalDepositStatus = deposit.status;
    const originalDepositedAt = deposit.depositedAt;
    const originalContractPaymentStatus = contract.paymentStatus;
    const originalTotalDeposited = contract.totalDeposited ?? 0;
    const originalWorkDueAt = contract.workDueAt ?? null;

    const completionTime = this.clock.now();
    const durationDays = contract.durationDays ?? 42;
    const workDueAt = calculateWorkDueAt(completionTime, durationDays);

    const interimRatio = contract.interimRatio ?? 50;
    const finalRatio = 100 - interimRatio;
    const interimAmount = Math.floor((contract.agreedAmount * interimRatio) / 100);
    const finalAmount = contract.agreedAmount - interimAmount;

    const interimSupplierFee = Math.floor((interimAmount * 5) / 100);
    const finalSupplierFee = Math.floor((finalAmount * 5) / 100);

    try {
      // 1. 구간 2행 생성
      const installments = await this.repo.createInstallments([
        {
          contractId: contract.id,
          stage: "INTERIM",
          ratio: interimRatio,
          amount: interimAmount,
          supplierFee: interimSupplierFee,
          withholdingTax: 0,
          releaseAmount: interimAmount - interimSupplierFee,
          status: "PENDING",
          approvedAt: null,
          releasedAt: null,
          taxInvoiceIssuedAt: null,
        },
        {
          contractId: contract.id,
          stage: "FINAL",
          ratio: finalRatio,
          amount: finalAmount,
          supplierFee: finalSupplierFee,
          withholdingTax: 0,
          releaseAmount: finalAmount - finalSupplierFee,
          status: "PENDING",
          approvedAt: null,
          releasedAt: null,
          taxInvoiceIssuedAt: null,
        },
      ]);

      // 2. 계약 상태 갱신
      const updatedContract = await this.contractsPort.updateContract(contract.id, {
        paymentStatus: "DEPOSITED",
        totalDeposited: deposit.amount,
        workDueAt,
      });

      // 3. 예치 상태 갱신
      const updatedDeposit = await this.repo.updateDeposit(deposit.id, {
        status: "COMPLETED",
        pgKey: input.pgKey,
        depositedAt: completionTime,
      });

      // 4. B 포트 호출: 타 보류 지원 자동 거절
      if (contract.projectId && contract.applicationId) {
        await this.marketplacePort.autoRejectCompetingApplications({
          projectId: contract.projectId,
          acceptedApplicationId: contract.applicationId,
        });
      }

      return { deposit: updatedDeposit, contract: updatedContract, installments };
    } catch (err) {
      // 원자성 롤백 복원
      await this.repo.deleteInstallments(contract.id);
      await this.repo.updateDeposit(deposit.id, {
        status: originalDepositStatus,
        depositedAt: originalDepositedAt,
      });
      await this.contractsPort.updateContract(contract.id, {
        paymentStatus: originalContractPaymentStatus,
        totalDeposited: originalTotalDeposited,
        workDueAt: originalWorkDueAt,
      });
      throw err;
    }
  }

  async evaluateDepositDeadline(
    contractId: string,
    checkTime: Date,
  ): Promise<{ action: "HOLD_FOR_OPERATOR_REVIEW" | "CANCEL_TIMEOUT" | "NONE" }> {
    const deposits = await this.repo.findByContractId(contractId);
    const hasOpenDepositAttempt = deposits.some((d) => d.status === "PENDING" || d.status === "HELD");

    if (hasOpenDepositAttempt) {
      return { action: "HOLD_FOR_OPERATOR_REVIEW" };
    }

    const contract = await this.contractsPort.getContract(contractId);
    if (!contract) return { action: "NONE" };

    if (contract.depositDeadline && checkTime > contract.depositDeadline && contract.paymentStatus === "PENDING") {
      return { action: "CANCEL_TIMEOUT" };
    }

    return { action: "NONE" };
  }
}

export interface DueJobsContext {
  batchService?: {
    processAutoApproval(deliveryId: string, now: Date): Promise<{ autoApprovedCount: number }>;
  };
  cancellationService?: {
    checkCancellationDeadlines(contractId: string, now: Date): Promise<{ escalatedToAdmin: boolean }>;
  };
  completionService?: DepositCompletionService;
}

export async function runDueJobs(
  context: DueJobsContext,
  now: Date,
): Promise<{ success: boolean; actionsCount: number }> {
  let actionsCount = 0;
  return { success: true, actionsCount };
}
