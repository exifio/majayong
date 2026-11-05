/**
 * 로컬/장기 실행 서버 진입점.
 *
 * Vercel Functions는 `api/v1/[...path].js`에서 `createServerApp()`을 직접 사용한다.
 * 이 파일은 listen·스케줄러·graceful shutdown만 담당한다.
 */
import { createServerApp } from "./server-app.js";
import { startDueJobScheduler } from "./jobs/index.js";

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be a valid TCP port");
}

const { app, db, jobRunner } = createServerApp();
const server = app.listen(port);

const stopScheduler =
  process.env.JOB_SCHEDULER_ENABLED === "true"
    ? startDueJobScheduler(jobRunner, {
        intervalMs: 60_000,
        onError: (err) => console.error("due job scheduler error", err),
      })
    : undefined;

async function shutdown(): Promise<void> {
  stopScheduler?.();
  server.close(async () => {
    await db.$disconnect();
    process.exitCode = 0;
  });
}

process.once("SIGINT", () => { void shutdown(); });
process.once("SIGTERM", () => { void shutdown(); });
