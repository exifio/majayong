export class AdminHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "AdminHttpError";
    this.status = status;
  }
}

export interface AdminBlock {
  id: string;
  title: string;
  unitPrice: number;
  isActive: boolean;
  mergedIntoId?: string | null;
}

export interface AdminHeldDeposit {
  id: string;
  contractId: string;
  amount: number;
  status: "HELD" | "COMPLETED" | "FAILED";
  heldReason: string;
}

export interface AdminEscalatedInspection {
  id: string;
  contractItemId: string;
  deliveryId: string;
  status: "ESCALATED" | "RESOLVED";
  reason: string;
  decision?: "REWORK_VALID" | "APPROVE" | "UNDECIDED_CONDITION";
  decisionNotes?: { client: string; supplier: string };
}

export interface AdminCancellationContract {
  id: string;
  status: string;
  cancelCause: string;
  totalDeposited: number;
  agreedAmount: number;
  clientFee: number;
  refundAmount?: number | null;
  settledAmount?: number | null;
  refundedAt?: Date | null;
  cancelPayoutAt?: Date | null;
}

export interface EventLogEntity {
  id: string;
  actorUserId: string;
  actionType: string;
  targetType: string;
  targetId: string;
  reason: string;
  occurredAt: Date;
}

export interface CatalogAdminPort {
  executeBlockAction(input: {
    blockId: string;
    action: string;
    reason: string;
    unitPrice?: number;
    mergedIntoId?: string;
  }): Promise<{ success: boolean; blockId: string; action: string }>;
}

export interface AdminRepository {
  seedBlock(block: AdminBlock): void;
  seedHeldDeposit(deposit: AdminHeldDeposit): void;
  seedEscalatedInspection(inspection: AdminEscalatedInspection): void;
  seedCancellationQueueContract(contract: AdminCancellationContract): void;
  listBlocks(): Promise<AdminBlock[]>;
  getBlock(id: string): Promise<AdminBlock | null>;
  listHeldDeposits(): Promise<AdminHeldDeposit[]>;
  getHeldDeposit(id: string): Promise<AdminHeldDeposit | null>;
  updateHeldDeposit(id: string, patch: Partial<AdminHeldDeposit>): Promise<AdminHeldDeposit>;
  listEscalatedInspections(): Promise<AdminEscalatedInspection[]>;
  getInspection(id: string): Promise<AdminEscalatedInspection | null>;
  updateInspection(id: string, patch: Partial<AdminEscalatedInspection>): Promise<AdminEscalatedInspection>;
  listCancellationQueue(): Promise<AdminCancellationContract[]>;
  getCancellationContract(id: string): Promise<AdminCancellationContract | null>;
  updateCancellationContract(
    id: string,
    patch: Partial<AdminCancellationContract>,
  ): Promise<AdminCancellationContract>;
  recordEvent(event: Omit<EventLogEntity, "id">): Promise<EventLogEntity>;
  listEventLogs(): Promise<EventLogEntity[]>;
}

export function createInMemoryAdminRepository(): AdminRepository {
  const blocks = new Map<string, AdminBlock>();
  const heldDeposits = new Map<string, AdminHeldDeposit>();
  const inspections = new Map<string, AdminEscalatedInspection>();
  const cancellationContracts = new Map<string, AdminCancellationContract>();
  const eventLogs: EventLogEntity[] = [];
  let logIdCounter = 1;

  return {
    seedBlock(block) {
      blocks.set(block.id, { ...block });
    },
    seedHeldDeposit(deposit) {
      heldDeposits.set(deposit.id, { ...deposit });
    },
    seedEscalatedInspection(inspection) {
      inspections.set(inspection.id, { ...inspection });
    },
    seedCancellationQueueContract(contract) {
      cancellationContracts.set(contract.id, { ...contract });
    },
    async listBlocks() {
      return Array.from(blocks.values());
    },
    async getBlock(id) {
      return blocks.get(id) ?? null;
    },
    async listHeldDeposits() {
      return Array.from(heldDeposits.values()).filter((d) => d.status === "HELD");
    },
    async getHeldDeposit(id) {
      return heldDeposits.get(id) ?? null;
    },
    async updateHeldDeposit(id, patch) {
      const existing = heldDeposits.get(id);
      if (!existing) throw new AdminHttpError(404, "보류된 예치 건을 찾을 수 없습니다.");
      const updated = { ...existing, ...patch };
      heldDeposits.set(id, updated);
      return updated;
    },
    async listEscalatedInspections() {
      return Array.from(inspections.values()).filter((i) => i.status === "ESCALATED");
    },
    async getInspection(id) {
      return inspections.get(id) ?? null;
    },
    async updateInspection(id, patch) {
      const existing = inspections.get(id);
      if (!existing) throw new AdminHttpError(404, "검수 요청을 찾을 수 없습니다.");
      const updated = { ...existing, ...patch };
      inspections.set(id, updated);
      return updated;
    },
    async listCancellationQueue() {
      return Array.from(cancellationContracts.values());
    },
    async getCancellationContract(id) {
      return cancellationContracts.get(id) ?? null;
    },
    async updateCancellationContract(id, patch) {
      const existing = cancellationContracts.get(id);
      if (!existing) throw new AdminHttpError(404, "취소 대기 계약을 찾을 수 없습니다.");
      const updated = { ...existing, ...patch };
      cancellationContracts.set(id, updated);
      return updated;
    },
    async recordEvent(data) {
      const rec: EventLogEntity = { ...data, id: `log-${logIdCounter++}` };
      eventLogs.push(rec);
      return rec;
    },
    async listEventLogs() {
      return [...eventLogs].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
    },
  };
}

export interface AdminOpsServiceOptions {
  repo: AdminRepository;
  catalogPort: CatalogAdminPort;
  clock?: { now(): Date };
}

