import { createHash, timingSafeEqual } from "node:crypto";
import { endOfKstDayPlus, requireDepositContractTerms, splitInstallments } from "../settlement/policy.ts";

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
  interimRatio?: number | null;
  durationDays?: number | null;
  depositDeadline: Date | null;
  totalDeposited?: number;
  workDueAt?: Date | null;
}

export interface DepositContractsPort {
  getContract(contractId: string, tx?: DepositTransaction): Promise<DepositContractInfo | null>;
  updateContract?(
    contractId: string,
    patch: Partial<DepositContractInfo>,
    tx?: DepositTransaction,
  ): Promise<DepositContractInfo>;
  /**
   * 예치 기한 만료 시 조건부 취소. 예치 완료가 먼저 커밋됐으면 false를 돌려준다.
   * 미구현 어댑터는 `updateContract`로 폴백한다(기존 동작).
   */
  cancelIfUnpaid?(contractId: string, tx?: DepositTransaction): Promise<boolean>;
}

export interface MarketplacePorts {
  autoRejectCompetingApplications(
    input: {
      projectId: string;
      acceptedApplicationId: string;
      now: Date;
    },
    tx?: DepositTransaction,
  ): Promise<{ rejectedCount: number }>;
}

/**
 * Opaque handle owned by the integration layer (e.g. a Prisma transaction client).
 * C only guarantees it is the same reference for every write in one deposit completion.
 */
export interface DepositTransaction {
  readonly id?: string;
}

export interface DepositTransactionRunner {
  run<T>(work: (tx: DepositTransaction) => Promise<T>): Promise<T>;
}

export interface DepositRepository {
  createDeposit(deposit: Omit<EscrowDeposit, "id" | "createdAt">, tx?: DepositTransaction): Promise<EscrowDeposit>;
  findByIdempotencyKey(key: string, tx?: DepositTransaction): Promise<EscrowDeposit | null>;
  findById(id: string, tx?: DepositTransaction): Promise<EscrowDeposit | null>;
  findByContractId(contractId: string, tx?: DepositTransaction): Promise<EscrowDeposit[]>;
  updateDeposit(id: string, patch: Partial<EscrowDeposit>, tx?: DepositTransaction): Promise<EscrowDeposit>;
  createPaymentEvent(
    event: Omit<PaymentEvent, "id" | "occurredAt">,
    tx?: DepositTransaction,
  ): Promise<PaymentEvent>;
  findPaymentEventByDedupKey(
    depositId: string,
    dedupKey: string,
    tx?: DepositTransaction,
  ): Promise<PaymentEvent | null>;
  listPaymentEvents(depositId: string, tx?: DepositTransaction): Promise<PaymentEvent[]>;
  createInstallments(
    installments: Omit<PaymentInstallment, "id">[],
    tx?: DepositTransaction,
  ): Promise<PaymentInstallment[]>;
  listInstallments(contractId: string, tx?: DepositTransaction): Promise<PaymentInstallment[]>;
  deleteInstallments(contractId: string, tx?: DepositTransaction): Promise<void>;
}

export interface TossVerifyAdapter {
  verifyPayment?(orderId: string, paymentKey: string, amount: number): Promise<unknown>;
}

export interface DepositCompletionPort {
  completeDeposit(input: {
    depositId: string;
    pgKey: string;
    paymentEvent: { dedupKey: string; payload: TossWebhookPayload };
  }): Promise<{
    deposit: EscrowDeposit;
    contract: DepositContractInfo;
    installments: PaymentInstallment[];
  }>;
}

function webhookSecretMatches(provided: unknown, expected: string): boolean {
  if (typeof provided !== "string" || expected.length === 0) return false;
  const providedDigest = createHash("sha256").update(provided, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

function parseTossWebhookPayload(value: unknown): TossWebhookPayload | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const { orderId, paymentKey, amount, status, eventType, transactionKey } = candidate;
  if (
    typeof orderId !== "string" || orderId.trim().length === 0 ||
    typeof paymentKey !== "string" || paymentKey.trim().length === 0 ||
    typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0 ||
    typeof status !== "string" || status.trim().length === 0 ||
    (eventType !== undefined && typeof eventType !== "string") ||
    (transactionKey !== undefined && (typeof transactionKey !== "string" || transactionKey.trim().length === 0))
  ) {
    return null;
  }
  return {
    orderId,
    paymentKey,
    amount,
    status,
    ...(eventType === undefined ? {} : { eventType }),
    ...(transactionKey === undefined ? {} : { transactionKey }),
  };
}

function pgEvidenceRejects(evidence: unknown, payload: TossWebhookPayload): boolean {
  if (typeof evidence !== "object" || evidence === null || Array.isArray(evidence)) return true;
  const result = evidence as Record<string, unknown>;
  return result.verified !== true ||
    result.orderId !== payload.orderId ||
    result.paymentKey !== payload.paymentKey ||
    result.amount !== payload.amount ||
    result.status !== "DONE";
}

export class DepositHttpError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "DepositHttpError";
    this.status = status;
    this.code = code;
  }
}

