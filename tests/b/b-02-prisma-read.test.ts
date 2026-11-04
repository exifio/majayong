import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createPrismaApplicationReadPort,
  type ApplicationReadDelegate,
  type ApplicationRow,
} from '../../src/modules/application/prisma-adapter.ts';
import { FIXED_NOW } from './fixtures.ts';

function row(overrides: Partial<ApplicationRow> = {}): ApplicationRow {
  return {
    id: 'app-1',
    projectId: 'prj-1',
    supplierId: 'supplier-1',
    revisionNo: 1,
    specVersionNo: 1,
    status: 'SUBMITTED',
    totalAmount: 3_100_000,
    durationDays: 42,
    message: '안녕하세요',
    questions: [{ text: '질문 1' }],
    isMessageMasked: false,
    revisionReason: null,
    firstViewedAt: FIXED_NOW,
    submittedAt: FIXED_NOW,
    items: [{ specItemId: 'spec-1', isAvailable: true }],
    project: { clientId: 'client-1' },
    ...overrides,
  };
}

function db(rows: readonly ApplicationRow[]) {
  const calls: unknown[] = [];
  const delegate: ApplicationReadDelegate = {
    async findMany(input) {
      calls.push(input.where);
      return rows.filter((candidate) => {
        const where = input.where as {
          projectId?: string;
          supplierId?: string;
          project?: { clientId?: string };
        };
        if (where.projectId !== undefined && candidate.projectId !== where.projectId) return false;
        if (where.supplierId !== undefined && candidate.supplierId !== where.supplierId) return false;
        if (where.project?.clientId !== undefined && candidate.project.clientId !== where.project.clientId) {
          return false;
        }
        return true;
      });
    },
    async findUnique(input) {
      return rows.find((candidate) => candidate.id === input.where.id) ?? null;
    },
  };
  return {
    calls,
    client: {
      application: delegate,
      project: {
        async findUnique(input: { where: { id: string } }) {
          return input.where.id === 'prj-1' ? { clientId: 'client-1' } : null;
        },
      },
    },
  };
}

describe('B-02 Prisma 읽기 어댑터', () => {
  it('Project.clientId를 Application.clientUserId로 매핑한다', async () => {
    const port = createPrismaApplicationReadPort(db([row()]).client);

    const revision = await port.findRevision('app-1');

    assert.equal(revision?.clientUserId, 'client-1');
    assert.deepEqual(revision?.questions, [{ text: '질문 1' }]);
    assert.deepEqual(revision?.items, [{ specItemId: 'spec-1', isAvailable: true }]);
  });

  it('의뢰인은 project.clientId로, 공급자는 supplierId로 필터한다', async () => {
    const fixture = db([row(), row({ id: 'app-2', supplierId: 'supplier-2' })]);
    const port = createPrismaApplicationReadPort(fixture.client);

    const mine = await port.listForUser({ userId: 'client-1', role: 'CLIENT' });
    const supplier = await port.listForUser({ userId: 'supplier-2', role: 'SUPPLIER' });

    assert.deepEqual(mine.map((item) => item.id), ['app-1', 'app-2']);
    assert.deepEqual(supplier.map((item) => item.id), ['app-2']);
    assert.deepEqual(fixture.calls[0], { project: { clientId: 'client-1' } });
    assert.deepEqual(fixture.calls[1], { supplierId: 'supplier-2' });
  });

  it('프로젝트 의뢰인 ID와 회차 목록을 제공한다', async () => {
    const port = createPrismaApplicationReadPort(
      db([row({ revisionNo: 2 }), row({ id: 'app-0', revisionNo: 1 })]).client,
    );

    assert.equal(await port.findProjectClientId('prj-1'), 'client-1');
    assert.equal(await port.findProjectClientId('prj-2'), null);
    assert.equal((await port.listRevisionsByProject('prj-1')).length, 2);
  });

  it('깨진 questions JSON은 조용히 버리지 않고 거부한다', async () => {
    const port = createPrismaApplicationReadPort(db([row({ questions: 'broken' })]).client);

    await assert.rejects(port.findRevision('app-1'), /INVALID_APPLICATION_QUESTIONS/);
  });
});
