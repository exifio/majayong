import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ReviewService,
  ReviewHttpError,
  createInMemoryReviewRepository,
  type ReviewContractEntity,
} from "../../src/modules/review/index.ts";

describe("C-07: 완료 후 상호 리뷰·공개 평점", () => {
  const baseTime = new Date("2026-11-25T10:00:00.000Z");

  function createTestSetup(options?: { contractStatus?: string }) {
    const repo = createInMemoryReviewRepository();

    const contract: ReviewContractEntity = {
      id: "contract-c07",
      clientUserId: "client-c07",
      supplierUserId: "supplier-c07",
      status: options?.contractStatus ?? "COMPLETED",
    };

    let profileStatsUpdateCount = 0;
    const profilePorts = {
      async updateProfileReviewStats(input: { targetUserId: string; rating: number }) {
        profileStatsUpdateCount++;
        return { success: true };
      },
    };

    repo.seedContract(contract);

    const service = new ReviewService({
      repo,
      profilePorts,
      clock: { now: () => baseTime },
    });

    return { repo, contract, service, getStatsUpdateCount: () => profileStatsUpdateCount };
  }

  it("C-07-T01 계약 완료 전 리뷰 불가", async () => {
    // 계약이 아직 ACTIVE(진행 중) 상태
    const { service, contract } = createTestSetup({ contractStatus: "ACTIVE" });

    await assert.rejects(
      () =>
        service.createReview(
          { userId: contract.clientUserId, role: "CLIENT" },
          {
            contractId: contract.id,
            rating: 5,
            comment: "좋은 작업이었습니다.",
            tags: ["전문적이에요", "친절해요"],
          },
        ),
      (err: unknown) => {
        if (!(err instanceof ReviewHttpError)) return false;
        assert.equal(err.status, 409);
        assert.match(err.message, /완료된 계약만/);
        return true;
      },
    );
  });

  it("C-07-T02 계약당 작성자 1회 유니크", async () => {
    const { service, contract } = createTestSetup();

    // 1회차 정상 작성
    const r1 = await service.createReview(
      { userId: contract.clientUserId, role: "CLIENT" },
      {
        contractId: contract.id,
        rating: 5,
        comment: "완벽합니다.",
        tags: ["친절해요"],
      },
    );
    assert.equal(r1.rating, 5);

    // 동일 작성자가 동일 계약에 2회차 작성 시도 -> 409 거부
    await assert.rejects(
      () =>
        service.createReview(
          { userId: contract.clientUserId, role: "CLIENT" },
          {
            contractId: contract.id,
            rating: 4,
            comment: "중복 작성 시도",
            tags: [],
          },
        ),
      (err: unknown) => {
        if (!(err instanceof ReviewHttpError)) return false;
        assert.equal(err.status, 409);
        assert.match(err.message, /이미 리뷰를 작성/);
        return true;
      },
    );
  });

  it("C-07-T03 별점 0/6/소수 차단", async () => {
    const { service, contract } = createTestSetup();

    // 0점 차단
    await assert.rejects(
      () =>
        service.createReview(
          { userId: contract.clientUserId, role: "CLIENT" },
          { contractId: contract.id, rating: 0, tags: [] },
        ),
      (err: unknown) => {
        if (!(err instanceof ReviewHttpError)) return false;
        assert.equal(err.status, 400);
        assert.match(err.message, /1~5/);
        return true;
      },
    );

    // 6점 차단
    await assert.rejects(
      () =>
        service.createReview(
          { userId: contract.clientUserId, role: "CLIENT" },
          { contractId: contract.id, rating: 6, tags: [] },
        ),
      (err: unknown) => {
        if (!(err instanceof ReviewHttpError)) return false;
        assert.equal(err.status, 400);
        assert.match(err.message, /1~5/);
        return true;
      },
    );

    // 4.5 소수 차단 (정수만 허용)
    await assert.rejects(
      () =>
        service.createReview(
          { userId: contract.clientUserId, role: "CLIENT" },
          { contractId: contract.id, rating: 4.5, tags: [] },
        ),
      (err: unknown) => {
        if (!(err instanceof ReviewHttpError)) return false;
        assert.equal(err.status, 400);
        assert.match(err.message, /정수/);
        return true;
      },
    );
  });

  it("C-07-T04 리뷰 수정/삭제 차단", async () => {
    const { service, contract } = createTestSetup();

    const r = await service.createReview(
      { userId: contract.clientUserId, role: "CLIENT" },
      { contractId: contract.id, rating: 5, comment: "초기 리뷰", tags: [] },
    );

    // 수정 불가
    assert.equal(typeof (service as Record<string, unknown>).updateReview, "undefined");
    // 삭제 불가
    assert.equal(typeof (service as Record<string, unknown>).deleteReview, "undefined");
  });

  it("C-07-T05 중복 제출 시 평점 캐시 중복계산 0", async () => {
    const { service, contract, getStatsUpdateCount } = createTestSetup();

    // 1회차 성공
    await service.createReview(
      { userId: contract.clientUserId, role: "CLIENT" },
      { contractId: contract.id, rating: 5, tags: [] },
    );
    assert.equal(getStatsUpdateCount(), 1);

    // 2회차 실패
    await assert.rejects(
      () =>
        service.createReview(
          { userId: contract.clientUserId, role: "CLIENT" },
          { contractId: contract.id, rating: 5, tags: [] },
        ),
      ReviewHttpError,
    );

    // 중복 호출에도 평점 캐시 갱신 포트는 1회만 호출됨
    assert.equal(getStatsUpdateCount(), 1);
  });

  it("C-07-T06 연락처/이메일 노출 0", async () => {
    const { service, contract } = createTestSetup();

    // 리뷰 본문에 전화번호 및 이메일이 포함된 경우 마스킹되어 저장됨
    const rawComment = "연락처는 010-1234-5678 이고 이메일은 test@example.com 입니다.";
    const review = await service.createReview(
      { userId: contract.clientUserId, role: "CLIENT" },
      { contractId: contract.id, rating: 5, comment: rawComment, tags: [] },
    );

    assert.equal(review.comment?.includes("010-1234-5678"), false);
    assert.equal(review.comment?.includes("test@example.com"), false);
    assert.match(review.comment ?? "", /\[연락처\]/);
  });
});