export function calculateWorkDueAt(depositedAt: Date, durationDays: number): Date {
  return endOfKstDayPlus(depositedAt, durationDays);
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
  completionPort: DepositCompletionPort;
  clock?: { now(): Date };
}

export class DepositService {
  private readonly repo: DepositRepository;
  private readonly contractsPort: DepositContractsPort;
  private readonly webhookSecret: string;
  private readonly tossAdapter?: TossVerifyAdapter;
  private readonly completionPort: DepositCompletionPort;
  private readonly clock: { now(): Date };
  private readonly depositTails = new Map<string, Promise<void>>();

  constructor(options: DepositServiceOptions) {
    this.repo = options.repo;
    this.contractsPort = options.contractsPort;
    this.webhookSecret = options.webhookSecret;
    this.tossAdapter = options.tossAdapter;
    if (!options.completionPort) throw new Error("DepositCompletionPort is required");
    this.completionPort = options.completionPort;
    this.clock = options.clock ?? { now: () => new Date() };
  }

  private async withDepositLock<T>(depositId: string, work: () => Promise<T>): Promise<T> {
    // shortcut: protects one process only; use a database transaction for multi-instance deployment.
    const previous = this.depositTails.get(depositId) ?? Promise.resolve();
    let release: () => void = () => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current, () => current);
    this.depositTails.set(depositId, tail);
    await previous.then(() => undefined, () => undefined);
    try {
      return await work();
    } finally {
      release();
      if (this.depositTails.get(depositId) === tail) this.depositTails.delete(depositId);
    }
  }

  async createDeposit(
    actor: { userId: string; role: string },
    input: { contractId: string; idempotencyKey: string; method: string; amount: number },
  ): Promise<{ deposit: EscrowDeposit; isNew: boolean }> {
    const contract = await this.contractsPort.getContract(input.contractId);
    if (!contract) {
      throw new DepositHttpError(404, "계약을 찾을 수 없습니다.", "CONTRACT_NOT_FOUND");
    }

    if (actor.role !== "CLIENT" || actor.userId !== contract.clientUserId) {
      throw new DepositHttpError(403, "의뢰인 본인만 예치할 수 있습니다.", "CLIENT_ONLY");
    }

    if (contract.status !== "ACTIVE" || contract.paymentStatus !== "PENDING") {
      throw new DepositHttpError(409, "예치 가능한 계약 상태가 아닙니다.", "CONTRACT_NOT_DEPOSITABLE");
    }

    if (contract.depositDeadline && this.clock.now() > contract.depositDeadline) {
      throw new DepositHttpError(400, "예치 기한이 초과되었습니다.", "DEPOSIT_DEADLINE_EXPIRED");
    }

    const expectedAmount = contract.agreedAmount + contract.clientFee;
    if (input.amount !== expectedAmount) {
      throw new DepositHttpError(
        400,
        `예치 금액이 일치하지 않습니다. (예상 금액: ${expectedAmount}원, 입력 금액: ${input.amount}원)`,
        "AMOUNT_MISMATCH",
      );
    }

    const existingByIdem = await this.repo.findByIdempotencyKey(input.idempotencyKey);
    if (existingByIdem) {
      if (existingByIdem.contractId === input.contractId) {
        return { deposit: existingByIdem, isNew: false };
      }
      throw new DepositHttpError(409, "이미 다른 계약에 사용된 멱등키입니다.", "IDEMPOTENCY_KEY_REUSED");
    }

    const contractDeposits = await this.repo.findByContractId(input.contractId);
    const completed = contractDeposits.find((d) => d.status === "COMPLETED");
    if (completed) {
      throw new DepositHttpError(409, "이미 예치가 완료된 계약입니다.", "DEPOSIT_ALREADY_COMPLETED");
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
      throw new DepositHttpError(404, "계약을 찾을 수 없습니다.", "CONTRACT_NOT_FOUND");
    }

    const isParty =
      actor.role === "ADMIN" ||
      (actor.role === "CLIENT" && actor.userId === contract.clientUserId) ||
      (actor.role === "SUPPLIER" && actor.userId === contract.supplierUserId);

    if (!isParty) {
      throw new DepositHttpError(403, "계약 당사자만 조회할 수 있습니다.", "FORBIDDEN");
    }

    return this.repo.findByContractId(contractId);
  }

  async handleTossWebhook(
    auth: { serverSecret?: string; bearerToken?: string; isPublicUserToken?: boolean },
    rawPayload: unknown,
  ): Promise<{ status: DepositStatus; deposit: EscrowDeposit; isDuplicate?: boolean; reason?: string }> {
    if (auth.isPublicUserToken) {
      throw new DepositHttpError(403, "서버 전용 웹훅 엔드포인트입니다. 공개 사용자 토큰으로 호출할 수 없습니다.", "WEBHOOK_FORBIDDEN");
    }

    if (!webhookSecretMatches(auth.serverSecret, this.webhookSecret)) {
      throw new DepositHttpError(401, "웹훅 인증 실패: 위조되었거나 유효하지 않은 비밀키입니다.", "WEBHOOK_AUTH_FAILED");
    }
    const payload = parseTossWebhookPayload(rawPayload);
    if (!payload) throw new DepositHttpError(400, "웹훅 본문이 올바르지 않습니다.", "INVALID_WEBHOOK_PAYLOAD");

    return this.withDepositLock(payload.orderId, async () => {
      const deposit = await this.repo.findById(payload.orderId);
      if (!deposit) {
        throw new DepositHttpError(404, `orderId에 해당하는 예치 건을 찾을 수 없습니다: ${payload.orderId}`);
      }
      if (deposit.status === "COMPLETED") {
        return { status: "COMPLETED" as const, deposit, isDuplicate: true };
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
        const current = (await this.repo.findById(deposit.id)) ?? deposit;
        return { status: current.status, deposit: current, isDuplicate: true };
      }
      if (deposit.status === "HELD") {
        return { status: "HELD" as const, deposit, reason: deposit.heldReason ?? "HELD" };
      }

      const contract = await this.contractsPort.getContract(deposit.contractId);
      if (!contract) throw new DepositHttpError(404, "계약을 찾을 수 없습니다.", "CONTRACT_NOT_FOUND");
      if (contract.depositDeadline !== null && this.clock.now().getTime() > contract.depositDeadline.getTime()) {
        return this.holdDeposit(deposit, dedupKey, payload, "DEPOSIT_EXPIRED", "예치 기한이 지난 콜백");
      }
      if (contract.status !== "ACTIVE" || contract.paymentStatus !== "PENDING") {
        return this.holdDeposit(deposit, dedupKey, payload, "CONTRACT_NOT_DEPOSITABLE", "예치 가능한 계약 상태가 아님");
      }
      if (payload.amount !== deposit.amount) {
        return this.holdDeposit(
          deposit,
          dedupKey,
          payload,
          "AMOUNT_MISMATCH",
          `금액 불일치 (기대: ${deposit.amount}, 수신: ${payload.amount})`,
          "AMOUNT_MISMATCH",
        );
      }
      if (payload.status !== "DONE") {
        return this.holdDeposit(
          deposit,
          dedupKey,
          payload,
          payload.status,
          `불확실한 결제 상태 (${payload.status}) - HELD 격리`,
          "CALLBACK_RECEIVED",
        );
      }
      if (!this.tossAdapter?.verifyPayment) {
        return this.holdDeposit(deposit, dedupKey, payload, "VERIFY_UNAVAILABLE", "PG 재조회 없음");
      }

      let evidence: unknown;
      try {
        evidence = await this.tossAdapter.verifyPayment(payload.orderId, payload.paymentKey, payload.amount);
      } catch {
        evidence = { verified: false };
      }
      if (pgEvidenceRejects(evidence, payload)) {
        return this.holdDeposit(deposit, dedupKey, payload, "VERIFY_FAILED", "PG 재조회 검증 실패");
      }

      const current = (await this.repo.findById(deposit.id)) ?? deposit;
      if (current.status === "COMPLETED") {
        return { status: "COMPLETED" as const, deposit: current, isDuplicate: true };
      }
      if (current.status === "HELD") {
        return { status: "HELD" as const, deposit: current, reason: current.heldReason ?? "HELD" };
      }

      const { deposit: completedDeposit } = await this.completionPort.completeDeposit({
        depositId: deposit.id,
        pgKey: payload.paymentKey,
        paymentEvent: { dedupKey, payload },
      });
      return { status: "COMPLETED" as const, deposit: completedDeposit };
    });
  }

  private async holdDeposit(
    deposit: EscrowDeposit,
    dedupKey: string,
    payload: TossWebhookPayload,
    reason: string,
    resultNote: string,
    eventType: PaymentEventType = "FAILED",
  ): Promise<{ status: DepositStatus; deposit: EscrowDeposit; reason: string }> {
    await this.repo.createPaymentEvent({
      depositId: deposit.id,
      eventType,
      dedupKey,
      payload,
      resultNote,
    });
    const updated = await this.repo.updateDeposit(deposit.id, {
      status: "HELD",
      heldReason: reason,
    });
    return { status: "HELD", deposit: updated, reason };
  }
}

