import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createApp } from '../../src/app.ts';
import { createDevAuthVerifier } from '../../src/http/auth.ts';
import type { Actor } from '../../src/modules/application/dto.ts';
import { createChatRouter } from '../../src/modules/chat/http.ts';
import { createContractRouter } from '../../src/modules/contract/http.ts';
import { createMarketRouter } from '../../src/modules/market/http.ts';
import { createNotificationRouter } from '../../src/modules/notification/http.ts';
import { createReportRouter } from '../../src/modules/report/http.ts';
import { createSupportRouter } from '../../src/modules/support/http.ts';
import { FIXED_NOW } from './fixtures.ts';
import { withServer } from './http-helpers.ts';

const CLIENT: Actor = { userId: 'client-1', role: 'CLIENT' };
const SUPPLIER: Actor = { userId: 'supplier-1', role: 'SUPPLIER' };

const unused = async (): Promise<never> => {
  throw new Error('unused');
};

function summary(id: string) {
  return {
    id,
    title: '예약 사이트',
    summary: '예약 기능',
    industryCode: 'FOOD',
    requiredSkills: ['React'],
    hopeBudgetRange: null,
    deadline: new Date('2026-12-01T00:00:00.000Z'),
    status: 'RECRUITING' as const,
    publishedAt: FIXED_NOW,
    currentSpecVersion: 1,
    specItemCount: 1,
    specItemTitles: ['예약'],
  };
}

function appWith(router: ReturnType<typeof createMarketRouter>) {
  return createApp({
    auth: createDevAuthVerifier([
      { token: 'client-token', actor: CLIENT },
      { token: 'supplier-token', actor: SUPPLIER },
    ]),
    routers: [{ basePath: '', router }],
  });
}

describe('Gate 0 HTTP: 북마크·추천', () => {
  it('북마크 저장·목록·해제가 봉투와 상태 코드로 동작한다', async () => {
    const rows = new Map<string, { supplierId: string; projectId: string; createdAt: Date }>();
    const router = createMarketRouter({
      bookmarks: {
        async findByKey(input) {
          return rows.get(`${input.supplierId}:${input.projectId}`) ?? null;
        },
        async create(input) {
          rows.set(`${input.supplierId}:${input.projectId}`, input);
          return input;
        },
        async delete(input) {
          return rows.delete(`${input.supplierId}:${input.projectId}`);
        },
        async listBySupplier(supplierId) {
          return [...rows.values()].filter((row) => row.supplierId === supplierId);
        },
      },
      projects: { listPublicProjectsByIds: async () => [summary('prj-1')] },
      recommendations: {
        getSupplier: async () => ({ supplierId: 'supplier-1', industryCodes: ['FOOD'], skills: [] }),
        listOpenProjects: async () => [summary('prj-1')],
        listAppliedProjectIds: async () => [],
      },
      now: () => FIXED_NOW,
    });

    await withServer(appWith(router), async (call) => {
      const created = await call({
        method: 'PUT',
        path: '/api/v1/projects/prj-1/bookmark',
        token: 'supplier-token',
        body: {},
      });
      assert.equal(created.status, 201);

      const list = await call({ method: 'GET', path: '/api/v1/me/bookmarks', token: 'supplier-token' });
      assert.equal(list.status, 200);
      const items = (list.body as { data: { project: { id: string }; applicationOpen: boolean }[] }).data;
      assert.equal(items.length, 1);
      assert.equal(items[0]?.project.id, 'prj-1');
      assert.equal(items[0]?.applicationOpen, true);

      const removed = await call({
        method: 'DELETE',
        path: '/api/v1/projects/prj-1/bookmark',
        token: 'supplier-token',
      });
      assert.equal(removed.status, 200);
      assert.deepEqual(removed.body, { data: { removed: true } });
    });
  });
});

describe('Gate 0 HTTP: 나머지 모듈 라우터 장착', () => {
  it('채팅방 목록·알림 목록·계약 목록이 data 봉투로 응답한다', async () => {
    const chat = createChatRouter({
      repository: {
        findApplication: unused,
        findThreadMessages: unused,
        hasMessageFrom: unused,
        createMessage: unused,
        markRead: unused,
      },
      rooms: { listRoomsForUser: async () => [] },
      accounts: { getAccountState: async () => ({ suspendedAt: null, withdrawnAt: null, chatRestrictedUntil: null }) },
      events: { recordInquiryOpenedOnce: async () => true },
      now: () => FIXED_NOW,
    });
    const notification = createNotificationRouter({
      uow: {
        run: async (work) =>
          work({
            findByKey: unused,
            create: unused,
            refreshBundled: unused,
            listRecent: async () => [],
            countUnread: async () => 0,
            markRead: unused,
            markAllRead: unused,
          }),
      },
      now: () => FIXED_NOW,
    });
    const contract = createContractRouter({
      uow: { run: unused },
      reads: { listForUser: async () => [], findById: unused },
      applications: { findRevision: unused },
      agreements: { get: async () => null, save: unused, invalidate: unused },
      items: { listSources: async () => [] },
      preview: { getSpec: async () => null, getMessages: async () => [] },
      now: () => FIXED_NOW,
    });

    for (const router of [chat, notification, contract]) {
      await withServer(appWith(router), async (call) => {
        const path =
          router === chat ? '/api/v1/me/chats' : router === notification ? '/api/v1/me/notifications' : '/api/v1/me/contracts';
        const response = await call({ method: 'GET', path, token: 'client-token' });
        assert.equal(response.status, 200, path);
        assert.ok((response.body as { data: unknown }).data !== undefined);
      });
    }
  });

  it('운영자 전용 신고·문의 목록은 일반 사용자에게 403이다', async () => {
    const report = createReportRouter({
      uow: {
        run: async (work) =>
          work({
            findReportableMessage: unused,
            findOpenReport: unused,
            createReport: unused,
            listReports: async () => [],
            findReport: unused,
            findWarningCount: async () => 0,
            resolveReport: unused,
            applyAccountAction: unused,
            notifyReporter: unused,
            logEvent: unused,
          }),
      },
      myReports: { listByReporter: async () => [] },
      now: () => FIXED_NOW,
    });
    const support = createSupportRouter({
      uow: {
        run: async (work) =>
          work({
            canAccessContract: async () => true,
            createInquiry: unused,
            findInquiry: unused,
            listInquiries: async () => [],
            answerInquiry: unused,
            notifyAuthor: unused,
            logEvent: unused,
          }),
      },
      now: () => FIXED_NOW,
    });

    await withServer(appWith(report), async (call) => {
      const response = await call({
        method: 'GET',
        path: '/api/v1/admin/reports',
        token: 'supplier-token',
      });
      assert.equal(response.status, 403);
      assert.equal((response.body as { error: { code: string } }).error.code, 'ADMIN_ONLY');
    });

    await withServer(appWith(support), async (call) => {
      const response = await call({
        method: 'GET',
        path: '/api/v1/admin/support/inquiries',
        token: 'client-token',
      });
      assert.equal(response.status, 403);
      assert.equal((response.body as { error: { code: string } }).error.code, 'ADMIN_ONLY');
    });
  });
});
