import { endOfKstDayPlus } from "../settlement/policy.ts";

export type DeliveryStatus = "SUBMITTED" | "PARTIALLY_APPROVED" | "APPROVED" | "REWORK_REQUESTED";
export type InspectionReason = "CONDITION_MISMATCH" | "NOT_WORKING" | "MISSING_PART" | "OTHER";
export type InspectionStatus = "OPEN" | "RESOLVED" | "ESCALATED";
export type ConditionState = "DECIDED" | "PROPOSED" | "UNDECIDED";
export type DisputeDecision = "REWORK_VALID" | "APPROVE" | "UNDECIDED_CONDITION";

const INSPECTION_REASONS: readonly InspectionReason[] = [
  "CONDITION_MISMATCH",
  "NOT_WORKING",
  "MISSING_PART",
  "OTHER",
];

export interface DeliveryFile {
  fileId: string;
  name: string;
  size: number;
  mimeType: string;
}

export interface DeliveryItemPayload {
  contractItemId: string;
  links: string[];
  files: DeliveryFile[];
  howToCheck: string;
}

export interface DeliveryEntity {
  id: string;
  installmentId: string;
  attemptNo: number;
  items: DeliveryItemPayload[];
  summary: string | null;
  status: DeliveryStatus;
  submittedAt: Date;
  inspectionDueAt: Date;
  reviewedAt: Date | null;
}

export interface ConditionLine {
  key: string;
  text: string;
  state: ConditionState;
}

export interface ContractItemEntity {
  id: string;
  contractId: string;
  stage: "INTERIM" | "FINAL";
  title: string;
  description: string;
  conditions: ConditionLine[];
  approvedAt: Date | null;
  autoApproved: boolean;
}

export interface InspectionRequestEntity {
  id: string;
  deliveryId: string;
  contractItemId: string;
  reason: InspectionReason;
  conditionKey: string | null;
  note?: string | null;
  status: InspectionStatus;
  escalatedAt: Date | null;
  escalation?: unknown;
  decision?: DisputeDecision | null;
  decisionNotes?: { client: string; supplier: string } | null;
  resolvedAt?: Date | null;
  createdAt: Date;
}

export interface DeliveryContractInfo {
  id: string;
  clientUserId: string;
  supplierUserId: string;
  status: string;
  paymentStatus: string;
  depositDeadline?: Date;
  workDueAt?: Date;
}

export interface DeliveryInstallmentInfo {
  id: string;
  contractId: string;
  stage: "INTERIM" | "FINAL";
  status: string;
}

export interface NotificationPorts {
  createOnce(input: {
    userId: string;
    type: string;
    targetId: string;
    targetUrl?: string;
  }): Promise<{ created: boolean }>;
}

export class DeliveryHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "DeliveryHttpError";
    this.status = status;
  }
}

export interface DeliveryRepository {
  seedContract(contract: DeliveryContractInfo): void;
  seedInstallment(installment: DeliveryInstallmentInfo): void;
  seedContractItems(items: ContractItemEntity[]): void;
  getContract(id: string): Promise<DeliveryContractInfo | null>;
  getInstallment(id: string): Promise<DeliveryInstallmentInfo | null>;
  updateInstallment(id: string, patch: Partial<DeliveryInstallmentInfo>): Promise<DeliveryInstallmentInfo>;
  getContractItem(id: string): Promise<ContractItemEntity | null>;
  listContractItemsByContractId(contractId: string): Promise<ContractItemEntity[]>;
  updateContractItem(id: string, patch: Partial<ContractItemEntity>): Promise<ContractItemEntity>;
  createDelivery(data: Omit<DeliveryEntity, "id">): Promise<DeliveryEntity>;
  getDelivery(id: string): Promise<DeliveryEntity | null>;
  listDeliveries(installmentId: string): Promise<DeliveryEntity[]>;
  updateDelivery(id: string, patch: Partial<DeliveryEntity>): Promise<DeliveryEntity>;
  createInspectionRequest(data: Omit<InspectionRequestEntity, "id">): Promise<InspectionRequestEntity>;
  getInspectionRequest(id: string): Promise<InspectionRequestEntity | null>;
  listInspectionRequestsByItem(contractItemId: string): Promise<InspectionRequestEntity[]>;
  listInspectionRequestsByDelivery(deliveryId: string): Promise<InspectionRequestEntity[]>;
  updateInspectionRequest(id: string, patch: Partial<InspectionRequestEntity>): Promise<InspectionRequestEntity>;
}

