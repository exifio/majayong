import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DeliveryService,
  DeliveryHttpError,
  createInMemoryDeliveryRepository,
  type ContractItemEntity,
  type DeliveryContractInfo,
} from "../../src/modules/delivery/index.ts";

describe("C-03: 항목별 납품·승인·보완 요청", () => {
  const baseTime = new Date("2026-11-10T10:00:00.000Z");

  function createTestSetup() {
    const repo = createInMemoryDeliveryRepository();

    const contract: DeliveryContractInfo = {
      id: "contract-1",
      clientUserId: "client-1",
      supplierUserId: "supplier-1",
      status: "ACTIVE",
      paymentStatus: "DEPOSITED",
    };

    const installment = {
      id: "inst-interim-1",
      contractId: "contract-1",
      stage: "INTERIM" as const,
      status: "PENDING" as const,
    };

    const item1: ContractItemEntity = {
      id: "item-1",
      contractId: "contract-1",
      stage: "INTERIM",
      title: "예약 달력",
      description: "예약 달력 화면 구현",
      conditions: [
        { key: "cond-1", text: "10분 단위 선택", state: "DECIDED" },
        { key: "cond-2", text: "노쇼 표시 방식", state: "UNDECIDED" },
      ],
      approvedAt: null,
      autoApproved: false,
    };

    const item2: ContractItemEntity = {
      id: "item-2",
      contractId: "contract-1",
      stage: "INTERIM",
      title: "예약금 결제",
      description: "PG 결제 연동",
      conditions: [{ key: "cond-3", text: "카드 결제 영수증", state: "DECIDED" }],
      approvedAt: null,
      autoApproved: false,
    };

    const alienItem: ContractItemEntity = {
      id: "alien-item-99",
      contractId: "other-contract-99",
      stage: "INTERIM",
      title: "외부 계약 항목",
      description: "다른 계약 항목",
      conditions: [],
      approvedAt: null,
      autoApproved: false,
    };

    repo.seedContract(contract);
    repo.seedInstallment(installment);
    repo.seedContractItems([item1, item2, alienItem]);

    const service = new DeliveryService({
      repo,
      clock: { now: () => baseTime },
    });

    return { repo, contract, installment, item1, item2, alienItem, service };
  }

  it("C-03-T01 타 계약 ID 삽입 차단", async () => {
    const { service, contract, installment, alienItem } = createTestSetup();

    // 다른 계약의 contractItemId를 포함하여 납품 시도 -> 400 거부
    await assert.rejects(
      () =>
        service.submitDelivery(
          { userId: contract.supplierUserId, role: "SUPPLIER" },
          {
            installmentId: installment.id,
            items: [
              {
                contractItemId: alienItem.id, // 타 계약 항목
                links: ["https://github.com/ex/repo"],
                files: [],
                howToCheck: "확인 방법",
              },
            ],
            summary: "1회차 납품",
          },
        ),
      (err: unknown) => {
        if (!(err instanceof DeliveryHttpError)) return false;
        assert.equal(err.status, 400);
        assert.match(err.message, /계약 항목이 아닙니다/);
        return true;
      },
    );
  });

  it("C-03-T02 의뢰인 아닌 승인/공급자 아닌 납품 거부", async () => {
    const { service, contract, installment, item1 } = createTestSetup();

    // 1. 의뢰인이 납품 제출 시도 -> 403 거부 (공급자만 제출 가능)
    await assert.rejects(
      () =>
        service.submitDelivery(
          { userId: contract.clientUserId, role: "CLIENT" },
          {
            installmentId: installment.id,
            items: [{ contractItemId: item1.id, links: [], files: [], howToCheck: "확인" }],
          },
        ),
      (err: unknown) => {
        if (!(err instanceof DeliveryHttpError)) return false;
        assert.equal(err.status, 403);
        assert.match(err.message, /공급자만/);
        return true;
      },
    );

    // 정상 납품 제출
    const delivery = await service.submitDelivery(
      { userId: contract.supplierUserId, role: "SUPPLIER" },
      {
        installmentId: installment.id,
        items: [{ contractItemId: item1.id, links: ["https://preview.app"], files: [], howToCheck: "확인" }],
      },
    );

    // 2. 공급자가 직접 승인 시도 -> 403 거부 (의뢰인만 승인 가능)
    await assert.rejects(
      () =>
        service.approveItem(
          { userId: contract.supplierUserId, role: "SUPPLIER" },
          { contractItemId: item1.id, deliveryId: delivery.id },
        ),
      (err: unknown) => {
        if (!(err instanceof DeliveryHttpError)) return false;
        assert.equal(err.status, 403);
        assert.match(err.message, /의뢰인만/);
        return true;
      },
    );
  });

  it("C-03-T03 승인 항목 재검수 불가", async () => {
    const { service, contract, installment, item1 } = createTestSetup();

    const delivery = await service.submitDelivery(
      { userId: contract.supplierUserId, role: "SUPPLIER" },
      {
        installmentId: installment.id,
        items: [{ contractItemId: item1.id, links: ["https://preview.app"], files: [], howToCheck: "확인" }],
      },
    );

    // 의뢰인이 승인 완료
    const approved = await service.approveItem(
      { userId: contract.clientUserId, role: "CLIENT" },
      { contractItemId: item1.id, deliveryId: delivery.id },
    );
    assert.ok(approved.approvedAt);
    assert.equal(approved.autoApproved, false);

    // 이미 승인된 항목에 대해 보완 요청 시도 -> 409 거부
    await assert.rejects(
      () =>
        service.requestRework(
          { userId: contract.clientUserId, role: "CLIENT" },
          {
            deliveryId: delivery.id,
            contractItemId: item1.id,
            reason: "CONDITION_MISMATCH",
            conditionKey: "cond-1",
            note: "다시 해주세요",
          },
        ),
      (err: unknown) => {
        if (!(err instanceof DeliveryHttpError)) return false;
        assert.equal(err.status, 409);
        assert.match(err.message, /이미 승인된/);
        return true;
      },
    );
  });

  it("C-03-T04 미정 조건만의 부당한 보완 불가", async () => {
    const { service, contract, installment, item1 } = createTestSetup();

    const delivery = await service.submitDelivery(
      { userId: contract.supplierUserId, role: "SUPPLIER" },
      {
        installmentId: installment.id,
        items: [{ contractItemId: item1.id, links: ["https://preview.app"], files: [], howToCheck: "확인" }],
      },
    );

    // cond-2는 UNDECIDED 상태. 이를 단독 이유로 CONDITION_MISMATCH 보완 요구 시도 -> 422 거부
    await assert.rejects(
      () =>
        service.requestRework(
          { userId: contract.clientUserId, role: "CLIENT" },
          {
            deliveryId: delivery.id,
            contractItemId: item1.id,
            reason: "CONDITION_MISMATCH",
            conditionKey: "cond-2", // UNDECIDED 조건
            note: "노쇼 표시 방식이 마음에 안 듭니다.",
          },
        ),
      (err: unknown) => {
        if (!(err instanceof DeliveryHttpError)) return false;
        assert.equal(err.status, 422);
        assert.match(err.message, /DECIDED/);
        return true;
      },
    );

    // DECIDED 조건인 cond-1에 대해서는 정상 보완 요청 가능
    const rework = await service.requestRework(
      { userId: contract.clientUserId, role: "CLIENT" },
      {
        deliveryId: delivery.id,
        contractItemId: item1.id,
        reason: "CONDITION_MISMATCH",
        conditionKey: "cond-1", // DECIDED 조건
        note: "10분 단위 선택이 동작하지 않습니다.",
      },
    );
    assert.equal(rework.status, "OPEN");
    assert.equal(rework.reason, "CONDITION_MISMATCH");
  });

  it("C-03-T05 7일 검사 기한", async () => {
    const { service, contract, installment, item1 } = createTestSetup();

    const delivery = await service.submitDelivery(
      { userId: contract.supplierUserId, role: "SUPPLIER" },
      {
        installmentId: installment.id,
        items: [{ contractItemId: item1.id, links: ["https://preview.app"], files: [], howToCheck: "확인" }],
      },
    );

    assert.equal(delivery.inspectionDueAt.toISOString(), "2026-11-17T14:59:59.999Z");
  });

  it("C-03-T06 보완 대상만 재납품", async () => {
    const { service, contract, installment, item1, item2 } = createTestSetup();

    // 1차 납품: item1, item2 둘 다 제출
    const d1 = await service.submitDelivery(
      { userId: contract.supplierUserId, role: "SUPPLIER" },
      {
        installmentId: installment.id,
        items: [
          { contractItemId: item1.id, links: ["https://app/1"], files: [], howToCheck: "확인1" },
          { contractItemId: item2.id, links: ["https://app/2"], files: [], howToCheck: "확인2" },
        ],
      },
    );
    assert.equal(d1.attemptNo, 1);

    // item1은 의뢰인이 승인
    await service.approveItem(
      { userId: contract.clientUserId, role: "CLIENT" },
      { contractItemId: item1.id, deliveryId: d1.id },
    );

    // item2는 보완 요청 발생
    await service.requestRework(
      { userId: contract.clientUserId, role: "CLIENT" },
      {
        deliveryId: d1.id,
        contractItemId: item2.id,
        reason: "NOT_WORKING",
        note: "결제 모듈 에러",
      },
    );

    // 2차 재납품 시도: 이미 승인된 item1을 다시 포함하면 400 거부
    await assert.rejects(
      () =>
        service.submitDelivery(
          { userId: contract.supplierUserId, role: "SUPPLIER" },
          {
            installmentId: installment.id,
            items: [
              { contractItemId: item1.id, links: ["https://app/1-again"], files: [], howToCheck: "재확인1" },
              { contractItemId: item2.id, links: ["https://app/2-fix"], files: [], howToCheck: "수정확인" },
            ],
          },
        ),
      (err: unknown) => {
        if (!(err instanceof DeliveryHttpError)) return false;
        assert.equal(err.status, 400);
        assert.match(err.message, /보완 요청된 미승인 항목만/);
        return true;
      },
    );

    // 보완 대상인 item2만 제출하면 2차 납품 성공
    const d2 = await service.submitDelivery(
      { userId: contract.supplierUserId, role: "SUPPLIER" },
      {
        installmentId: installment.id,
        items: [{ contractItemId: item2.id, links: ["https://app/2-fix"], files: [], howToCheck: "수정확인" }],
      },
    );
    assert.equal(d2.attemptNo, 2);
  });

  it("C-03-T07 JSON 파일 권한/크기 검증", async () => {
    const { service, contract, installment, item1 } = createTestSetup();

    // 허용 크기(50MB = 52,428,800 bytes) 초과 파일 제출 시도 -> 400 거부
    await assert.rejects(
      () =>
        service.submitDelivery(
          { userId: contract.supplierUserId, role: "SUPPLIER" },
          {
            installmentId: installment.id,
            items: [
              {
                contractItemId: item1.id,
                links: [],
                files: [
                  {
                    fileId: "file-huge",
                    name: "huge_video.mp4",
                    size: 60 * 1024 * 1024, // 60MB
                    mimeType: "video/mp4",
                  },
                ],
                howToCheck: "비디오 확인",
              },
            ],
          },
        ),
      (err: unknown) => {
        if (!(err instanceof DeliveryHttpError)) return false;
        assert.equal(err.status, 400);
        assert.match(err.message, /파일 크기/);
        return true;
      },
    );
  });

  it("C-03-T08 미완료 계약 납품 금지", async () => {
    const { service, contract, installment, item1, repo } = createTestSetup();

    // 계약이 아직 예치 전 (PENDING)
    repo.seedContract({
      ...contract,
      paymentStatus: "PENDING",
    });

    await assert.rejects(
      () =>
        service.submitDelivery(
          { userId: contract.supplierUserId, role: "SUPPLIER" },
          {
            installmentId: installment.id,
            items: [{ contractItemId: item1.id, links: [], files: [], howToCheck: "확인" }],
          },
        ),
      (err: unknown) => {
        if (!(err instanceof DeliveryHttpError)) return false;
        assert.equal(err.status, 409);
        assert.match(err.message, /예치 완료된 계약만/);
        return true;
      },
    );
  });

  it("C-03-T02b 다른 납품 ID로 항목을 승인하지 않음", async () => {
    const { service, contract, installment, item1, repo } = createTestSetup();

    await service.submitDelivery(
      { userId: contract.supplierUserId, role: "SUPPLIER" },
      {
        installmentId: installment.id,
        items: [{ contractItemId: item1.id, links: ["https://preview.app"], files: [], howToCheck: "확인" }],
      },
    );

    const other = await repo.createDelivery({
      installmentId: installment.id,
      attemptNo: 9,
      items: [],
      summary: null,
      status: "SUBMITTED",
      submittedAt: baseTime,
      inspectionDueAt: new Date(baseTime.getTime() + 7 * 24 * 60 * 60 * 1000),
      reviewedAt: null,
    });

    await assert.rejects(
      () =>
        service.approveItem(
          { userId: contract.clientUserId, role: "CLIENT" },
          { contractItemId: item1.id, deliveryId: other.id },
        ),
      (err: unknown) => {
        if (!(err instanceof DeliveryHttpError)) return false;
        assert.equal(err.status, 404);
        return true;
      },
    );

    const item = await repo.getContractItem(item1.id);
    assert.equal(item?.approvedAt, null);
  });
});
