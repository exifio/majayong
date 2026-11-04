import { describe, expect, it, jest } from "@jest/globals";
import { WithdrawalStore, withdrawAccount } from "./auth.ts";

describe("account withdrawal", () => {
  it("blocks withdrawal while the contract read port reports active work", async () => {
    const now = new Date("2026-11-03T00:00:00.000Z");
    const store: WithdrawalStore = {
      withdrawIfNoBlockingContracts: jest.fn(async () => "BLOCKED" as const),
    };

    await expect(withdrawAccount(store, "user-1", now))
      .rejects.toMatchObject({ code: "ACTIVE_CONTRACTS_EXIST" });
    expect(store.withdrawIfNoBlockingContracts).toHaveBeenCalledWith("user-1", now);
  });
});