export function createInMemoryDeliveryRepository(): DeliveryRepository {
  const contracts = new Map<string, DeliveryContractInfo>();
  const installments = new Map<string, DeliveryInstallmentInfo>();
  const contractItems = new Map<string, ContractItemEntity>();
  const deliveries = new Map<string, DeliveryEntity>();
  const inspections = new Map<string, InspectionRequestEntity>();
  let idCounter = 1;

  return {
    seedContract(contract) {
      contracts.set(contract.id, { ...contract });
    },
    seedInstallment(installment) {
      installments.set(installment.id, { ...installment });
    },
    seedContractItems(items) {
      for (const item of items) {
        contractItems.set(item.id, { ...item });
      }
    },
    async getContract(id) {
      return contracts.get(id) ?? null;
    },
    async getInstallment(id) {
      return installments.get(id) ?? null;
    },
    async updateInstallment(id, patch) {
      const installment = installments.get(id);
      if (!installment) throw new DeliveryHttpError(404, "구간을 찾을 수 없습니다.");
      const updated = { ...installment, ...patch };
      installments.set(id, updated);
      return updated;
    },
    async getContractItem(id) {
      return contractItems.get(id) ?? null;
    },
    async listContractItemsByContractId(contractId) {
      return Array.from(contractItems.values()).filter((i) => i.contractId === contractId);
    },
    async updateContractItem(id, patch) {
      const item = contractItems.get(id);
      if (!item) throw new DeliveryHttpError(404, "계약 항목을 찾을 수 없습니다.");
      const updated = { ...item, ...patch };
      contractItems.set(id, updated);
      return updated;
    },
    async createDelivery(data) {
      const id = `del-${idCounter++}`;
      const rec: DeliveryEntity = { ...data, id };
      deliveries.set(id, rec);
      return rec;
    },
    async getDelivery(id) {
      return deliveries.get(id) ?? null;
    },
    async listDeliveries(installmentId) {
      return Array.from(deliveries.values())
        .filter((d) => d.installmentId === installmentId)
        .sort((a, b) => a.attemptNo - b.attemptNo);
    },
    async updateDelivery(id, patch) {
      const d = deliveries.get(id);
      if (!d) throw new DeliveryHttpError(404, "납품을 찾을 수 없습니다.");
      const updated = { ...d, ...patch };
      deliveries.set(id, updated);
      return updated;
    },
    async createInspectionRequest(data) {
      const id = `insp-${idCounter++}`;
      const rec: InspectionRequestEntity = { ...data, id };
      inspections.set(id, rec);
      return rec;
    },
    async getInspectionRequest(id) {
      return inspections.get(id) ?? null;
    },
    async listInspectionRequestsByItem(contractItemId) {
      return Array.from(inspections.values()).filter((i) => i.contractItemId === contractItemId);
    },
    async listInspectionRequestsByDelivery(deliveryId) {
      return Array.from(inspections.values()).filter((i) => i.deliveryId === deliveryId);
    },
    async updateInspectionRequest(id, patch) {
      const rec = inspections.get(id);
      if (!rec) throw new DeliveryHttpError(404, "보완 요청을 찾을 수 없습니다.");
      const updated = { ...rec, ...patch };
      inspections.set(id, updated);
      return updated;
    },
  };
}

export interface DeliveryServiceOptions {
  repo: DeliveryRepository;
  clock?: { now(): Date };
}

export class DeliveryService {
  private readonly repo: DeliveryRepository;
  private readonly clock: { now(): Date };

  constructor(options: DeliveryServiceOptions) {
    this.repo = options.repo;
    this.clock = options.clock ?? { now: () => new Date() };
  }

  private async assertParty(
    actor: { userId: string; role: string },
    contract: DeliveryContractInfo,
  ): Promise<void> {
    const isParty =
      (actor.role === "CLIENT" && actor.userId === contract.clientUserId) ||
      (actor.role === "SUPPLIER" && actor.userId === contract.supplierUserId);
    if (!isParty) throw new DeliveryHttpError(403, "계약 당사자만 조회할 수 있습니다.");
  }

