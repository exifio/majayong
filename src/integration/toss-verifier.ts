/**
 * D-08: Toss Payments sandbox 결제 재조회 어댑터.
 *
 * 서버에서만 secret key를 쓰고, 웹훅 본문은 신뢰하지 않는다. 조회 결과의
 * orderId/paymentKey/totalAmount/status가 모두 일치할 때만 verified=true를 돌려준다.
 */
import type { TossVerifyAdapter } from "../modules/deposit/index.js";

export interface TossSandboxVerifierOptions {
  readonly secretKey: string;
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

interface TossPayment {
  readonly orderId?: unknown;
  readonly paymentKey?: unknown;
  readonly totalAmount?: unknown;
  readonly status?: unknown;
}

export function createTossSandboxVerifier(
  options: TossSandboxVerifierOptions,
): Required<TossVerifyAdapter> {
  const base = (options.baseUrl ?? "https://api.tosspayments.com").replace(/\/+$/, "");
  const fetcher = options.fetchImpl ?? fetch;
  const authorization = `Basic ${Buffer.from(`${options.secretKey}:`).toString("base64")}`;

  return {
    async verifyPayment(orderId, paymentKey, amount) {
      const response = await fetcher(`${base}/v1/payments/${encodeURIComponent(paymentKey)}`, {
        method: "GET",
        headers: { authorization },
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      });
      if (!response.ok) return { verified: false };
      const body = (await response.json()) as TossPayment;
      const verified =
        body.orderId === orderId &&
        body.paymentKey === paymentKey &&
        body.totalAmount === amount &&
        body.status === "DONE";
      return {
        verified,
        orderId: body.orderId,
        paymentKey: body.paymentKey,
        amount: body.totalAmount,
        status: body.status,
      };
    },
  };
}
