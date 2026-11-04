import { describe, expect, it, jest } from "@jest/globals";
import { WithdrawalStore, withdrawAccount } from "./auth.ts";

describe("계정 탈퇴", () => {
  it("계약 조회 Port가 진행 중인 작업을 보고하면 탈퇴를 막는다", async () => {
    const now = new Date("2026-11-03T00:00:00.000Z");
    const store: WithdrawalStore = {
      withdrawIfNoBlockingContracts: jest.fn(async () => "BLOCKED" as const),
    };

    await expect(withdrawAccount(store, "user-1", now))
      .rejects.toMatchObject({ code: "ACTIVE_CONTRACTS_EXIST" });
    expect(store.withdrawIfNoBlockingContracts).toHaveBeenCalledWith("user-1", now);
  });
});