export interface DepositCompletionOptions {
  repo: DepositRepository;
  contractsPort: {
    getContract(id: string, tx?: DepositTransaction): Promise<DepositContractInfo | null>;
    updateContract(
      id: string,
      patch: Partial<DepositContractInfo>,
      tx?: DepositTransaction,
    ): Promise<DepositContractInfo>;
    cancelIfUnpaid?(id: string, tx?: DepositTransaction): Promise<boolean>;
  };
  marketplacePort: MarketplacePorts;
  transactionRunner?: DepositTransactionRunner;
  tossAdapter?: TossVerifyAdapter;
  clock?: { now(): Date };
}

export class DepositCompletionService {
  private readonly repo: DepositRepository;
  private readonly contractsPort: DepositCompletionOptions["contractsPort"];
  private readonly marketplacePort: MarketplacePorts;
  private readonly transactionRunner?: DepositTransactionRunner;
  private readonly tossAdapter?: TossVerifyAdapter;
  private readonly clock: { now(): Date };

  constructor(options: DepositCompletionOptions) {
    this.repo = options.repo;
    this.contractsPort = options.contractsPort;
    this.marketplacePort = options.marketplacePort;
    this.transactionRunner = options.transactionRunner;
    this.tossAdapter = options.tossAdapter;
    this.clock = options.clock ?? { now: () => new Date() };
  }

