/** Gate 0: 북마크·추천 HTTP 라우터 (API_INDEX #057~#060). */
import { Router, type Request } from 'express';

import { HttpError, sendCreated, sendData } from '../../http/envelope.js';
import { integer } from '../../http/parse.js';
import type { Actor } from '../application/dto.js';
import {
  listBookmarks,
  removeBookmark,
  saveBookmark,
  type BookmarkRepository,
} from './bookmarks.js';
import {
  recommendProjectsForSupplier,
  type SupplierRecommendationProfile,
} from './project-search.js';
import type { PublicProjectSummary } from './public-project.js';

export interface MarketHttpPorts {
  readonly bookmarks: BookmarkRepository;
  readonly projects: {
    listPublicProjectsByIds(ids: readonly string[]): Promise<readonly PublicProjectSummary[]>;
  };
  readonly recommendations: {
    getSupplier(userId: string): Promise<SupplierRecommendationProfile | null>;
    listOpenProjects(): Promise<readonly PublicProjectSummary[]>;
    listAppliedProjectIds(supplierId: string): Promise<readonly string[]>;
  };
  readonly now: () => Date;
}

function actorOf(request: Request): Actor {
  const actor = request.actor;
  if (actor === undefined) throw new HttpError(401, 'UNAUTHENTICATED', '로그인이 필요합니다.');
  return actor;
}

function requireSupplier(request: Request): Actor {
  const actor = actorOf(request);
  if (actor.role !== 'SUPPLIER') {
    throw new HttpError(403, 'FORBIDDEN', '공급자만 사용할 수 있습니다.');
  }
  return actor;
}

export function createMarketRouter(ports: MarketHttpPorts): Router {
  const router = Router();

  router.get('/me/bookmarks', async (request, response) => {
    const actor = requireSupplier(request);
    const records = await ports.bookmarks.listBySupplier(actor.userId);
    const projects = await ports.projects.listPublicProjectsByIds(
      records.map((record) => record.projectId),
    );
    const result = await listBookmarks(ports.bookmarks, {
      supplierId: actor.userId,
      now: ports.now(),
      projectsById: new Map(projects.map((project) => [project.id, project])),
    });
    sendData(response, result.items);
  });

  router.put('/projects/:projectId/bookmark', async (request, response) => {
    const actor = requireSupplier(request);
    const result = await saveBookmark(ports.bookmarks, {
      supplierId: actor.userId,
      projectId: request.params.projectId as string,
      now: ports.now(),
    });
    if (result.created) {
      sendCreated(response, result.bookmark);
      return;
    }
    sendData(response, result.bookmark);
  });

  router.delete('/projects/:projectId/bookmark', async (request, response) => {
    const actor = requireSupplier(request);
    const result = await removeBookmark(ports.bookmarks, {
      supplierId: actor.userId,
      projectId: request.params.projectId as string,
    });
    sendData(response, result);
  });

  router.get('/me/recommended-projects', async (request, response) => {
    const actor = requireSupplier(request);
    const supplier = await ports.recommendations.getSupplier(actor.userId);
    if (supplier === null) {
      throw new HttpError(404, 'PROFILE_NOT_FOUND', '공급자 프로필을 찾을 수 없습니다.');
    }
    const [projects, appliedProjectIds] = await Promise.all([
      ports.recommendations.listOpenProjects(),
      ports.recommendations.listAppliedProjectIds(actor.userId),
    ]);
    const rawLimit = request.query.limit;
    const limit =
      typeof rawLimit === 'string' && rawLimit.length > 0
        ? integer(Number(rawLimit), 'limit', { min: 1, max: 50 })
        : undefined;
    const items = recommendProjectsForSupplier({
      supplier,
      projects,
      appliedProjectIds,
      limit,
    });
    sendData(response, items);
  });

  return router;
}
