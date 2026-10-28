import { createApp } from "./app.ts";
import { createContractStorage } from "./contracts/contract-storage.ts";
import { createContractApiRouter } from "./contracts/contracts.router.ts";
import { createTradeApiRouter } from "./contracts/trade.router.ts";
import { prisma } from "./db.ts";
import { processProjectSchedules } from "./projects/projects.service.ts";
import { holdOverdueDeposits } from "./shared/payment-workflow-adapter.ts";

export * from "./db.ts";
export * from "./app.ts";
export * from "./shared/errors.ts";
export * from "./shared/auth.ts";
export * from "./shared/events.ts";
export * from "./shared/contract-bridge.ts";
export * from "./shared/contract-workflow-adapter.ts";
export * from "./shared/review-workflow-adapter.ts";
export * from "./shared/settlement-workflow-adapter.ts";
export * from "./shared/payment-workflow-adapter.ts";
export * from "./rates/rates.service.ts";
export * from "./projects/projects.service.ts";
export * from "./applications/applications.service.ts";
export * from "./contracts/contract-storage.ts";
export * from "./contracts/contract-pdf-renderer.ts";
export * from "./contracts/contracts.router.ts";
export * from "./contracts/trade.router.ts";

const isMainModule =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isMainModule) {
  const port = Number(process.env.PORT ?? 3000);
  const contractRouter = createContractApiRouter({
    prismaClient: prisma,
    storage: createContractStorage(),
    bucket: process.env.SUPABASE_CONTRACT_BUCKET ?? "contracts",
  });
  const tradeRouter = createTradeApiRouter({ prismaClient: prisma });
  const app = createApp({ extraRouters: [contractRouter, tradeRouter] });
  app.listen(port, () => {
    console.log(`majayong server listening on http://localhost:${port}`);
  });
  const scheduleTimer = setInterval(() => {
    void processProjectSchedules(prisma).catch(() => {
      console.error("프로젝트 모집 일정 처리에 실패했습니다.");
    });
    void holdOverdueDeposits(prisma).catch(() => {
      console.error("7일 경과 입금 보류 처리에 실패했습니다.");
    });
  }, 60_000);
  scheduleTimer.unref();
  void processProjectSchedules(prisma).catch(() => {
    console.error("프로젝트 모집 일정 처리에 실패했습니다.");
  });
  void holdOverdueDeposits(prisma).catch(() => {
    console.error("7일 경과 입금 보류 처리에 실패했습니다.");
  });
}