  private assertContractActive(contract: DeliveryContractInfo, action: string): void {
    if (contract.status !== "ACTIVE") {
      throw new DeliveryHttpError(409, `진행 중(ACTIVE) 계약만 ${action} 수 있습니다.`);
    }
  }

  async listDeliveries(
    actor: { userId: string; role: string },
    installmentId: string,
  ): Promise<DeliveryEntity[]> {
    const installment = await this.repo.getInstallment(installmentId);
    if (!installment) throw new DeliveryHttpError(404, "구간을 찾을 수 없습니다.");
    const contract = await this.repo.getContract(installment.contractId);
    if (!contract) throw new DeliveryHttpError(404, "계약을 찾을 수 없습니다.");
    await this.assertParty(actor, contract);
    return this.repo.listDeliveries(installmentId);
  }

  async getDelivery(actor: { userId: string; role: string }, deliveryId: string): Promise<DeliveryEntity> {
    const delivery = await this.repo.getDelivery(deliveryId);
    if (!delivery) throw new DeliveryHttpError(404, "납품을 찾을 수 없습니다.");
    const installment = await this.repo.getInstallment(delivery.installmentId);
    if (!installment) throw new DeliveryHttpError(404, "구간을 찾을 수 없습니다.");
    const contract = await this.repo.getContract(installment.contractId);
    if (!contract) throw new DeliveryHttpError(404, "계약을 찾을 수 없습니다.");
    await this.assertParty(actor, contract);
    return delivery;
  }

  async listReworkRequests(
    actor: { userId: string; role: string },
    contractItemId: string,
  ): Promise<InspectionRequestEntity[]> {
    const item = await this.repo.getContractItem(contractItemId);
    if (!item) throw new DeliveryHttpError(404, "계약 항목을 찾을 수 없습니다.");
    const contract = await this.repo.getContract(item.contractId);
    if (!contract) throw new DeliveryHttpError(404, "계약을 찾을 수 없습니다.");
    await this.assertParty(actor, contract);
    return this.repo.listInspectionRequestsByItem(contractItemId);
  }

  async submitDelivery(
    actor: { userId: string; role: string },
    input: { installmentId: string; items: DeliveryItemPayload[]; summary?: string },
  ): Promise<DeliveryEntity> {
    const installment = await this.repo.getInstallment(input.installmentId);
    if (!installment) throw new DeliveryHttpError(404, "구간을 찾을 수 없습니다.");

    const contract = await this.repo.getContract(installment.contractId);
    if (!contract) throw new DeliveryHttpError(404, "계약을 찾을 수 없습니다.");

    if (actor.role !== "SUPPLIER" || actor.userId !== contract.supplierUserId) {
      throw new DeliveryHttpError(403, "공급자만 납품을 제출할 수 있습니다.");
    }

    if (contract.status !== "ACTIVE" || contract.paymentStatus !== "DEPOSITED") {
      throw new DeliveryHttpError(409, "예치 완료된 계약만 납품할 수 있습니다.");
    }

    // 구간 상태 전이: PENDING/REWORK_REQUESTED -> DELIVERED
    if (installment.status !== "PENDING" && installment.status !== "REWORK_REQUESTED") {
      throw new DeliveryHttpError(409, "납품 가능한 구간 상태가 아닙니다.");
    }

    if (!input.items || input.items.length === 0) {
      throw new DeliveryHttpError(400, "납품 항목이 최소 1개 이상 필요합니다.");
    }

    const MAX_FILE_SIZE = 50 * 1024 * 1024;
    for (const item of input.items) {
      for (const file of item.files) {
        if (file.size > MAX_FILE_SIZE) {
          throw new DeliveryHttpError(400, `파일 크기가 50MB를 초과합니다: ${file.name}`);
        }
      }
    }

    const contractItems = await this.repo.listContractItemsByContractId(contract.id);
    const contractItemMap = new Map(contractItems.map((i) => [i.id, i]));

    for (const item of input.items) {
      const found = contractItemMap.get(item.contractItemId);
      if (!found || found.stage !== installment.stage) {
        throw new DeliveryHttpError(400, `해당 구간의 계약 항목이 아닙니다: ${item.contractItemId}`);
      }
    }

    const previousDeliveries = await this.repo.listDeliveries(installment.id);
    const attemptNo = previousDeliveries.length + 1;

    if (attemptNo > 1) {
      for (const item of input.items) {
        const cItem = contractItemMap.get(item.contractItemId);
        if (cItem?.approvedAt) {
          throw new DeliveryHttpError(400, "보완 요청된 미승인 항목만 재제출할 수 있습니다.");
        }
        const inspections = await this.repo.listInspectionRequestsByItem(item.contractItemId);
        const hasReworkRequest = inspections.some((i) => i.status === "OPEN");
        if (!hasReworkRequest) {
          throw new DeliveryHttpError(400, "보완 요청된 미승인 항목만 재제출할 수 있습니다.");
        }
      }
    }

    const submittedAt = this.clock.now();
    const inspectionDueAt = endOfKstDayPlus(submittedAt, 7);

    const created = await this.repo.createDelivery({
      installmentId: installment.id,
      attemptNo,
      items: input.items,
      summary: input.summary ?? null,
      status: "SUBMITTED",
      submittedAt,
      inspectionDueAt,
      reviewedAt: null,
    });

    await this.repo.updateInstallment(installment.id, { status: "DELIVERED" });

    // 재납품한 항목의 이전 OPEN 보완 요청은 해소되어 자동 승인을 영구 차단하지 않는다.
    if (attemptNo > 1) {
      for (const item of input.items) {
        const inspections = await this.repo.listInspectionRequestsByItem(item.contractItemId);
        for (const insp of inspections) {
          if (insp.status === "OPEN") {
            await this.repo.updateInspectionRequest(insp.id, {
              status: "RESOLVED",
              resolvedAt: submittedAt,
            });
          }
        }
      }
    }

    return created;
  }