  async completeDeposit(input: {
    depositId: string;
    pgKey: string;
    paymentEvent?: { dedupKey: string; payload: TossWebhookPayload };
  }): Promise<{
    deposit: EscrowDeposit;
    contract: DepositContractInfo;
    installments: PaymentInstallment[];
  }> {
    // 통합 담당이 Prisma 트랜잭션을 주입하면 모든 쓰기가 같은 컨텍스트로 묶인다.
    if (this.transactionRunner) {
      return this.transactionRunner.run((tx) => this.executeCompletion(input, tx));
    }
    return this.executeCompletion(input);
  }

  private async executeCompletion(
    input: {
      depositId: string;
      pgKey: string;
      paymentEvent?: { dedupKey: string; payload: TossWebhookPayload };
    },
    tx?: DepositTransaction,
  ): Promise<{
    deposit: EscrowDeposit;
    contract: DepositContractInfo;
    installments: PaymentInstallment[];
  }> {
    const deposit = await this.repo.findById(input.depositId, tx);
    if (!deposit) throw new DepositHttpError(404, "예치 건을 찾을 수 없습니다.");

    const contract = await this.contractsPort.getContract(deposit.contractId, tx);
    if (!contract) throw new DepositHttpError(404, "계약을 찾을 수 없습니다.", "CONTRACT_NOT_FOUND");

    // 이미 완료된 경우 멱등 반환
    if (deposit.status === "COMPLETED" && contract.paymentStatus === "DEPOSITED") {
      const existingInstallments = await this.repo.listInstallments(contract.id, tx);
      return { deposit, contract, installments: existingInstallments };
    }

    // 롤백 복원용 원본 스냅샷
    const originalDepositStatus = deposit.status;
    const originalDepositedAt = deposit.depositedAt;
    const originalPgKey = deposit.pgKey;
    const originalContractPaymentStatus = contract.paymentStatus;
    const originalTotalDeposited = contract.totalDeposited ?? 0;
    const originalWorkDueAt = contract.workDueAt ?? null;

    const completionTime = this.clock.now();
    const terms = requireDepositContractTerms(contract);
    const durationDays = terms.durationDays;
    const workDueAt = calculateWorkDueAt(completionTime, durationDays);

    const interimRatio = terms.interimRatio;
    const split = splitInstallments(contract.agreedAmount, interimRatio);
    const finalRatio = 100 - interimRatio;
    const interimAmount = split.interimAmount;
    const finalAmount = split.finalAmount;

    const interimSupplierFee = Math.floor((interimAmount * 5) / 100);
    const finalSupplierFee = Math.floor((finalAmount * 5) / 100);

    try {
      // 1. 구간 2행 생성
      const installments = await this.repo.createInstallments(
        [
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
        ],
        tx,
      );

      // 2. 계약 상태 갱신
      const updatedContract = await this.contractsPort.updateContract(
        contract.id,
        {
          paymentStatus: "DEPOSITED",
          totalDeposited: deposit.amount,
          workDueAt,
        },
        tx,
      );

      // 3. 예치 상태 갱신
      const updatedDeposit = await this.repo.updateDeposit(
        deposit.id,
        {
          status: "COMPLETED",
          pgKey: input.pgKey,
          depositedAt: completionTime,
        },
        tx,
      );

      // 4. B 포트 호출: 타 보류 지원 자동 거절
      if (contract.projectId && contract.applicationId) {
        await this.marketplacePort.autoRejectCompetingApplications(
          {
            projectId: contract.projectId,
            acceptedApplicationId: contract.applicationId,
            now: completionTime,
          },
          tx,
        );
      }

      if (input.paymentEvent) {
        await this.repo.createPaymentEvent(
          {
            depositId: deposit.id,
            eventType: "VERIFIED",
            dedupKey: input.paymentEvent.dedupKey,
            payload: input.paymentEvent.payload,
            resultNote: "결제 검증 성공",
          },
          tx,
        );
      }

      return { deposit: updatedDeposit, contract: updatedContract, installments };
    } catch (err) {
      // 트랜잭션 컨텍스트가 없을 때만 메모리 보상 쓰기로 되돌린다.
      // ponytail: in-memory 보상은 단일 프로세스 한정. DB에서는 transactionRunner가 원자성을 보장한다.
      if (!tx) {
        await this.repo.deleteInstallments(contract.id);
        await this.repo.updateDeposit(deposit.id, {
          status: originalDepositStatus,
          depositedAt: originalDepositedAt,
          pgKey: originalPgKey,
        });
        await this.contractsPort.updateContract(contract.id, {
          paymentStatus: originalContractPaymentStatus,
          totalDeposited: originalTotalDeposited,
          workDueAt: originalWorkDueAt,
        });
      }
      throw err;
    }
  }

