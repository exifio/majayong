import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  InspectionBatchService,
  createInMemoryDeliveryRepository,
  type ContractItemEntity,
  type DeliveryContractInfo,
  type DeliveryEntity,
  type NotificationPorts,
} from "../../src/modules/delivery/index.ts";

describe("C-04: 자동 승인·이견 3택·기한 배치", () => {
  const baseTime = new Date("2026-11-10T10:00:00.000Z");
  const sevenDaysLater = new Date(baseTime.getTime() + 7 * 24 * 60 * 60 * 1000);

  function createTestSetup() {
    const repo = createInMemoryDeliveryRepository();

    const contract: DeliveryContractInfo & {
      workDueAt: Date;
      depositDeadline: Date;
    } = {
      id: "contract-c04",
      clientUserId: "client-1",
      supplierUserId: "supplier-1",
      status: "ACTIVE",
      paymentStatus: "DEPOSITED",
      workDueAt: new Date("2026-12-16T10:00:00.000Z"),
      depositDeadline: new Date("2026-11-07T14:59:59.000Z"),
    };

    const installment = {
      id: "inst-1",
      contractId: contract.id,
      stage: "INTERIM" as const,
      status: "DELIVERED",
    };

    const item1: ContractItemEntity = {
      id: "item-1",
      contractId: contract.id,
      stage: "INTERIM",
      title: "기능 1",
      description: "기능 1 설명",
      conditions: [{ key: "c-1", text: "조건 1", state: "DECIDED" }],
      approvedAt: null,
      autoApproved: false,
    };

    const item2: ContractItemEntity = {
      id: "item-2",
      contractId: contract.id,
      stage: "INTERIM",
      title: "기능 2",
      description: "기능 2 설명",
      conditions: [{ key: "c-2", text: "조건 2", state: "DECIDED" }],
      approvedAt: null,
      autoApproved: false,
    };

    repo.seedContract(contract);
    repo.seedInstallment(installment);
    repo.seedContractItems([item1, item2]);

    const sentNotifications: Array<{ userId: string; type: string; targetId: string }> = [];
    const notificationPorts: NotificationPorts = {
      async createOnce(input: { userId: string; type: string; targetId: string }) {
        const key = `${input.userId}:${input.type}:${input.targetId}`;
        const exists = sentNotifications.some((n) => `${n.userId}:${n.type}:${n.targetId}` === key);
        if (!exists) {
          sentNotifications.push(input);
          return { created: true };
        }
        return { created: false };
      },
    };

    const batchService = new InspectionBatchService({
      repo,
      notificationPorts,
      clock: { now: () => baseTime },
    });

    return { repo, contract, installment, item1, item2, sentNotifications, batchService };
  }

  it("C-04-T01 7일 직전/정각/직후 시각 경계", async () => {
    const { repo, installment, item1, batchService } = createTestSetup();

    const delivery = await repo.createDelivery({
      installmentId: installment.id,
      attemptNo: 1,
      items: [{ contractItemId: item1.id, links: [], files: [], howToCheck: "" }],
      summary: null,
      status: "SUBMITTED",
      submittedAt: baseTime,
      inspectionDueAt: sevenDaysLater,
      reviewedAt: null,
    });

    // 1. 7일 직전 (1초 전) -> 자동 승인 0건
    const justBefore = new Date(sevenDaysLater.getTime() - 1000);
    const resBefore = await batchService.processAutoApproval(delivery.id, justBefore);
    assert.equal(resBefore.autoApprovedCount, 0);

    const itemBefore = await repo.getContractItem(item1.id);
    assert.equal(itemBefore?.approvedAt, null);

    // 2. 7일 정각 -> 자동 승인 1건
    const resExact = await batchService.processAutoApproval(delivery.id, sevenDaysLater);
    assert.equal(resExact.autoApprovedCount, 1);

    const itemExact = await repo.getContractItem(item1.id);
    assert.ok(itemExact?.approvedAt);
    assert.equal(itemExact.autoApproved, true);

    // 3. 7일 직후 -> 이미 승인되었으므로 추가 승인 0건 (멱등성)
    const justAfter = new Date(sevenDaysLater.getTime() + 1000);
    const resAfter = await batchService.processAutoApproval(delivery.id, justAfter);
    assert.equal(resAfter.autoApprovedCount, 0);
  });

  it("C-04-T02 OPEN·ESCALATED·CANCEL_REQUESTED에서 승인·지급 0", async () => {
    const { repo, contract, installment, item1, item2, batchService } = createTestSetup();

    const delivery = await repo.createDelivery({
      installmentId: installment.id,
      attemptNo: 1,
      items: [
        { contractItemId: item1.id, links: [], files: [], howToCheck: "" },
        { contractItemId: item2.id, links: [], files: [], howToCheck: "" },
      ],
      summary: null,
      status: "REWORK_REQUESTED",
      submittedAt: baseTime,
      inspectionDueAt: sevenDaysLater,
      reviewedAt: null,
    });

    // item1에 OPEN 보완 요청 등록
    await repo.createInspectionRequest({
      deliveryId: delivery.id,
      contractItemId: item1.id,
      reason: "NOT_WORKING",
      conditionKey: null,
      note: "미작동",
      status: "OPEN",
      escalatedAt: null,
      resolvedAt: null,
      createdAt: baseTime,
    });

    // 7일 경과 시점 배치 실행: item1은 OPEN 보완이 걸려있으므로 자동 승인 제외
    const res = await batchService.processAutoApproval(delivery.id, sevenDaysLater);
    assert.equal(res.autoApprovedCount, 1); // item2만 자동 승인

    const checkItem1 = await repo.getContractItem(item1.id);
    assert.equal(checkItem1?.approvedAt, null); // item1은 승인되지 않음

    // 계약이 CANCEL_REQUESTED인 경우 전 항목 자동 승인 0
    repo.seedContract({ ...contract, status: "CANCEL_REQUESTED" });
    const resCancel = await batchService.processAutoApproval(delivery.id, sevenDaysLater);
    assert.equal(resCancel.autoApprovedCount, 0);
  });

  it("C-04-T03 부분 승인 유지", async () => {
    const { repo, installment, item1, item2, batchService } = createTestSetup();

    // item1은 이미 의뢰인이 직접 승인함
    await repo.updateContractItem(item1.id, {
      approvedAt: baseTime,
      autoApproved: false,
    });

    const delivery = await repo.createDelivery({
      installmentId: installment.id,
      attemptNo: 1,
      items: [
        { contractItemId: item1.id, links: [], files: [], howToCheck: "" },
        { contractItemId: item2.id, links: [], files: [], howToCheck: "" },
      ],
      summary: null,
      status: "PARTIALLY_APPROVED",
      submittedAt: baseTime,
      inspectionDueAt: sevenDaysLater,
      reviewedAt: null,
    });

    // 7일 경과 배치 실행
    const res = await batchService.processAutoApproval(delivery.id, sevenDaysLater);
    assert.equal(res.autoApprovedCount, 1); // item2만 새로 자동 승인됨

    const item1After = await repo.getContractItem(item1.id);
    assert.equal(item1After?.autoApproved, false); // 기존 직접 승인 속성 유지
    assert.equal(item1After?.approvedAt?.getTime(), baseTime.getTime());

    const item2After = await repo.getContractItem(item2.id);
    assert.equal(item2After?.autoApproved, true);
  });

  it("C-04-T04 보완 3회 자동 개입", async () => {
    const { repo, installment, item1, batchService } = createTestSetup();

    const delivery = await repo.createDelivery({
      installmentId: installment.id,
      attemptNo: 1,
      items: [{ contractItemId: item1.id, links: [], files: [], howToCheck: "" }],
      summary: null,
      status: "REWORK_REQUESTED",
      submittedAt: baseTime,
      inspectionDueAt: sevenDaysLater,
      reviewedAt: null,
    });

    // 동일 항목에 보완 요청 3회 기록
    await repo.createInspectionRequest({
      deliveryId: delivery.id,
      contractItemId: item1.id,
      reason: "NOT_WORKING",
      conditionKey: null,
      status: "RESOLVED",
      escalatedAt: null,
      createdAt: baseTime,
    });
    await repo.createInspectionRequest({
      deliveryId: delivery.id,
      contractItemId: item1.id,
      reason: "NOT_WORKING",
      conditionKey: null,
      status: "RESOLVED",
      escalatedAt: null,
      createdAt: baseTime,
    });
    const req3 = await repo.createInspectionRequest({
      deliveryId: delivery.id,
      contractItemId: item1.id,
      reason: "NOT_WORKING",
      conditionKey: null,
      status: "OPEN",
      escalatedAt: null,
      createdAt: baseTime,
    });

    // 3회차 보완 요청 발생 시 자동 에스컬레이션 트리거
    const escalated = await batchService.checkAndEscalateItem(item1.id, req3.id);
    assert.equal(escalated.status, "ESCALATED");
    assert.ok(escalated.escalatedAt);
    assert.ok(escalated.escalation);
  });

  it("C-04-T05 판정 3택 및 양쪽 문구 분리", async () => {
    const { repo, installment, item1, batchService } = createTestSetup();

    const delivery = await repo.createDelivery({
      installmentId: installment.id,
      attemptNo: 1,
      items: [{ contractItemId: item1.id, links: [], files: [], howToCheck: "" }],
      summary: null,
      status: "REWORK_REQUESTED",
      submittedAt: baseTime,
      inspectionDueAt: sevenDaysLater,
      reviewedAt: null,
    });

    const inspReq = await repo.createInspectionRequest({
      deliveryId: delivery.id,
      contractItemId: item1.id,
      reason: "CONDITION_MISMATCH",
      conditionKey: "c-1",
      status: "ESCALATED",
      escalatedAt: baseTime,
      createdAt: baseTime,
    });

    // 1. 사유 누락 시 거부
    await assert.rejects(
      () =>
        batchService.decideDispute({
          inspectionRequestId: inspReq.id,
          decision: "APPROVE",
          reason: "", // 사유 필수
          decisionNotes: { client: "승인 결정", supplier: "승인 결정" },
        }),
      /사유/,
    );

    // 2. 운영자 판정 (양쪽 문구 분리 저장)
    const decided = await batchService.decideDispute({
      inspectionRequestId: inspReq.id,
      decision: "UNDECIDED_CONDITION",
      reason: "계약서에 정하지 않은 조건임이 확인됨",
      decisionNotes: {
        client: "해당 조건은 미정 조건이므로 검수 기준에서 제외하고 승인합니다.",
        supplier: "정하지 않은 조건으로 확인되어 해당 항목을 승인 처리합니다.",
      },
    });

    assert.equal(decided.decision, "UNDECIDED_CONDITION");
    assert.equal(decided.status, "RESOLVED");
    assert.deepEqual(decided.decisionNotes, {
      client: "해당 조건은 미정 조건이므로 검수 기준에서 제외하고 승인합니다.",
      supplier: "정하지 않은 조건으로 확인되어 해당 항목을 승인 처리합니다.",
    });

    // UNDECIDED_CONDITION 판정 시 항목도 승인됨
    const itemAfter = await repo.getContractItem(item1.id);
    assert.ok(itemAfter?.approvedAt);
  });

  it("C-04-T06 중복/동시 배치 알림 1회", async () => {
    const { contract, sentNotifications, batchService } = createTestSetup();

    // 1일 전 시점 (예치 기한 1일 전)
    const oneDayBefore = new Date(contract.depositDeadline.getTime() - 24 * 60 * 60 * 1000);

    // 배치 2회 연속 실행
    await batchService.sendDueNotifications(contract.id, oneDayBefore);
    await batchService.sendDueNotifications(contract.id, oneDayBefore);

    // 정확히 1건의 DEPOSIT_DUE 알림만 생성되어야 함
    const depositDueAlerts = sentNotifications.filter(
      (n) => n.userId === contract.clientUserId && n.type === "DEPOSIT_DUE",
    );
    assert.equal(depositDueAlerts.length, 1);
  });

  it("C-04-T07 작업 마감 지남은 저장 상태가 아닌 파생값", () => {
    const { batchService } = createTestSetup();

    const workDueAt = new Date("2026-12-16T10:00:00.000Z");

    // 마감 이전
    assert.equal(
      batchService.isWorkOverdue({
        workDueAt,
        finalStageStatus: "PENDING",
        now: new Date("2026-12-15T10:00:00.000Z"),
      }),
      false,
    );

    // 마감 초과
    assert.equal(
      batchService.isWorkOverdue({
        workDueAt,
        finalStageStatus: "PENDING",
        now: new Date("2026-12-17T10:00:00.000Z"),
      }),
      true,
    );

    // 마감이 지났어도 이미 최종 납품이 완료(DELIVERED/APPROVED)되었으면 overdue가 아님
    assert.equal(
      batchService.isWorkOverdue({
        workDueAt,
        finalStageStatus: "APPROVED",
        now: new Date("2026-12-17T10:00:00.000Z"),
      }),
      false,
    );
  });

  it("C-04-T08 이견 재개시 정상 검수 흐름", async () => {
    const { repo, installment, item1, batchService } = createTestSetup();

    const delivery = await repo.createDelivery({
      installmentId: installment.id,
      attemptNo: 1,
      items: [{ contractItemId: item1.id, links: [], files: [], howToCheck: "" }],
      summary: null,
      status: "REWORK_REQUESTED",
      submittedAt: baseTime,
      inspectionDueAt: sevenDaysLater,
      reviewedAt: null,
    });

    const inspReq = await repo.createInspectionRequest({
      deliveryId: delivery.id,
      contractItemId: item1.id,
      reason: "CONDITION_MISMATCH",
      conditionKey: "c-1",
      status: "ESCALATED",
      escalatedAt: baseTime,
      createdAt: baseTime,
    });

    // 판정 결과가 REWORK_VALID인 경우
    const decided = await batchService.decideDispute({
      inspectionRequestId: inspReq.id,
      decision: "REWORK_VALID",
      reason: "보완 요청이 정당합니다.",
      decisionNotes: { client: "공급자에게 보완을 지시했습니다.", supplier: "기능을 보완하여 다시 제출하세요." },
    });

    assert.equal(decided.decision, "REWORK_VALID");
    assert.equal(decided.status, "OPEN"); // 공급자 재납품 대기

    // 검수 항목은 아직 미승인 상태로 정상 유지
    const item = await repo.getContractItem(item1.id);
    assert.equal(item?.approvedAt, null);
  });
});