  async approveItem(
    actor: { userId: string; role: string },
    input: { contractItemId: string; deliveryId: string },
  ): Promise<ContractItemEntity> {
    const item = await this.repo.getContractItem(input.contractItemId);
    if (!item) throw new DeliveryHttpError(404, "계약 항목을 찾을 수 없습니다.");

    const contract = await this.repo.getContract(item.contractId);
    if (!contract) throw new DeliveryHttpError(404, "계약을 찾을 수 없습니다.");

    this.assertContractActive(contract, "항목을 승인할");

    if (actor.role !== "CLIENT" || actor.userId !== contract.clientUserId) {
      throw new DeliveryHttpError(403, "의뢰인만 항목을 승인할 수 있습니다.");
    }

    const delivery = await this.repo.getDelivery(input.deliveryId);
    if (!delivery || delivery.items.some((row) => row.contractItemId === item.id) === false) {
      throw new DeliveryHttpError(404, "해당 납품의 항목이 아닙니다.");
    }

    if (item.approvedAt) {
      return item;
    }

    const updated = await this.repo.updateContractItem(item.id, {
      approvedAt: this.clock.now(),
      autoApproved: false,
    });

    const inspections = await this.repo.listInspectionRequestsByItem(item.id);
    for (const insp of inspections) {
      if (insp.status === "OPEN") {
        await this.repo.updateInspectionRequest(insp.id, {
          status: "RESOLVED",
          resolvedAt: this.clock.now(),
        });
      }
    }

    const itemsInStage = (await this.repo.listContractItemsByContractId(contract.id)).filter(
      (i) => i.stage === item.stage,
    );
    const allApproved = itemsInStage.every((i) => i.id === item.id || i.approvedAt !== null);
    await this.repo.updateDelivery(delivery.id, {
      status: allApproved ? "APPROVED" : "PARTIALLY_APPROVED",
      reviewedAt: this.clock.now(),
    });

    return updated;
  }