  async resolveHeldDeposit(input: {
    depositId: string;
    decision: "OPERATOR_CONFIRMED" | "OPERATOR_VOIDED";
    reason: string;
    actorUserId?: string;
    paymentKey?: string;
  }): Promise<{
    deposit: EscrowDeposit;
    deadline: { expired: boolean };
    contract?: DepositContractInfo;
    installments?: PaymentInstallment[];
  }> {
    if (!input.reason || input.reason.trim().length === 0) {
      throw new DepositHttpError(400, "운영자 조치 사유는 필수입니다.");
    }
    const deposit = await this.repo.findById(input.depositId);
    if (!deposit) throw new DepositHttpError(404, "예치 건을 찾을 수 없습니다.");

    if (input.decision === "OPERATOR_CONFIRMED") {
      return this.confirmHeldDeposit(deposit, input);
    }

    if (deposit.status === "COMPLETED") {
      throw new DepositHttpError(409, "이미 완료된 예치 건은 무효 처리할 수 없습니다.");
    }
    if (deposit.status !== "HELD" && deposit.status !== "FAILED") {
      throw new DepositHttpError(409, "보류(HELD) 상태의 예치만 운영자 판정할 수 있습니다.");
    }

    let updated = deposit;
    if (deposit.status === "HELD") {
      const dedupKey = `operator-voided:${deposit.id}`;
      const existing = await this.repo.findPaymentEventByDedupKey(deposit.id, dedupKey);
      if (!existing) {
        await this.repo.createPaymentEvent({
          depositId: deposit.id,
          eventType: "OPERATOR_VOIDED",
          dedupKey,
          payload: { reason: input.reason, actorUserId: input.actorUserId ?? null },
          resultNote: input.reason,
        });
      }
      updated = await this.repo.updateDeposit(deposit.id, {
        status: "FAILED",
        heldReason: input.reason,
      });
    }

    // 예치 시도가 닫혔으므로 기한 판정을 다시 실행한다(기한 경과 시 계약 결렬).
    const { expired } = await this.expireDepositIfDue(deposit.contractId, this.clock.now());
    return { deposit: updated, deadline: { expired } };
  }

