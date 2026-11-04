/**
 * PrismaClient를 B 어댑터의 구조적 delegate로 좁히는 단일 경계.
 *
 * 도메인 어댑터는 테스트 가능하도록 얇은 구조 타입만 받는다. Prisma의 제네릭
 * 시그니처와 정확히 일치하지 않으므로 이 파일에서만 한 번 캐스팅한다.
 * 인자는 모두 내부에서 만든 리터럴이며 외부 JSON은 이 경로로 들어오지 않는다.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { Prisma as PrismaRuntime } from '@prisma/client';

import type { BPrismaPorts } from '../server.js';
import type { IntegrationDb } from './external-ports.js';

type Db = PrismaClient | Prisma.TransactionClient;

function delegates(db: Db) {
  return {
    application: {
      findMany: db.application.findMany.bind(db.application),
      findUnique: db.application.findUnique.bind(db.application),
      findFirst: db.application.findFirst.bind(db.application),
      create: db.application.create.bind(db.application),
      updateMany: db.application.updateMany.bind(db.application),
    },
    applicationRead: {
      application: {
        findMany: db.application.findMany.bind(db.application),
        findUnique: db.application.findUnique.bind(db.application),
      },
      project: { findUnique: db.project.findUnique.bind(db.project) },
    },
    agreement: {
      application: {
        findUnique: db.application.findUnique.bind(db.application),
        update: db.application.update.bind(db.application),
      },
    },
    chat: {
      application: {
        findUnique: db.application.findUnique.bind(db.application),
        findMany: db.application.findMany.bind(db.application),
      },
      applicationMessage: {
        findMany: db.applicationMessage.findMany.bind(db.applicationMessage),
        findFirst: db.applicationMessage.findFirst.bind(db.applicationMessage),
        create: db.applicationMessage.create.bind(db.applicationMessage),
        updateMany: db.applicationMessage.updateMany.bind(db.applicationMessage),
      },
    },
    contract: {
      contract: {
        findUnique: db.contract.findUnique.bind(db.contract),
        findMany: db.contract.findMany.bind(db.contract),
        create: db.contract.create.bind(db.contract),
        update: db.contract.update.bind(db.contract),
        updateMany: db.contract.updateMany.bind(db.contract),
      },
      application: {
        findFirst: db.application.findFirst.bind(db.application),
        findMany: db.application.findMany.bind(db.application),
        updateMany: db.application.updateMany.bind(db.application),
      },
      project: {
        findUnique: db.project.findUnique.bind(db.project),
        updateMany: db.project.updateMany.bind(db.project),
      },
      applicationMessage: { create: db.applicationMessage.create.bind(db.applicationMessage) },
      eventLog: { create: db.eventLog.create.bind(db.eventLog) },
      notification: db.notification,
    },
    report: {
      applicationMessage: { findUnique: db.applicationMessage.findUnique.bind(db.applicationMessage) },
      report: {
        findFirst: db.report.findFirst.bind(db.report),
        findMany: db.report.findMany.bind(db.report),
        findUnique: db.report.findUnique.bind(db.report),
        create: db.report.create.bind(db.report),
        update: db.report.update.bind(db.report),
        count: db.report.count.bind(db.report),
      },
      eventLog: { create: db.eventLog.create.bind(db.eventLog) },
      notification: db.notification,
    },
    support: {
      supportInquiry: {
        findUnique: db.supportInquiry.findUnique.bind(db.supportInquiry),
        findMany: db.supportInquiry.findMany.bind(db.supportInquiry),
        create: db.supportInquiry.create.bind(db.supportInquiry),
        update: db.supportInquiry.update.bind(db.supportInquiry),
      },
      contract: { findFirst: db.contract.findFirst.bind(db.contract) },
      eventLog: { create: db.eventLog.create.bind(db.eventLog) },
      notification: db.notification,
    },
    market: {
      bookmark: {
        findUnique: db.bookmark.findUnique.bind(db.bookmark),
        create: db.bookmark.create.bind(db.bookmark),
        delete: db.bookmark.delete.bind(db.bookmark),
        findMany: db.bookmark.findMany.bind(db.bookmark),
      },
    },
  };
}

export function createPrismaPorts(prisma: PrismaClient): BPrismaPorts {
  const run = <T>(work: (tx: unknown) => Promise<T>): Promise<T> =>
    prisma.$transaction((tx) => work(tx));
  const base = delegates(prisma);
  const withTransaction = <Shape extends object>(shape: Shape) => ({
    ...shape,
    $transaction: (work: (tx: unknown) => Promise<unknown>) => run(work),
  });

  const raw = {
    application: withTransaction(base.application),
    applicationRead: base.applicationRead,
    agreement: base.agreement,
    chat: base.chat,
    contract: withTransaction(base.contract),
    report: withTransaction(base.report),
    support: withTransaction(base.support),
    market: base.market,
    notification: { notification: prisma.notification, $transaction: (work: (tx: unknown) => Promise<unknown>) => run(work) },
    databaseNull: PrismaRuntime.DbNull,
  };
  // 단일 경계 캐스트: 위 delegate는 Prisma가 런타임에 그대로 받는 객체다.
  return raw as unknown as BPrismaPorts;
}

export function createPrismaIntegrationDb(prisma: PrismaClient): IntegrationDb {
  const raw = {
    project: { findUnique: prisma.project.findUnique.bind(prisma.project) },
    specItem: { findMany: prisma.specItem.findMany.bind(prisma.specItem) },
    application: { findUnique: prisma.application.findUnique.bind(prisma.application) },
    user: { findUnique: prisma.user.findUnique.bind(prisma.user) },
    escrowDeposit: { count: prisma.escrowDeposit.count.bind(prisma.escrowDeposit) },
    eventLog: {
      findFirst: prisma.eventLog.findFirst.bind(prisma.eventLog),
      create: prisma.eventLog.create.bind(prisma.eventLog),
    },
  };
  return raw as unknown as IntegrationDb;
}
