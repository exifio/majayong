/**
 * B-02-U04: C 예치 완료 서비스가 호출하는 자동 거절 Port.
 *
 * C의 `MarketplacePorts`와 같은 모양이다. C가 넘기는 `ApplicationUnitOfWork`는
 * 예치 트랜잭션과 같은 DB 트랜잭션에 묶여 있어야 한다.
 */
import {
  autoRejectCompetingApplications,
  autoRejectCompetingApplicationsInTransaction,
  type ApplicationTx,
  type ApplicationUnitOfWork,
} from './submission.js';

export interface MarketplaceAutoRejectPort {
  autoRejectCompetingApplications(
    input: {
      readonly projectId: string;
      readonly acceptedApplicationId: string;
      readonly now: Date;
    },
    tx?: unknown,
  ): Promise<{ readonly rejectedCount: number }>;
}

/**
 * C가 넘긴 opaque 예치 트랜잭션을 B의 `ApplicationTx`로 옮기는 함수.
 * 통합 계층이 실제 Prisma tx를 주입한다(C는 tx 타입을 모른다).
 */
export type ResolveApplicationTx = (
  tx: unknown,
) => Pick<ApplicationTx, 'listByProject' | 'updateStatus' | 'notifications'>;

export function createMarketplaceAutoRejectPort(
  uow: ApplicationUnitOfWork,
  resolveTx?: ResolveApplicationTx,
): MarketplaceAutoRejectPort {
  return {
    async autoRejectCompetingApplications(input, tx) {
      // C가 예치 완료 트랜잭션을 넘기면 그 tx에 참여한다(예치 확정과 같은 트랜잭션).
      if (tx !== undefined && resolveTx !== undefined) {
        return autoRejectCompetingApplicationsInTransaction(resolveTx(tx), input);
      }
      const rejectedCount = await autoRejectCompetingApplications(uow, input);
      return { rejectedCount };
    },
  };
}
