import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createPrismaPorts } from '../../src/integration/prisma-wiring.ts';
import { createContractTx } from '../../src/modules/contract/prisma-adapter.ts';
import { createPrismaApplicationUnitOfWork } from '../../src/modules/application/prisma-adapter.ts';
import type { PrismaClient } from '@prisma/client';

describe('Prisma runtime wiring', () => {
  it('application profile reads use the Prisma supplierProfile delegate', async () => {
    const calls: unknown[] = [];
    const supplierProfile = {
      findMany: async (input: unknown) => {
        calls.push(input);
        return [{ userId: 'supplier-1' }];
      },
    };
    const delegate = new Proxy({}, {
      get(_target, property) {
        if (property === 'supplierProfile') return supplierProfile;
        return new Proxy({}, { get: () => async () => undefined });
      },
    });
    const ports = createPrismaPorts(delegate as PrismaClient);
    const input = {
      where: { userId: { in: ['supplier-1'] } },
      select: {
        userId: true,
        careerYears: true,
        ratingAvg: true,
        reviewCount: true,
        portfolioSummary: true,
        portfolioSummaryStatus: true,
        portfolioConsentAt: true,
        user: { select: { withdrawnAt: true } },
        applications: {
          where: { contract: { is: { status: 'COMPLETED' as const } } },
          select: { id: true },
        },
      },
    } as const;

    assert.deepEqual(await ports.applicationRead.supplierProfile?.findMany(input), [{ userId: 'supplier-1' }]);
    assert.deepEqual(calls, [input]);
  });

  it('contract unit of work uses transaction-scoped $queryRaw for row locks', async () => {
    const queries: string[] = [];
    const txRaw = async (strings: TemplateStringsArray) => {
      queries.push(strings.join('?'));
      return [];
    };
    const delegate = new Proxy({}, {
      get(_target, property) {
        if (property === '$transaction') {
          return async (work: (tx: object) => Promise<unknown>) => work(new Proxy({}, {
            get(_tx, txProperty) {
              if (txProperty === '$queryRaw') return txRaw;
              return new Proxy({}, { get: () => async () => null });
            },
          }));
        }
        return new Proxy({}, { get: () => async () => null });
      },
    });
    const ports = createPrismaPorts(delegate as PrismaClient);
    await ports.contract.$transaction(async (tx) => {
      await createContractTx(tx, { hasDepositAttempt: async () => false }).findContract('contract-1');
    });

    assert.deepEqual(queries, ['SELECT id FROM contracts WHERE id = ? FOR UPDATE']);
  });

  it('application unit of work maps project lock and current spec reads from its transaction client', async () => {
    const seenQueries: string[] = [];
    let projectFinds = 0;
    const tx = new Proxy({}, {
      get(_target, property) {
        if (property === '$queryRaw') return async (strings: TemplateStringsArray) => {
          seenQueries.push(strings.join('?'));
          return [];
        };
        if (property === 'project') return {
          findUnique: async () => {
            projectFinds += 1;
            return { currentVersion: 2, status: 'RECRUITING' };
          },
        };
        if (property === 'specItem') return {
          findMany: async () => [{ id: 'current-spec' }],
        };
        if (property === 'notification') return new Proxy({}, { get: () => async () => null });
        return new Proxy({}, { get: () => async () => null });
      },
    });
    const client = new Proxy({}, {
      get(_target, property) {
        if (property === '$transaction') {
          return async (work: (tx: object) => Promise<unknown>) => work(tx);
        }
        return new Proxy({}, { get: () => async () => null });
      },
    });
    const ports = createPrismaPorts(client as PrismaClient);
    const uow = createPrismaApplicationUnitOfWork(ports.application);

    const state = await uow.run((applicationTx) => applicationTx.findProjectSpec('prj-1'));

    assert.deepEqual(state, { currentVersion: 2, status: 'RECRUITING', specItemIds: ['current-spec'] });
    assert.deepEqual(seenQueries, ['SELECT id FROM projects WHERE id = ? FOR UPDATE']);
    assert.equal(projectFinds, 1);
  });
});