  async requestRework(
    actor: { userId: string; role: string },
    input: {
      deliveryId: string;
      contractItemId: string;
      reason: InspectionReason;
      conditionKey?: string;
      note?: string;
    },
  ): Promise<InspectionRequestEntity> {
    const item = await this.repo.getContractItem(input.contractItemId);
    if (!item) throw new DeliveryHttpError(404, "계약 항목을 찾을 수 없습니다.");

    const contract = await this.repo.getContract(item.contractId);
    if (!contract) throw new DeliveryHttpError(404, "계약을 찾을 수 없습니다.");

    if (actor.role !== "CLIENT" || actor.userId !== contract.clientUserId) {
      throw new DeliveryHttpError(403, "의뢰인만 보완을 요청할 수 있습니다.");
    }

    this.assertContractActive(contract, "보완을 요청할");

    if (!INSPECTION_REASONS.includes(input.reason)) {
      throw new DeliveryHttpError(400, "보완 사유는 CONDITION_MISMATCH|NOT_WORKING|MISSING_PART|OTHER 중 하나여야 합니다.");
    }
    if (!input.note || input.note.trim().length === 0) {
      throw new DeliveryHttpError(400, "보완 사유 설명은 필수입니다.");
    }

    if (item.approvedAt) {
      throw new DeliveryHttpError(409, "이미 승인된 항목은 보완 요청할 수 없습니다.");
    }

    const delivery = await this.repo.getDelivery(input.deliveryId);
    if (!delivery) throw new DeliveryHttpError(404, "납품을 찾을 수 없습니다.");
    if (!delivery.items.some((row) => row.contractItemId === item.id)) {
      throw new DeliveryHttpError(404, "해당 납품의 항목이 아닙니다.");
    }

    if (input.reason === "CONDITION_MISMATCH") {
      if (!input.conditionKey) {
        throw new DeliveryHttpError(400, "조건 불일치 사유는 어느 조건인지 지정해야 합니다.");
      }
      const condition = item.conditions.find((c) => c.key === input.conditionKey);
      if (!condition || condition.state !== "DECIDED") {
        throw new DeliveryHttpError(
          422,
          "DECIDED 조건만 상세 검수 기준입니다. PROPOSED 또는 UNDECIDED 조건은 계약서에 정하지 않음으로 남으며 보완 근거가 되지 않습니다.",
        );
      }
    } else if (input.conditionKey) {
      const condition = item.conditions.find((c) => c.key === input.conditionKey);
      if (!condition) {
        throw new DeliveryHttpError(422, "해당 계약 항목에 없는 조건 키입니다.");
      }
    }

    const created = await this.repo.createInspectionRequest({
      deliveryId: delivery.id,
      contractItemId: item.id,
      reason: input.reason,
      conditionKey: input.conditionKey ?? null,
      note: input.note ?? null,
      status: "OPEN",
      escalatedAt: null,
      resolvedAt: null,
      createdAt: this.clock.now(),
    });

    await this.repo.updateDelivery(delivery.id, {
      status: "REWORK_REQUESTED",
      reviewedAt: this.clock.now(),
    });
    await this.repo.updateInstallment(delivery.installmentId, { status: "REWORK_REQUESTED" });

    return created;
  }
}

export interface InspectionBatchOptions {
  repo: DeliveryRepository;
  notificationPorts: NotificationPorts;
  clock?: { now(): Date };
}

export class InspectionBatchService {
  private readonly repo: DeliveryRepository;
  private readonly notificationPorts: NotificationPorts;
  private readonly clock: { now(): Date };

  constructor(options: InspectionBatchOptions) {
    this.repo = options.repo;
    this.notificationPorts = options.notificationPorts;
    this.clock = options.clock ?? { now: () => new Date() };
  }

  async processAutoApproval(deliveryId: string, now: Date): Promise<{ autoApprovedCount: number }> {
    const delivery = await this.repo.getDelivery(deliveryId);
    if (!delivery) return { autoApprovedCount: 0 };

    const installment = await this.repo.getInstallment(delivery.installmentId);
    if (!installment) return { autoApprovedCount: 0 };

    const contract = await this.repo.getContract(installment.contractId);
    if (!contract) return { autoApprovedCount: 0 };

    if (contract.status === "CANCEL_REQUESTED" || contract.status !== "ACTIVE") {
      return { autoApprovedCount: 0 };
    }

    if (now.getTime() <= delivery.inspectionDueAt.getTime()) {
      return { autoApprovedCount: 0 };
    }

    let count = 0;
    for (const itemPayload of delivery.items) {
      const item = await this.repo.getContractItem(itemPayload.contractItemId);
      if (!item || item.approvedAt !== null) {
        continue;
      }

      const inspections = await this.repo.listInspectionRequestsByItem(item.id);
      const hasBlocker = inspections.some((i) => i.status === "OPEN" || i.status === "ESCALATED");
      if (hasBlocker) {
        continue;
      }

      await this.repo.updateContractItem(item.id, {
        approvedAt: now,
        autoApproved: true,
      });
      count++;
    }

    if (count > 0) {
      const itemsInStage = (await this.repo.listContractItemsByContractId(contract.id)).filter(
        (i) => i.stage === installment.stage,
      );
      const allApproved = itemsInStage.every((i) => i.approvedAt !== null);
      if (allApproved) {
        await this.repo.updateDelivery(delivery.id, {
          status: "APPROVED",
          reviewedAt: now,
        });
        await this.notificationPorts.createOnce({
          userId: contract.clientUserId,
          type: "AUTO_APPROVED",
          targetId: delivery.id,
        });
        await this.notificationPorts.createOnce({
          userId: contract.supplierUserId,
          type: "AUTO_APPROVED",
          targetId: delivery.id,
        });
      }
    }

    return { autoApprovedCount: count };
  }

