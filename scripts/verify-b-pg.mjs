#!/usr/bin/env node
/**
 * B 소유 PostgreSQL 제약 검증 (재실행 가능).
 *
 * 전제: DATABASE_URL이 비어 있는 테스트 DB를 가리키고 `npm run db:migrate`가 끝난 상태.
 * 검증용 행은 고정 이메일 접두사로 만들고 끝나면 지운다. 운영 DB에서 실행하지 말 것.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const PREFIX = 'b-verify-';
let pass = 0;
let fail = 0;

function ok(name) {
  pass += 1;
  console.log(`PASS  ${name}`);
}

function no(name, detail) {
  fail += 1;
  console.log(`FAIL  ${name} :: ${detail}`);
}

async function expectUnique(name, work) {
  try {
    await work();
    no(name, '제약 위반이 발생하지 않았다');
  } catch (error) {
    if (error?.code === 'P2002') ok(name);
    else no(name, error?.message ?? String(error));
  }
}

async function cleanup() {
  await prisma.report.deleteMany({ where: { reporterId: { startsWith: PREFIX } } });
  await prisma.notification.deleteMany({ where: { userId: { startsWith: PREFIX } } });
  await prisma.applicationMessage.deleteMany({
    where: { application: { supplierId: { startsWith: PREFIX } } },
  });
  await prisma.application.deleteMany({ where: { supplierId: { startsWith: PREFIX } } });
  await prisma.contract.deleteMany({
    where: { application: { supplierId: { startsWith: PREFIX } } },
  });
  await prisma.project.deleteMany({ where: { title: { startsWith: PREFIX } } });
  await prisma.draft.deleteMany({ where: { clientId: { startsWith: PREFIX } } });
  await prisma.supplierProfile.deleteMany({ where: { userId: { startsWith: PREFIX } } });
  await prisma.clientProfile.deleteMany({ where: { userId: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: PREFIX } } });
}

async function seed() {
  await prisma.user.createMany({
    data: [
      { id: `${PREFIX}client`, email: `${PREFIX}client@example.test`, role: 'CLIENT' },
      { id: `${PREFIX}sup1`, email: `${PREFIX}sup1@example.test`, role: 'SUPPLIER' },
      { id: `${PREFIX}sup2`, email: `${PREFIX}sup2@example.test`, role: 'SUPPLIER' },
    ],
  });
  await prisma.clientProfile.create({ data: { userId: `${PREFIX}client` } });
  await prisma.supplierProfile.createMany({
    data: [
      { userId: `${PREFIX}sup1`, displayName: '공급자1' },
      { userId: `${PREFIX}sup2`, displayName: '공급자2' },
    ],
  });
  const makeProject = async (suffix) => {
    const draft = await prisma.draft.create({
      data: { clientId: `${PREFIX}client`, entryType: 'SENTENCE' },
    });
    return prisma.project.create({
      data: {
        draftId: draft.id,
        confirmedAt: new Date('2026-11-01T00:00:00.000Z'),
        disclosureConsentVersion: 'v1',
        title: `${PREFIX}프로젝트-${suffix}`,
        summary: '검증',
        industryCode: 'FOOD',
        status: 'RECRUITING',
      },
    });
  };
  const project = await makeProject('1');
  const acceptedProject = await makeProject('2');
  return { project, acceptedProject };
}

function application(projectId, supplierId, overrides = {}) {
  return {
    projectId,
    supplierId,
    specVersionNo: 1,
    totalAmount: 1_000_000,
    durationDays: 10,
    firstViewedAt: new Date('2026-11-01T00:00:00.000Z'),
    ...overrides,
  };
}

async function main() {
  await cleanup();
  const { project, acceptedProject } = await seed();

  await prisma.application.create({
    data: application(project.id, `${PREFIX}sup1`, { status: 'SUBMITTED' }),
  });
  await expectUnique('application_one_active: 같은 프로젝트·공급자 SUBMITTED 재삽입', () =>
    prisma.application.create({
      data: application(project.id, `${PREFIX}sup1`, { status: 'STALE', revisionNo: 2 }),
    }),
  );
  await expectUnique('application_one_active: STALE도 active로 취급', () =>
    prisma.application.create({
      data: application(project.id, `${PREFIX}sup1`, { status: 'STALE', revisionNo: 3 }),
    }),
  );

  const first = await prisma.application.findFirst({
    where: { projectId: project.id, supplierId: `${PREFIX}sup1` },
  });
  await prisma.application.update({ where: { id: first.id }, data: { status: 'SUPERSEDED' } });
  try {
    await prisma.application.create({
      data: application(project.id, `${PREFIX}sup1`, { status: 'SUBMITTED', revisionNo: 2 }),
    });
    ok('application_one_active: 종료(SUPERSEDED) 후 새 SUBMITTED 허용');
  } catch (error) {
    no('application_one_active: 종료 후 재지원', error.message);
  }
  try {
    await prisma.application.create({
      data: application(project.id, `${PREFIX}sup2`, { status: 'SUBMITTED' }),
    });
    ok('application_one_active: 다른 공급자는 같은 프로젝트에 지원 가능');
  } catch (error) {
    no('application_one_active: 다른 공급자 허용', error.message);
  }

  await prisma.application.create({
    data: application(acceptedProject.id, `${PREFIX}sup1`, { status: 'ACCEPTED' }),
  });
  await expectUnique('application_one_accepted: 같은 프로젝트 두 번째 ACCEPTED', () =>
    prisma.application.create({
      data: application(acceptedProject.id, `${PREFIX}sup2`, { status: 'ACCEPTED' }),
    }),
  );

  const message = await prisma.applicationMessage.create({
    data: {
      applicationId: first.id,
      senderId: `${PREFIX}client`,
      kind: 'TEXT',
      body: '검증 메시지',
    },
  });
  await prisma.report.create({
    data: {
      messageId: message.id,
      reporterId: `${PREFIX}sup1`,
      targetUserId: `${PREFIX}client`,
      reason: 'ABUSE',
      status: 'OPEN',
    },
  });
  await expectUnique('report_one_open_per_reporter: 같은 신고자 OPEN 중복', () =>
    prisma.report.create({
      data: {
        messageId: message.id,
        reporterId: `${PREFIX}sup1`,
        targetUserId: `${PREFIX}client`,
        reason: 'ABUSE',
        status: 'OPEN',
      },
    }),
  );
  await prisma.report.updateMany({
    where: { messageId: message.id, reporterId: `${PREFIX}sup1` },
    data: { status: 'RESOLVED' },
  });
  try {
    await prisma.report.create({
      data: {
        messageId: message.id,
        reporterId: `${PREFIX}sup1`,
        targetUserId: `${PREFIX}client`,
        reason: 'ABUSE',
        status: 'OPEN',
      },
    });
    ok('report_one_open_per_reporter: 종료 후 재신고 허용');
  } catch (error) {
    no('report_one_open_per_reporter: 재신고 허용', error.message);
  }

  const notification = await prisma.notification.create({
    data: {
      userId: `${PREFIX}client`,
      type: 'NEW_MESSAGE',
      targetUrl: '/chat/p:s',
      targetId: 'room-1',
    },
  });
  await expectUnique('notification unique: 같은 (userId,type,targetId) 중복', () =>
    prisma.notification.create({
      data: {
        userId: `${PREFIX}client`,
        type: 'NEW_MESSAGE',
        targetUrl: '/chat/p:s',
        targetId: 'room-1',
      },
    }),
  );
  await prisma.notification.update({
    where: { id: notification.id },
    data: { createdAt: new Date(), isRead: false },
  });
  ok('notification unique: 경쟁 패자는 기존 행 갱신으로 처리');

  await prisma.notification.create({
    data: {
      userId: `${PREFIX}client`,
      type: 'CONTRACT_BROKEN',
      targetUrl: '/contracts/c1',
      targetId: 'room-1',
      payload: { reason: 'SIGN_REFUSED' },
    },
  });
  ok('notification unique: 같은 targetId라도 타입이 다르면 허용');

  const before = await prisma.application.findUnique({ where: { id: first.id } });
  try {
    await prisma.$transaction(async (tx) => {
      await tx.application.update({ where: { id: first.id }, data: { status: 'REJECTED' } });
      await tx.notification.create({
        data: {
          userId: `${PREFIX}sup1`,
          type: 'APPLICATION_REJECTED',
          targetUrl: `/applications/${first.id}`,
          targetId: first.id,
        },
      });
      await tx.notification.create({
        data: {
          userId: `${PREFIX}sup1`,
          type: 'APPLICATION_REJECTED',
          targetUrl: `/applications/${first.id}`,
          targetId: first.id,
        },
      });
    });
  } catch (error) {
    if (error?.code !== 'P2002') no('알림 실패 트랜잭션', error.message);
  }
  const after = await prisma.application.findUnique({ where: { id: first.id } });
  if (before?.status === after?.status) ok('알림 unique 실패 시 지원 상태 롤백');
  else no('알림 unique 실패 시 지원 상태 롤백', `${before?.status} -> ${after?.status}`);

  await cleanup();
  console.log(`\nPASS=${pass} FAIL=${fail}`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch(async (error) => {
    console.error('FAIL', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
