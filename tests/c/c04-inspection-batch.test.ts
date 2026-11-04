import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DeliveryService,
  InspectionBatchService,
  createInMemoryDeliveryRepository,
  type ContractItemEntity,
  type DeliveryContractInfo,
  type DeliveryEntity,
  type InspectionOpsPorts,
  type NotificationPorts,
} from "../../src/modules/delivery/index.ts";

describe("C-04: 자동 승인·이견 3택·기한 배치", () => {
  const baseTime = new Date("2026-11-10T10:00:00.000Z");
  const sevenDaysLater = new Date(baseTime.getTime() + 7 * 24 * 60 * 60 * 1000);

  function createTestSetup(options?: {
    settlementPort?: { approveInstallment(input: { contractId: string; installmentId: string }): Promise<unknown> };
    opsPorts?: InspectionOpsPorts;
  }) {
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
      settlementPort: options?.settlementPort,
      opsPorts: options?.opsPorts,
    });

    const deliveryService = new DeliveryService({
      repo,
      clock: { now: () => baseTime },
      settlementPort: options?.settlementPort,
      opsPorts: options?.opsPorts,
    });

    return {
      repo,
      contract,
      installment,
      item1,
      item2,
      sentNotifications,
      batchService,
      deliveryService,
      notificationPorts,
    };
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

    // 2. 기한 정각까지는 유효 -> 자동 승인 0건
    const resExact = await batchService.processAutoApproval(delivery.id, sevenDaysLater);
    assert.equal(resExact.autoApprovedCount, 0);

    // 3. 기한을 넘긴 직후 -> 자동 승인 1건, 다시 실행하면 0건
    const justAfter = new Date(sevenDaysLater.getTime() + 1);
    const resAfter = await batchService.processAutoApproval(delivery.id, justAfter);
    assert.equal(resAfter.autoApprovedCount, 1);
    const itemExact = await repo.getContractItem(item1.id);
    assert.ok(itemExact?.approvedAt);
    assert.equal(itemExact.autoApproved, true);

    const resAgain = await batchService.processAutoApproval(delivery.id, new Date(sevenDaysLater.getTime() + 1000));
    assert.equal(resAgain.autoApprovedCount, 0);
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
    const res = await batchService.processAutoApproval(delivery.id, new Date(sevenDaysLater.getTime() + 1));
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
    const res = await batchService.processAutoApproval(delivery.id, new Date(sevenDaysLater.getTime() + 1));
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
    const { repo, contract, sentNotifications, batchService } = createTestSetup();

    // 예치 전 계약이어야 DEPOSIT_DUE 대상이다.
    repo.seedContract({ ...contract, paymentStatus: "PENDING" });

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

  function itemPayload(contractItemId: string) {
    return { contractItemId, links: [`https://app/${contractItemId}`], files: [], howToCheck: "확인" };
  }

  it("C-04-F01 가장 최근 납품만 자동 승인 판단 기준이 됨", async () => {
    const { repo, installment, item1, item2, batchService } = createTestSetup();

    const d1 = await repo.createDelivery({
      installmentId: installment.id,
      attemptNo: 1,
      items: [itemPayload(item1.id), itemPayload(item2.id)],
      summary: null,
      status: "REWORK_REQUESTED",
      submittedAt: baseTime,
      inspectionDueAt: sevenDaysLater,
      reviewedAt: null,
    });
    // 이전 납품에 남아 있는 OPEN (재납품 후 해소되지 않은 레거시 상태)
    await repo.createInspectionRequest({
      deliveryId: d1.id,
      contractItemId: item1.id,
      reason: "NOT_WORKING",
      conditionKey: null,
      note: "이전 회차 미작동",
      status: "OPEN",
      escalatedAt: null,
      resolvedAt: null,
      createdAt: baseTime,
    });

    const d2Due = new Date(sevenDaysLater.getTime() + 7 * 24 * 60 * 60 * 1000);
    const d2 = await repo.createDelivery({
      installmentId: installment.id,
      attemptNo: 2,
      items: [itemPayload(item1.id), itemPayload(item2.id)],
      summary: null,
      status: "SUBMITTED",
      submittedAt: sevenDaysLater,
      inspectionDueAt: d2Due,
      reviewedAt: null,
    });

    // 최신이 아닌 납품으로는 자동 승인하지 않는다.
    assert.equal(
      (await batchService.processAutoApproval(d1.id, new Date(sevenDaysLater.getTime() + 1000))).autoApprovedCount,
      0,
    );

    // 최신 납품은 이전 회차 OPEN 때문에 막히지 않는다.
    const res = await batchService.processAutoApproval(d2.id, new Date(d2Due.getTime() + 1));
    assert.equal(res.autoApprovedCount, 2);

    const escalated = createTestSetup();
    const d3 = await escalated.repo.createDelivery({
      installmentId: escalated.installment.id,
      attemptNo: 1,
      items: [itemPayload(escalated.item1.id)],
      summary: null,
      status: "SUBMITTED",
      submittedAt: baseTime,
      inspectionDueAt: sevenDaysLater,
      reviewedAt: null,
    });
    await escalated.repo.createInspectionRequest({
      deliveryId: d3.id,
      contractItemId: escalated.item1.id,
      reason: "OTHER",
      conditionKey: null,
      note: "운영자 판정 대기",
      status: "ESCALATED",
      escalatedAt: baseTime,
      createdAt: baseTime,
    });
    assert.equal(
      (
        await escalated.batchService.processAutoApproval(d3.id, new Date(sevenDaysLater.getTime() + 1))
      ).autoApprovedCount,
      0,
    );
  });

  it("C-04-F02 세 번째 보완 요청은 자동으로 ESCALATED 처리됨", async () => {
    const messages: Array<{ contractId: string; targetId: string; body: string }> = [];
    const events: Array<{ actionType: string; targetId: string }> = [];
    const setup = createTestSetup({
      opsPorts: {
        async createSystemMessage(input) {
          messages.push(input);
        },
        async recordEvent(input) {
          events.push(input);
        },
      },
    });
    const { repo, contract, installment, item1, deliveryService } = setup;
    const supplier = { userId: contract.supplierUserId, role: "SUPPLIER" };
    const client = { userId: contract.clientUserId, role: "CLIENT" };
    repo.seedInstallment({ ...installment, status: "PENDING" });

    let delivery = await deliveryService.submitDelivery(supplier, {
      installmentId: installment.id,
      items: [itemPayload(item1.id)],
    });
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await deliveryService.requestRework(client, {
        deliveryId: delivery.id,
        contractItemId: item1.id,
        reason: "NOT_WORKING",
        note: `보완 요청 ${attempt}`,
      });
      if (attempt < 3) {
        delivery = await deliveryService.submitDelivery(supplier, {
          installmentId: installment.id,
          items: [itemPayload(item1.id)],
        });
      }
    }

    const inspections = await repo.listInspectionRequestsByItem(item1.id);
    assert.equal(inspections.length, 3);
    const latest = inspections[inspections.length - 1];
    assert.equal(latest.status, "ESCALATED");
    assert.ok(latest.escalatedAt);
    assert.equal(messages.length, 1);
    assert.equal(events.filter((event) => event.actionType === "DISPUTE_ESCALATED").length, 1);
  });

  it("C-04-F02b 사용자 도움 요청 #087은 당사자만 가능하고 사유가 필수", async () => {
    const messages: Array<{ body: string }> = [];
    const setup = createTestSetup({
      opsPorts: {
        async createSystemMessage(input) {
          messages.push(input);
        },
      },
    });
    const { repo, contract, installment, item1, deliveryService } = setup;
    const supplier = { userId: contract.supplierUserId, role: "SUPPLIER" };
    const client = { userId: contract.clientUserId, role: "CLIENT" };
    repo.seedInstallment({ ...installment, status: "PENDING" });

    const delivery = await deliveryService.submitDelivery(supplier, {
      installmentId: installment.id,
      items: [itemPayload(item1.id)],
    });
    await deliveryService.requestRework(client, {
      deliveryId: delivery.id,
      contractItemId: item1.id,
      reason: "MISSING_PART",
      note: "일부 누락",
    });
    const [rework] = await repo.listInspectionRequestsByItem(item1.id);

    await assert.rejects(
      () =>
        deliveryService.escalateInspection(
          { userId: "outsider", role: "CLIENT" },
          rework.id,
          { reason: "도움 요청", what: "확인 요청" },
        ),
      /당사자/,
    );
    await assert.rejects(
      () => deliveryService.escalateInspection(client, rework.id, { reason: "   ", what: "확인 요청" }),
      /사유/,
    );

    const escalated = await deliveryService.escalateInspection(supplier, rework.id, {
      reason: "운영자 도움 요청",
      what: "동일 기능이 반복해서 동작하지 않습니다.",
      claims: { client: "미작동", supplier: "로컬에서는 동작" },
    });
    assert.equal(escalated.status, "ESCALATED");
    assert.ok(escalated.escalation);
    assert.equal(messages.length, 1);
  });

  it("C-04-F03 기한 알림은 대상·중복·중단 조건을 지킴", async () => {
    const DAY = 24 * 60 * 60 * 1000;

    // 예치 완료 뒤에는 DEPOSIT_DUE를 보내지 않는다.
    const deposited = createTestSetup();
    const depositDayBefore = new Date(deposited.contract.depositDeadline.getTime() - DAY);
    await deposited.batchService.sendDueNotifications(deposited.contract.id, depositDayBefore);
    assert.equal(
      deposited.sentNotifications.filter((n) => n.type === "DEPOSIT_DUE").length,
      0,
    );

    // 예치 전에는 1회만.
    const pendingDeposit = createTestSetup();
    pendingDeposit.repo.seedContract({ ...pendingDeposit.contract, paymentStatus: "PENDING" });
    await pendingDeposit.batchService.sendDueNotifications(pendingDeposit.contract.id, depositDayBefore);
    await pendingDeposit.batchService.sendDueNotifications(pendingDeposit.contract.id, depositDayBefore);
    assert.equal(
      pendingDeposit.sentNotifications.filter((n) => n.type === "DEPOSIT_DUE").length,
      1,
    );

    // 검수 기한 하루 전 의뢰인 알림 1회.
    const inspection = createTestSetup();
    const due = new Date(sevenDaysLater);
    await inspection.repo.createDelivery({
      installmentId: inspection.installment.id,
      attemptNo: 1,
      items: [itemPayload(inspection.item1.id)],
      summary: null,
      status: "SUBMITTED",
      submittedAt: baseTime,
      inspectionDueAt: due,
      reviewedAt: null,
    });
    const inspectionDayBefore = new Date(due.getTime() - DAY);
    await inspection.batchService.sendDueNotifications(inspection.contract.id, inspectionDayBefore);
    await inspection.batchService.sendDueNotifications(inspection.contract.id, inspectionDayBefore);
    const inspectionAlerts = inspection.sentNotifications.filter((n) => n.type === "INSPECTION_DUE");
    assert.equal(inspectionAlerts.length, 1);
    assert.equal(inspectionAlerts[0].userId, inspection.contract.clientUserId);

    // 최종 구간이 미완료면 WORK_DUE, 완료면 0.
    const workPending = createTestSetup();
    workPending.repo.seedInstallment({
      id: "inst-final",
      contractId: workPending.contract.id,
      stage: "FINAL",
      status: "PENDING",
    });
    const workDayBefore = new Date(workPending.contract.workDueAt.getTime() - DAY);
    await workPending.batchService.sendDueNotifications(workPending.contract.id, workDayBefore);
    assert.equal(
      workPending.sentNotifications.filter((n) => n.type === "WORK_DUE").length,
      1,
    );

    const workDone = createTestSetup();
    workDone.repo.seedInstallment({
      id: "inst-final",
      contractId: workDone.contract.id,
      stage: "FINAL",
      status: "APPROVED",
    });
    await workDone.batchService.sendDueNotifications(workDone.contract.id, workDayBefore);
    await workDone.batchService.sendDueNotifications(
      workDone.contract.id,
      new Date(workDone.contract.workDueAt.getTime() + DAY),
    );
    assert.equal(
      workDone.sentNotifications.filter((n) => n.type === "WORK_DUE" || n.type === "WORK_OVERDUE").length,
      0,
    );

    // 마감 지남은 양쪽 1회씩.
    const overdue = createTestSetup();
    overdue.repo.seedInstallment({
      id: "inst-final",
      contractId: overdue.contract.id,
      stage: "FINAL",
      status: "PENDING",
    });
    const afterDue = new Date(overdue.contract.workDueAt.getTime() + DAY);
    await overdue.batchService.sendDueNotifications(overdue.contract.id, afterDue);
    await overdue.batchService.sendDueNotifications(overdue.contract.id, afterDue);
    assert.equal(
      overdue.sentNotifications.filter((n) => n.type === "WORK_OVERDUE").length,
      2,
    );

    // 취소 요청 중에는 어떤 기한 알림도 보내지 않는다.
    const cancelled = createTestSetup();
    cancelled.repo.seedContract({ ...cancelled.contract, status: "CANCEL_REQUESTED" });
    await cancelled.batchService.sendDueNotifications(
      cancelled.contract.id,
      new Date(cancelled.contract.workDueAt.getTime() + DAY),
    );
    assert.equal(cancelled.sentNotifications.length, 0);
  });

  it("C-04-F04 승인·판정이 정산·재납품·감사 기록으로 연결됨", async () => {
    const settlementCalls: Array<{ contractId: string; installmentId: string }> = [];
    const messages: Array<{ body: string }> = [];
    const events: Array<{ actionType: string }> = [];
    const settlementPort = {
      async approveInstallment(input: { contractId: string; installmentId: string }) {
        settlementCalls.push(input);
        return {};
      },
    };
    const opsPorts: InspectionOpsPorts = {
      async createSystemMessage(input) {
        messages.push(input);
      },
      async recordEvent(input) {
        events.push(input);
      },
    };

    // 직접 승인으로 전 항목이 승인되면 정산 승인 요청을 보낸다.
    const approved = createTestSetup({ settlementPort, opsPorts });
    const d1 = await approved.repo.createDelivery({
      installmentId: approved.installment.id,
      attemptNo: 1,
      items: [itemPayload(approved.item1.id), itemPayload(approved.item2.id)],
      summary: null,
      status: "SUBMITTED",
      submittedAt: baseTime,
      inspectionDueAt: sevenDaysLater,
      reviewedAt: null,
    });
    const client = { userId: approved.contract.clientUserId, role: "CLIENT" };
    await approved.deliveryService.approveItem(client, {
      contractItemId: approved.item1.id,
      deliveryId: d1.id,
    });
    await approved.deliveryService.approveItem(client, {
      contractItemId: approved.item2.id,
      deliveryId: d1.id,
    });
    assert.equal(settlementCalls.length, 1);
    assert.equal(settlementCalls[0].installmentId, approved.installment.id);
    assert.equal((await approved.repo.getDelivery(d1.id))?.status, "APPROVED");

    // REWORK_VALID는 재납품 가능 상태로 되돌리고 감사 기록을 남긴다.
    const rework = createTestSetup({ settlementPort, opsPorts });
    const d2 = await rework.repo.createDelivery({
      installmentId: rework.installment.id,
      attemptNo: 1,
      items: [itemPayload(rework.item1.id)],
      summary: null,
      status: "REWORK_REQUESTED",
      submittedAt: baseTime,
      inspectionDueAt: sevenDaysLater,
      reviewedAt: null,
    });
    const escalated = await rework.repo.createInspectionRequest({
      deliveryId: d2.id,
      contractItemId: rework.item1.id,
      reason: "CONDITION_MISMATCH",
      conditionKey: "c-1",
      status: "ESCALATED",
      escalatedAt: baseTime,
      createdAt: baseTime,
    });
    const decisionsBefore = messages.length;
    const reworkDecision = await rework.batchService.decideDispute({
      inspectionRequestId: escalated.id,
      decision: "REWORK_VALID",
      reason: "보완 요청이 정당합니다.",
      decisionNotes: { client: "보완 지시", supplier: "다시 제출" },
    });
    assert.equal(reworkDecision.status, "OPEN");
    assert.equal((await rework.repo.getDelivery(d2.id))?.status, "REWORK_REQUESTED");
    assert.equal((await rework.repo.getInstallment(rework.installment.id))?.status, "REWORK_REQUESTED");
    assert.equal((await rework.repo.getContractItem(rework.item1.id))?.approvedAt, null);
    assert.ok(messages.length > decisionsBefore);
    assert.ok(events.some((event) => event.actionType === "DISPUTE_DECIDED"));

    // APPROVE는 항목 승인과 함께 정산 승인 요청까지 수행한다.
    const approving = createTestSetup({ settlementPort, opsPorts });
    await approving.repo.updateContractItem(approving.item2.id, { approvedAt: baseTime });
    const d3 = await approving.repo.createDelivery({
      installmentId: approving.installment.id,
      attemptNo: 1,
      items: [itemPayload(approving.item1.id)],
      summary: null,
      status: "REWORK_REQUESTED",
      submittedAt: baseTime,
      inspectionDueAt: sevenDaysLater,
      reviewedAt: null,
    });
    const escalated2 = await approving.repo.createInspectionRequest({
      deliveryId: d3.id,
      contractItemId: approving.item1.id,
      reason: "OTHER",
      conditionKey: null,
      status: "ESCALATED",
      escalatedAt: baseTime,
      createdAt: baseTime,
    });
    const approveDecision = await approving.batchService.decideDispute({
      inspectionRequestId: escalated2.id,
      decision: "APPROVE",
      reason: "기능 확인됨",
      decisionNotes: { client: "승인", supplier: "승인" },
    });
    assert.equal(approveDecision.status, "RESOLVED");
    assert.ok((await approving.repo.getContractItem(approving.item1.id))?.approvedAt);
    assert.equal(settlementCalls.length, 2);
    assert.ok(messages.some((message) => message.body.includes("승인")));
  });
});