  async checkAndEscalateItem(
    contractItemId: string,
    inspectionRequestId: string,
  ): Promise<InspectionRequestEntity> {
    const inspections = await this.repo.listInspectionRequestsByItem(contractItemId);
    const target = await this.repo.getInspectionRequest(inspectionRequestId);
    if (!target) throw new DeliveryHttpError(404, "보완 요청을 찾을 수 없습니다.");

    if (inspections.length >= 3) {
      return this.repo.updateInspectionRequest(target.id, {
        status: "ESCALATED",
        escalatedAt: this.clock.now(),
        escalation: {
          requestedBy: "SYSTEM",
          reason: "동일 항목 보완 요청 3회 누적에 따른 자동 이견 개입",
        },
      });
    }

    return target;
  }

  async decideDispute(input: {
    inspectionRequestId: string;
    decision: DisputeDecision;
    reason: string;
    decisionNotes: { client: string; supplier: string };
  }): Promise<InspectionRequestEntity> {
    if (!input.reason || input.reason.trim().length === 0) {
      throw new DeliveryHttpError(400, "운영자 판정 사유는 필수입니다.");
    }

    const inspReq = await this.repo.getInspectionRequest(input.inspectionRequestId);
    if (!inspReq) throw new DeliveryHttpError(404, "보완 요청을 찾을 수 없습니다.");

    const now = this.clock.now();

    if (input.decision === "REWORK_VALID") {
      return this.repo.updateInspectionRequest(inspReq.id, {
        status: "OPEN",
        decision: "REWORK_VALID",
        decisionNotes: input.decisionNotes,
      });
    }

    if (input.decision === "APPROVE" || input.decision === "UNDECIDED_CONDITION") {
      await this.repo.updateContractItem(inspReq.contractItemId, {
        approvedAt: now,
        autoApproved: false,
      });

      return this.repo.updateInspectionRequest(inspReq.id, {
        status: "RESOLVED",
        decision: input.decision,
        decisionNotes: input.decisionNotes,
        resolvedAt: now,
      });
    }

    return inspReq;
  }

  async sendDueNotifications(contractId: string, now: Date): Promise<void> {
    const contract = await this.repo.getContract(contractId);
    if (!contract || contract.status !== "ACTIVE") return;

    const oneDayMs = 24 * 60 * 60 * 1000;

    if (contract.depositDeadline) {
      const diffMs = contract.depositDeadline.getTime() - now.getTime();
      if (diffMs > 0 && diffMs <= oneDayMs) {
        await this.notificationPorts.createOnce({
          userId: contract.clientUserId,
          type: "DEPOSIT_DUE",
          targetId: contract.id,
        });
      }
    }

    if (contract.workDueAt) {
      const diffMs = contract.workDueAt.getTime() - now.getTime();
      if (diffMs > 0 && diffMs <= oneDayMs) {
        await this.notificationPorts.createOnce({
          userId: contract.supplierUserId,
          type: "WORK_DUE",
          targetId: contract.id,
        });
      } else if (now > contract.workDueAt) {
        await this.notificationPorts.createOnce({
          userId: contract.clientUserId,
          type: "WORK_OVERDUE",
          targetId: contract.id,
        });
        await this.notificationPorts.createOnce({
          userId: contract.supplierUserId,
          type: "WORK_OVERDUE",
          targetId: contract.id,
        });
      }
    }
  }

  isWorkOverdue(input: { workDueAt: Date; finalStageStatus: string; now: Date }): boolean {
    if (input.finalStageStatus === "APPROVED" || input.finalStageStatus === "DELIVERED") {
      return false;
    }
    return input.now.getTime() > input.workDueAt.getTime();
  }
}