  private async confirmHeldDeposit(
    deposit: EscrowDeposit,
    input: { reason: string; actorUserId?: string; paymentKey?: string },
  ): Promise<{
    deposit: EscrowDeposit;
    deadline: { expired: boolean };
    contract?: DepositContractInfo;
    installments?: PaymentInstallment[];
  }> {
    if (deposit.status === "COMPLETED") {
      return { deposit, deadline: { expired: false } };
    }
    if (deposit.status !== "HELD") {
      throw new DepositHttpError(409, "보류(HELD) 상태의 예치만 운영자 확정할 수 있습니다.");
    }
    if (!input.paymentKey) {
      throw new DepositHttpError(400, "PG 재조회를 위한 paymentKey가 필요합니다.");
    }
    if (!this.tossAdapter?.verifyPayment) {
      throw new DepositHttpError(422, "PG 거래 근거 없이는 예치를 확정할 수 없습니다.");
    }

    const payload: TossWebhookPayload = {
      orderId: deposit.id,
      paymentKey: input.paymentKey,
      amount: deposit.amount,
      status: "DONE",
    };
    let evidence: unknown;
    try {
      evidence = await this.tossAdapter.verifyPayment(deposit.id, input.paymentKey, deposit.amount);
    } catch {
      evidence = { verified: false };
    }
    if (pgEvidenceRejects(evidence, payload)) {
      throw new DepositHttpError(422, "PG 거래 근거를 확인할 수 없어 예치를 확정할 수 없습니다.");
    }

    const dedupKey = `operator-confirmed:${deposit.id}`;
    const existing = await this.repo.findPaymentEventByDedupKey(deposit.id, dedupKey);
    if (!existing) {
      await this.repo.createPaymentEvent({
        depositId: deposit.id,
        eventType: "OPERATOR_CONFIRMED",
        dedupKey,
        payload: { reason: input.reason, actorUserId: input.actorUserId ?? null, paymentKey: input.paymentKey },
        resultNote: input.reason,
      });
    }

    const completion = await this.completeDeposit({
      depositId: deposit.id,
      pgKey: input.paymentKey,
      paymentEvent: { dedupKey: `${dedupKey}:verified`, payload },
    });
    return { ...completion, deadline: { expired: false } };
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

  async expireDepositIfDue(contractId: string, now: Date): Promise<{ expired: boolean }> {
    const contract = await this.contractsPort.getContract(contractId);
    if (!contract || contract.status === "CANCELLED" || contract.paymentStatus !== "PENDING") {
      return { expired: false };
    }
    const decision = await this.evaluateDepositDeadline(contractId, now);
    if (decision.action !== "CANCEL_TIMEOUT") return { expired: false };
    // 예치 완료가 먼저 커밋됐으면 paymentStatus 조건부 갱신이 0행이 되어 취소하지 않는다.
    if (this.contractsPort.cancelIfUnpaid !== undefined) {
      return { expired: await this.contractsPort.cancelIfUnpaid(contractId) };
    }
    await this.contractsPort.updateContract(contractId, { status: "CANCELLED" });
    return { expired: true };
  }
}

export interface DueJobTargets {
  depositContractIds?(now: Date): Promise<readonly string[]>;
  cancellationContractIds?(now: Date): Promise<readonly string[]>;
  deliveryIds?(now: Date): Promise<readonly string[]>;
  notificationContractIds?(now: Date): Promise<readonly string[]>;
}

export interface DueJobFailure {
  job:
    | "PROJECT_DEADLINE"
    | "CONTRACT_BREAK"
    | "DEPOSIT_DEADLINE"
    | "CANCELLATION_DEADLINE"
    | "AUTO_APPROVAL"
    | "DUE_NOTIFICATION";
  targetId: string;
  attempts: number;
  error: string;
}

export interface DueJobResult {
  success: boolean;
  actionsCount: number;
  failures: DueJobFailure[];
}

export interface DueJobsContext {
  /** A: 모집 시작/마감·선택 기간 종료 배치. */
  projectDeadlines?(now: Date): Promise<{ recruiting: number; selecting: number; expired: number }>;
  /** B: 서명 7일·예치 3일 경과 계약 결렬 배치. */
  contractBreaks?(now: Date): Promise<number>;
  batchService?: {
    processAutoApproval(deliveryId: string, now: Date): Promise<{ autoApprovedCount: number }>;
    sendDueNotifications?(contractId: string, now: Date): Promise<void>;
  };
  cancellationService?: {
    checkCancellationDeadlines(contractId: string, now: Date): Promise<{ escalatedToAdmin: boolean }>;
  };
  completionService?: {
    expireDepositIfDue(contractId: string, now: Date): Promise<{ expired: boolean }>;
  };
  depositContractIds?: readonly string[];
  cancellationContractIds?: readonly string[];
  deliveryIds?: readonly string[];
  notificationContractIds?: readonly string[];
  targets?: DueJobTargets;
  /** 첫 실패 후 추가 재시도 횟수. 기본 1회. */
  retries?: number;
}

async function withRetry<T>(
  job: DueJobFailure["job"],
  targetId: string,
  work: () => Promise<T>,
  retries: number,
  failures: DueJobFailure[],
): Promise<T | null> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      return await work();
    } catch (err) {
      lastError = err;
    }
  }
  failures.push({
    job,
    targetId,
    attempts: retries + 1,
    error: lastError instanceof Error ? lastError.message : String(lastError),
  });
  return null;
}

