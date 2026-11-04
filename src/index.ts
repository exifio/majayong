/**
 * 서버 엔트리포인트.
 *
 * - DATABASE_URL이 없으면 즉시 실패한다.
 * - 인증 검증기는 A가 제공하기 전까지 로컬 토큰(`local:<userId>:<ROLE>`)만 허용한다.
 *   `ALLOW_LOCAL_AUTH=true`이고 NODE_ENV가 production이 아닐 때만 켜진다.
 * - A/C 계약이 없는 Port는 503으로 응답하고, 시작 로그에 목록을 남긴다.
 */
import { PrismaClient } from '@prisma/client';

import { createDevAuthVerifier, type AuthVerifier } from './http/auth.js';
import { createIntegrationPorts } from './integration/external-ports.js';
import { createPrismaIntegrationDb, createPrismaPorts } from './integration/prisma-wiring.js';
import { buildBApp } from './server.js';
import type { Actor } from './modules/application/dto.js';

const PENDING_PORTS = ['projects', 'recommendations', 'reportAccounts', 'agreementPreview'];

function localAuthVerifier(): AuthVerifier {
  if (process.env.NODE_ENV === 'production' || process.env.ALLOW_LOCAL_AUTH !== 'true') {
    throw new Error(
      'AUTH_VERIFIER_PENDING: A의 인증 검증기가 연결되지 않았습니다. 로컬에서는 ALLOW_LOCAL_AUTH=true를 사용하세요.',
    );
  }
  return {
    async verify(token) {
      const [prefix, userId, role] = token.split(':');
      if (prefix !== 'local' || userId === undefined || role === undefined) return null;
      if (role !== 'CLIENT' && role !== 'SUPPLIER' && role !== 'ADMIN') return null;
      const actor: Actor = { userId, role };
      return createDevAuthVerifier([{ token, actor }]).verify(token);
    },
  };
}

function main(): void {
  if (process.env.DATABASE_URL === undefined) {
    throw new Error('DATABASE_URL이 필요합니다.');
  }
  const port = Number(process.env.PORT ?? 3000);
  const prisma = new PrismaClient();
  const app = buildBApp(
    createPrismaPorts(prisma),
    createIntegrationPorts(createPrismaIntegrationDb(prisma), { now: () => new Date() }),
    localAuthVerifier(),
  );

  const server = app.listen(port, () => {
    console.log(`majayong B API listening on :${port}`);
    if (PENDING_PORTS.length > 0) {
      console.log(`INTEGRATION_PENDING ports: ${PENDING_PORTS.join(', ')}`);
    }
  });

  const shutdown = (signal: string): void => {
    console.log(`${signal} received, shutting down`);
    server.close(() => {
      void prisma.$disconnect().finally(() => process.exit(0));
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
