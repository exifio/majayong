import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createPrismaAgreementDraftStore } from '../../src/modules/agreement/prisma-adapter.ts';
import type { AgreementDraft } from '../../src/modules/agreement/draft.ts';

const NOW = new Date('2026-11-03T12:00:00.000Z');

describe('B-04 agreementDraft adapter', () => {
  it('round-trips JSON dates', async () => {
    const databaseNull = Object.freeze({ dbNull: true });
    let stored: unknown = databaseNull;
    const prisma = {
      application: {
        async findUnique() {
          return { agreementDraft: stored === databaseNull ? null : stored };
        },
        async update(input: { data: { agreementDraft: unknown } }) {
          stored = input.data.agreementDraft;
          return { id: 'app-1' };
        },
      },
    };
    const store = createPrismaAgreementDraftStore(prisma, { databaseNull });
    const draft: AgreementDraft = {
      items: [{
        blockId: 'block-1', specItemId: 'spec-1', title: '예약', stage: 'FINAL',
        conditions: [{ key: 'scope', text: '시간', state: 'PROPOSED', evidenceMessageIds: ['msg-1'] }],
      }],
      interimRatio: 50, ratioState: 'UNDECIDED', cachedAt: NOW, lastMessageAt: NOW,
    };

    await store.save('app-1', draft);
    const loaded = await store.get('app-1');
    assert.deepEqual(loaded, draft);
    assert.ok(loaded?.cachedAt instanceof Date);
    assert.ok(loaded?.lastMessageAt instanceof Date);
  });

  it('invalidates using the database-null sentinel', async () => {
    const databaseNull = Object.freeze({ dbNull: true });
    let stored: unknown = { stale: true };
    const prisma = {
      application: {
        async findUnique() { return { agreementDraft: stored === databaseNull ? null : stored }; },
        async update(input: { data: { agreementDraft: unknown } }) {
          stored = input.data.agreementDraft;
          return { id: 'app-1' };
        },
      },
    };
    const store = createPrismaAgreementDraftStore(prisma, { databaseNull });

    await store.invalidate('app-1');

    assert.equal(stored, databaseNull);
    assert.equal(await store.get('app-1'), null);
  });

  it('round-trips validated agreement state and leaves evidence revalidation to the domain', async () => {
    const databaseNull = Object.freeze({ dbNull: true });
    let stored: unknown = databaseNull;
    const prisma = {
      application: {
        async findUnique() { return { agreementDraft: stored === databaseNull ? null : stored }; },
        async update(input: { data: { agreementDraft: unknown } }) {
          stored = input.data.agreementDraft;
          return { id: 'app-1' };
        },
      },
    };
    const store = createPrismaAgreementDraftStore(prisma, { databaseNull });
    const draft: AgreementDraft = {
      items: [{
        blockId: 'block-1', specItemId: 'spec-1', title: '예약', stage: 'FINAL',
        conditions: [{ key: 'scope', text: '시간', state: 'DECIDED', evidenceMessageIds: ['m-old'] }],
      }],
      interimRatio: 50, ratioState: 'DECIDED', cachedAt: NOW, lastMessageAt: NOW,
    };

    await store.save('app-1', draft);
    const loaded = await store.get('app-1');
    assert.equal(loaded?.items[0]?.conditions[0]?.state, 'DECIDED');
    assert.deepEqual(loaded?.items[0]?.conditions[0]?.evidenceMessageIds, ['m-old']);
    assert.equal(loaded?.ratioState, 'DECIDED');
  });

  it('rejects malformed cached JSON at the database boundary', async () => {
    const prisma = {
      application: {
        async findUnique() { return { agreementDraft: { items: 'not-an-array' } }; },
        async update() { return { id: 'app-1' }; },
      },
    };
    const store = createPrismaAgreementDraftStore(prisma, { databaseNull: Object.freeze({ dbNull: true }) });

    await assert.rejects(store.get('app-1'), /Invalid agreementDraft JSON/);
  });
});