export async function runDueJobs(context: DueJobsContext, now: Date): Promise<DueJobResult> {
  let actionsCount = 0;
  const failures: DueJobFailure[] = [];
  const retries = context.retries ?? 1;

  if (context.projectDeadlines) {
    const result = await withRetry("PROJECT_DEADLINE", "all", () => context.projectDeadlines!(now), retries, failures);
    if (result !== null) actionsCount += result.recruiting + result.selecting + result.expired;
  }

  if (context.contractBreaks) {
    const broken = await withRetry("CONTRACT_BREAK", "all", () => context.contractBreaks!(now), retries, failures);
    if (broken !== null) actionsCount += broken;
  }

  const depositIds =
    context.depositContractIds ?? (await context.targets?.depositContractIds?.(now)) ?? [];
  const cancellationIds =
    context.cancellationContractIds ??
    (await context.targets?.cancellationContractIds?.(now)) ??
    [];
  const deliveryIds = context.deliveryIds ?? (await context.targets?.deliveryIds?.(now)) ?? [];
  const notificationIds =
    context.notificationContractIds ??
    (await context.targets?.notificationContractIds?.(now)) ??
    [];

  if (context.completionService) {
    for (const contractId of depositIds) {
      const result = await withRetry(
        "DEPOSIT_DEADLINE",
        contractId,
        () => context.completionService!.expireDepositIfDue(contractId, now),
        retries,
        failures,
      );
      if (result?.expired) actionsCount += 1;
    }
  }

  if (context.cancellationService) {
    for (const contractId of cancellationIds) {
      const result = await withRetry(
        "CANCELLATION_DEADLINE",
        contractId,
        () => context.cancellationService!.checkCancellationDeadlines(contractId, now),
        retries,
        failures,
      );
      if (result?.escalatedToAdmin) actionsCount += 1;
    }
  }

  if (context.batchService) {
    for (const deliveryId of deliveryIds) {
      const result = await withRetry(
        "AUTO_APPROVAL",
        deliveryId,
        () => context.batchService!.processAutoApproval(deliveryId, now),
        retries,
        failures,
      );
      if (result) actionsCount += result.autoApprovedCount;
    }

    if (context.batchService.sendDueNotifications) {
      for (const contractId of notificationIds) {
        await withRetry(
          "DUE_NOTIFICATION",
          contractId,
          () => context.batchService!.sendDueNotifications!(contractId, now),
          retries,
          failures,
        );
      }
    }
  }

  return { success: failures.length === 0, actionsCount, failures };
}
