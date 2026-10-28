import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import { createApp } from "../src/app.ts";
import { prisma } from "../src/db.ts";
import {
  calculateClientEstimateSummary,
  computeTrimmedEstimate,
  reestimateForDraftRestore,
} from "../src/rates/rates.service.ts";
import { assertRecord, getServerPort, resetDatabase } from "./helpers.ts";

describe("F-04 공급자 단가 등록·절사평균 계산·스냅샷 보존·권한 분리", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await resetDatabase();
    await prisma.$disconnect();
  });

  it("선형 보간 Q1/Q3 경계를 포함하고 평균을 원 단위로 반올림한다", () => {
    // 5건: Q1=200, Q3=400, 경계 포함 -> [200, 300, 400]
    expect(computeTrimmedEstimate("b-5", [1000, 400, 300, 200, 100])).toEqual({
      blockId: "b-5",
      isEstimable: true,
      estUnit: 300,
      estMin: 200,
      estMax: 400,
    });
    // 6건: Q1 위치 1.25, Q3 위치 3.75 -> 가운데 2건만 남는다(기존 floor(n×0.25) 방식은 4건)
    const six = computeTrimmedEstimate("b-6", [100, 200, 300, 400, 500, 600]);
    expect([six.estMin, six.estMax, six.estUnit]).toEqual([300, 400, 350]);
    // 평균 20.67 -> 21 (내림이면 20)
    expect(computeTrimmedEstimate("b-r", [10, 20, 21, 21, 100]).estUnit).toBe(21);
  });

  it("8건 표본에서 25~75% 구간 값으로 절사평균을 계산한다", () => {
    const est = computeTrimmedEstimate("b-8", [
      50_000,
      100_000,
      200_000,
      210_001,
      240_000,
      280_000,
      500_000,
      900_000,
    ]);
    // Q1=175_000, Q3=335_000 -> [200_000, 210_001, 240_000, 280_000]
    expect(est.isEstimable).toBe(true);
    expect(est.estMin).toBe(200_000);
    expect(est.estMax).toBe(280_000);
    expect(est.estUnit).toBe(Math.round((200_000 + 210_001 + 240_000 + 280_000) / 4));
  });

  it("예상 합계에 미산출 항목을 빼고 의뢰인 수수료 끝수를 원 단위로 내린다", () => {
    const summary = calculateClientEstimateSummary([
      {
        blockId: "estimable",
        isEstimable: true,
        estUnit: 1_000_001,
        estMin: 500_000,
        estMax: 1_500_001,
      },
      {
        blockId: "unestimable",
        isEstimable: false,
        estUnit: null,
        estMin: null,
        estMax: null,
      },
    ]);

    expect(summary).toEqual({
      estimableCount: 1,
      unestimableCount: 1,
      supplyAmount: 1_000_001,
      minSupplyAmount: 500_000,
      maxSupplyAmount: 1_500_001,
      clientFee: 50_000,
      totalWithFee: 1_050_001,
    });
  });

  it("4명/5명 경계, 평균 참고 제외, 스냅샷 불변성, 보관 복구 재집계, 역할별 비공개를 보장한다", async () => {
    process.env.ALLOW_HEADER_AUTH = "true";
    const app = createApp();
    const server = app.listen(0);

    try {
      const port = getServerPort(server);
      const base = `http://127.0.0.1:${port}`;

      const client = await prisma.user.create({
        data: { email: "client@test.local", name: "의뢰인", role: "CLIENT" },
      });
      const [sup1, sup2, sup3, sup4, sup5, sup6] = await Promise.all([
        prisma.user.create({
          data: { email: "sup1@test.local", name: "공급자1", role: "SUPPLIER", supplierProfile: { create: { displayName: "공급자1" } } },
        }),
        prisma.user.create({
          data: { email: "sup2@test.local", name: "공급자2", role: "SUPPLIER", supplierProfile: { create: { displayName: "공급자2" } } },
        }),
        prisma.user.create({
          data: { email: "sup3@test.local", name: "공급자3", role: "SUPPLIER", supplierProfile: { create: { displayName: "공급자3" } } },
        }),
        prisma.user.create({
          data: { email: "sup4@test.local", name: "공급자4", role: "SUPPLIER", supplierProfile: { create: { displayName: "공급자4" } } },
        }),
        prisma.user.create({
          data: { email: "sup5@test.local", name: "공급자5", role: "SUPPLIER", supplierProfile: { create: { displayName: "공급자5" } } },
        }),
        prisma.user.create({
          data: { email: "sup6@test.local", name: "공급자6", role: "SUPPLIER", supplierProfile: { create: { displayName: "공급자6" } } },
        }),
      ]);
      const firstFour = [
        { user: sup1, price: 100_000 },
        { user: sup2, price: 200_000 },
        { user: sup3, price: 250_000 },
        { user: sup4, price: 300_000 },
      ];

      const blockA = await prisma.blockCatalog.create({
        data: {
          code: "RESERVATION_CALENDAR",
          name: "예약 캘린더",
          description: "날짜·시간 선택 예약",
          industryCode: "RESTAURANT_RESERVATION",
          techTags: ["React", "Node.js"],
        },
      });
      const blockB = await prisma.blockCatalog.create({
        data: {
          code: "MENU_GALLERY",
          name: "메뉴 소개",
          description: "사진·가격 안내",
          industryCode: "RESTAURANT_RESERVATION",
          techTags: ["React"],
        },
      });

      // 미인증 요청 401, 의뢰인이 공급자 단가 API 호출 시 403
      const unauthRes = await fetch(`${base}/api/supplier/rates`);
      expect(unauthRes.status).toBe(401);

      const clientWriteRes = await fetch(`${base}/api/supplier/rates`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-id": client.id,
          "x-user-role": "CLIENT",
        },
        body: JSON.stringify({ blockId: blockA.id, price: 200_000 }),
      });
      expect(clientWriteRes.status).toBe(403);

      // 4명만 유효 가격 등록 -> 5명 미만이므로 isEstimable = false
      for (const entry of firstFour) {
        const res = await fetch(`${base}/api/supplier/rates`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-user-id": entry.user.id,
            "x-user-role": "SUPPLIER",
          },
          body: JSON.stringify({ blockId: blockA.id, price: entry.price }),
        });
        expect(res.status).toBe(201);
      }

      // 중복 등록 시도 -> 409 CONFLICT
      const dupRes = await fetch(`${base}/api/supplier/rates`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-id": sup1.id,
          "x-user-role": "SUPPLIER",
        },
        body: JSON.stringify({ blockId: blockA.id, price: 150_000 }),
      });
      expect(dupRes.status).toBe(409);

      // 5번째 공급자가 평균 참고 입력(isAvgReference=true)으로 등록 -> 집계 제외되어 여전히 4건(미산출)
      const avgRefRes = await fetch(`${base}/api/supplier/rates`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-id": sup5.id,
          "x-user-role": "SUPPLIER",
        },
        body: JSON.stringify({ blockId: blockA.id, price: 250_000, isAvgReference: true }),
      });
      expect(avgRefRes.status).toBe(201);

      // 6번째 공급자가 수행 불가(isCapable=false) 등록 -> 집계 제외 및 rateCompleted=false 확인
      const incapableRes = await fetch(`${base}/api/supplier/rates`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-id": sup6.id,
          "x-user-role": "SUPPLIER",
        },
        body: JSON.stringify({ blockId: blockA.id, isCapable: false }),
      });
      expect(incapableRes.status).toBe(201);
      const incapableBody = assertRecord(await incapableRes.json());
      expect(incapableBody.rateCompleted).toBe(false);

      const est4Res = await fetch(`${base}/api/blocks/${blockA.id}/estimate`, {
        headers: { "x-user-id": client.id, "x-user-role": "CLIENT" },
      });
      expect(est4Res.status).toBe(200);
      expect(await est4Res.json()).toEqual({
        blockId: blockA.id,
        isEstimable: false,
        estUnit: null,
        estMin: null,
        estMax: null,
      });

      // 6번째 공급자가 수행 가능 단가(900,000원)로 수정 -> 유효 표본 5건 [100k, 200k, 250k, 300k, 900k]
      const patchToCapable = await fetch(`${base}/api/supplier/rates/${blockA.id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-user-id": sup6.id,
          "x-user-role": "SUPPLIER",
        },
        body: JSON.stringify({ isCapable: true, price: 900_000 }),
      });
      expect(patchToCapable.status).toBe(200);
      const capableBody = assertRecord(await patchToCapable.json());
      expect(capableBody.rateCompleted).toBe(true);

      // 공급자가 의뢰인용 예상 단가·범위 API 조회 시 403 차단
      const supEstForbidden = await fetch(`${base}/api/blocks/${blockA.id}/estimate`, {
        headers: { "x-user-id": sup1.id, "x-user-role": "SUPPLIER" },
      });
      expect(supEstForbidden.status).toBe(403);

      // 공급자 본인 단가 조회 시 본인 단가 1건만 보이고 타 공급자 단가는 노출되지 않음
      const myRatesRes = await fetch(`${base}/api/supplier/rates`, {
        headers: { "x-user-id": sup1.id, "x-user-role": "SUPPLIER" },
      });
      expect(myRatesRes.status).toBe(200);
      const myRatesBody = assertRecord(await myRatesRes.json());
      expect(myRatesBody.rateCompleted).toBe(true);
      if (!Array.isArray(myRatesBody.items)) {
        throw new Error("공급자 단가 항목은 배열이어야 합니다.");
      }
      expect(myRatesBody.items.length).toBe(1);
      expect(assertRecord(myRatesBody.items[0]).price).toBe(100_000);

      // 의뢰인이 복수 블록(산출 가능 blockA + 미산출 blockB) 합계 조회 -> 5% 수수료 분리 및 미산출 합계 제외
      const batchEstRes = await fetch(
        `${base}/api/blocks/estimates?blockIds=${blockA.id},${blockB.id}`,
        { headers: { "x-user-id": client.id, "x-user-role": "CLIENT" } },
      );
      expect(batchEstRes.status).toBe(200);
      const batchEstBody = assertRecord(await batchEstRes.json());
      if (!Array.isArray(batchEstBody.items)) {
        throw new Error("일괄 예상 항목은 배열이어야 합니다.");
      }
      const summary = assertRecord(batchEstBody.summary);
      expect(batchEstBody.items[0]).toEqual({
        blockId: blockA.id,
        isEstimable: true,
        estUnit: 250_000,
        estMin: 200_000,
        estMax: 300_000,
      });
      expect(assertRecord(batchEstBody.items[1]).isEstimable).toBe(false);
      expect(summary.estimableCount).toBe(1);
      expect(summary.unestimableCount).toBe(1);
      expect(summary.supplyAmount).toBe(250_000);
      expect(summary.clientFee).toBe(12_500);
      expect(summary.totalWithFee).toBe(262_500);

      // 초안에 복사된 스냅샷은 이후 공급자 단가가 바뀌어도 변경되지 않으며, 보관 복구 시에만 재집계 비교
      const draft = await prisma.draft.create({
        data: { clientId: client.id, entryType: "DEFAULT_DRAFT", status: "ABANDONED" },
      });
      const draftBlock = await prisma.draftBlock.create({
        data: {
          draftId: draft.id,
          blockId: blockA.id,
          origin: "DEFAULT_DRAFT",
          status: "ADDED",
          isEstimable: true,
          estUnit: 250_000,
          estMin: 200_000,
          estMax: 300_000,
          pricedAt: new Date(),
        },
      });

      await fetch(`${base}/api/supplier/rates/${blockA.id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-user-id": sup3.id,
          "x-user-role": "SUPPLIER",
        },
        body: JSON.stringify({ price: 280_000 }),
      });

      const unchangedDraftBlock = await prisma.draftBlock.findUniqueOrThrow({
        where: { id: draftBlock.id },
      });
      expect(unchangedDraftBlock.estUnit).toBe(250_000);

      const restored = await reestimateForDraftRestore(prisma, [
        {
          blockId: unchangedDraftBlock.blockId,
          isEstimable: unchangedDraftBlock.isEstimable,
          estUnit: unchangedDraftBlock.estUnit,
          estMin: unchangedDraftBlock.estMin,
          estMax: unchangedDraftBlock.estMax,
        },
      ]);
      expect(restored.items[0]?.changed).toBe(true);
      expect(restored.items[0]?.current.estUnit).toBe(260_000);
    } finally {
      server.close();
    }
  });
});