export class AdminOpsService {
  private readonly repo: AdminRepository;
  private readonly catalogPort: CatalogAdminPort;
  private readonly clock: { now(): Date };

  constructor(options: AdminOpsServiceOptions) {
    this.repo = options.repo;
    this.catalogPort = options.catalogPort;
    this.clock = options.clock ?? { now: () => new Date() };
  }

  private checkAdminRole(actor: { userId: string; role: string }): void {
    if (actor.role !== "ADMIN") {
      throw new AdminHttpError(403, "관리자 권한이 필요합니다.");
    }
  }

  private validateReason(reason: string): void {
    if (!reason || reason.trim().length === 0) {
      throw new AdminHttpError(400, "관리자 조치 사유는 필수입니다.");
    }
  }

  async listBlocks(actor: { userId: string; role: string }): Promise<AdminBlock[]> {
    this.checkAdminRole(actor);
    return this.repo.listBlocks();
  }

  async executeBlockAction(
    actor: { userId: string; role: string },
    blockId: string,
    input: { action: string; reason: string; unitPrice?: number; mergedIntoId?: string },
  ): Promise<{ success: boolean; blockId: string; action: string }> {
    this.checkAdminRole(actor);
    this.validateReason(input.reason);

    const result = await this.catalogPort.executeBlockAction({
      blockId,
      action: input.action,
      reason: input.reason,
      unitPrice: input.unitPrice,
      mergedIntoId: input.mergedIntoId,
    });

    await this.repo.recordEvent({
      actorUserId: actor.userId,
      actionType: `BLOCK_${input.action}`,
      targetType: "BLOCK",
      targetId: blockId,
      reason: input.reason,
      occurredAt: this.clock.now(),
    });

    return result;
  }

  async listHeldDeposits(actor: { userId: string; role: string }): Promise<AdminHeldDeposit[]> {
    this.checkAdminRole(actor);
    return this.repo.listHeldDeposits();
  }

  async resolveHeldDeposit(
    actor: { userId: string; role: string },
    depositId: string,
    input: { decision: "OPERATOR_CONFIRMED" | "OPERATOR_VOIDED"; reason: string },
  ): Promise<AdminHeldDeposit> {
    this.checkAdminRole(actor);
    this.validateReason(input.reason);

    const deposit = await this.repo.getHeldDeposit(depositId);
    if (!deposit) throw new AdminHttpError(404, "보류된 예치 건을 찾을 수 없습니다.");

    // 이미 처리된 경우 멱등 반환
    if (deposit.status !== "HELD") {
      return deposit;
    }

    const nextStatus = input.decision === "OPERATOR_CONFIRMED" ? "COMPLETED" : "FAILED";
    const updated = await this.repo.updateHeldDeposit(deposit.id, {
      status: nextStatus,
    });

    await this.repo.recordEvent({
      actorUserId: actor.userId,
      actionType: input.decision,
      targetType: "DEPOSIT",
      targetId: depositId,
      reason: input.reason,
      occurredAt: this.clock.now(),
    });

    return updated;
  }

  async listEscalatedInspections(actor: { userId: string; role: string }): Promise<AdminEscalatedInspection[]> {
    this.checkAdminRole(actor);
    return this.repo.listEscalatedInspections();
  }

  async decideInspectionDispute(
    actor: { userId: string; role: string },
    inspectionRequestId: string,
    input: {
      decision: "REWORK_VALID" | "APPROVE" | "UNDECIDED_CONDITION";
      reason: string;
      decisionNotes: { client: string; supplier: string };
    },
  ): Promise<AdminEscalatedInspection> {
    this.checkAdminRole(actor);
    this.validateReason(input.reason);

    const inspection = await this.repo.getInspection(inspectionRequestId);
    if (!inspection) throw new AdminHttpError(404, "검수 요청을 찾을 수 없습니다.");

    const updated = await this.repo.updateInspection(inspection.id, {
      status: "RESOLVED",
      decision: input.decision,
      decisionNotes: input.decisionNotes,
    });

    await this.repo.recordEvent({
      actorUserId: actor.userId,
      actionType: `DISPUTE_${input.decision}`,
      targetType: "INSPECTION",
      targetId: inspectionRequestId,
      reason: input.reason,
      occurredAt: this.clock.now(),
    });

    return updated;
  }

  async listCancellationQueue(actor: { userId: string; role: string }): Promise<AdminCancellationContract[]> {
    this.checkAdminRole(actor);
    return this.repo.listCancellationQueue();
  }

  async markSettlementProcessed(
    actor: { userId: string; role: string },
    contractId: string,
    input: { refunded: boolean; cancelPayout: boolean; reason: string },
  ): Promise<AdminCancellationContract> {
    this.checkAdminRole(actor);
    this.validateReason(input.reason);

    const contract = await this.repo.getCancellationContract(contractId);
    if (!contract) throw new AdminHttpError(404, "취소 계약을 찾을 수 없습니다.");

    const now = this.clock.now();
    const updated = await this.repo.updateCancellationContract(contract.id, {
      refundedAt: input.refunded ? (contract.refundedAt ?? now) : contract.refundedAt,
      cancelPayoutAt: input.cancelPayout ? (contract.cancelPayoutAt ?? now) : contract.cancelPayoutAt,
    });

    await this.repo.recordEvent({
      actorUserId: actor.userId,
      actionType: "SETTLEMENT_MANUAL_PROCESSED",
      targetType: "CONTRACT",
      targetId: contractId,
      reason: input.reason,
      occurredAt: now,
    });

    return updated;
  }

  async listEventLogs(actor: { userId: string; role: string }): Promise<EventLogEntity[]> {
    this.checkAdminRole(actor);
    return this.repo.listEventLogs();
  }
}
