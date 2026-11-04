/**
 * B-02-U04: C 예치 완료 서비스가 호출하는 자동 거절 Port.
 *
 * C의 `MarketplacePorts`와 같은 모양이다. C가 넘기는 `ApplicationUnitOfWork`는
 * 예치 트랜잭션과 같은 DB 트랜잭션에 묶여 있어야 한다.
 */
import {
  autoRejectCompetingApplications,
  type ApplicationUnitOfWork,
} from './submission.js';

export interface MarketplaceAutoRejectPort {
  autoRejectCompetingApplications(input: {
    readonly projectId: string;
    readonly acceptedApplicationId: string;
  }): Promise<{ readonly rejectedCount: number }>;
}

export function createMarketplaceAutoRejectPort(
  uow: ApplicationUnitOfWork,
): MarketplaceAutoRejectPort {
  return {
    async autoRejectCompetingApplications(input) {
      const rejectedCount = await autoRejectCompetingApplications(uow, input);
      return { rejectedCount };
    },
  };
}
