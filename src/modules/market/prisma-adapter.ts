/** B-01: 북마크 Repository의 Prisma 어댑터. */
import type { BookmarkRecord, BookmarkRepository } from './bookmarks.js';

export interface BookmarkDbClient {
  readonly bookmark: {
    findUnique(input: {
      readonly where: {
        readonly supplierId_projectId: {
          readonly supplierId: string;
          readonly projectId: string;
        };
      };
    }): Promise<BookmarkRecord | null>;
    create(input: { readonly data: BookmarkRecord }): Promise<BookmarkRecord>;
    delete(input: {
      readonly where: {
        readonly supplierId_projectId: {
          readonly supplierId: string;
          readonly projectId: string;
        };
      };
    }): Promise<BookmarkRecord>;
    findMany(input: {
      readonly where: { readonly supplierId: string };
      readonly orderBy: readonly Readonly<Record<string, 'asc' | 'desc'>>[];
    }): Promise<readonly BookmarkRecord[]>;
  };
}

export function createPrismaBookmarkRepository(db: BookmarkDbClient): BookmarkRepository {
  return {
    findByKey(input) {
      return db.bookmark.findUnique({
        where: {
          supplierId_projectId: {
            supplierId: input.supplierId,
            projectId: input.projectId,
          },
        },
      });
    },

    create(input) {
      return db.bookmark.create({ data: input });
    },

    async delete(input) {
      try {
        await db.bookmark.delete({
          where: {
            supplierId_projectId: {
              supplierId: input.supplierId,
              projectId: input.projectId,
            },
          },
        });
        return true;
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          (error as { readonly code?: unknown }).code === 'P2025'
        ) {
          return false;
        }
        throw error;
      }
    },

    listBySupplier(supplierId) {
      return db.bookmark.findMany({
        where: { supplierId },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      });
    },
  };
}
