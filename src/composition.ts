import type { PrismaClient } from "@prisma/client";
import { createHttpHandler, type AppServices, type HttpActor } from "./c-app.ts";
import { createDueJobRunner } from "./jobs/index.ts";
import { createPrismaDueJobTargets } from "./infrastructure/prisma-due-targets.ts";
import { createPrismaRepositories } from "./infrastructure/prisma-store.ts";
import { AdminOpsService, type CatalogAdminPort } from "./modules/admin-ops/index.ts";
import { CancellationService, type CancellationMessagePort } from "./modules/cancellation/index.ts";
import {
  DeliveryService,
  InspectionBatchService,
  type InspectionOpsPorts,
  type NotificationPorts,
} from "./modules/delivery/index.ts";
import { DepositCompletionService, DepositService, type MarketplacePorts, type TossVerifyAdapter } from "./modules/deposit/index.ts";
import { FileService, type FileStorageAdapter } from "./modules/files/index.ts";
import { ReviewService, type ProfileReviewPorts } from "./modules/review/index.ts";
import { SettlementService } from "./modules/settlement/policy.ts";

export interface IntegrationPorts {
  marketplace: MarketplacePorts;
  notifications: NotificationPorts;
  inspectionOps?: InspectionOpsPorts;
  cancellationMessages?: CancellationMessagePort;
  profileReview: ProfileReviewPorts;
  storage: FileStorageAdapter;
  catalogAdmin: CatalogAdminPort;
  /** D-08: 검증된 Toss sandbox 계약이 확인되기 전에는 주입하지 않는다(웹훅은 HELD로 격리). */
  tossVerifier?: TossVerifyAdapter;
  projectClientId?(projectId: string): Promise<string | null>;
}

export interface IntegrationConfig {
  prisma: PrismaClient;
  webhookSecret: string;
  bucket?: string;
  clock?: { now(): Date };
  ports: IntegrationPorts;
}

export function createIntegrationServices(config: IntegrationConfig) {
  const repos = createPrismaRepositories(config.prisma);
  const clock = config.clock ?? { now: () => new Date() };

  const settlement = new SettlementService({ repo: repos.settlementRepository, clock });
  const completion = new DepositCompletionService({
    repo: repos.depositRepository,
    contractsPort: repos.contractsPort,
    marketplacePort: config.ports.marketplace,
    transactionRunner: {
      run: (work) => config.prisma.$transaction((tx) => work(tx as never)),
    },
    clock,
  });
  const deposits = new DepositService({
    repo: repos.depositRepository,
    contractsPort: repos.contractsPort,
    webhookSecret: config.webhookSecret,
    ...(config.ports.tossVerifier === undefined ? {} : { tossAdapter: config.ports.tossVerifier }),
    completionPort: completion,
    clock,
  });
  const deliveries = new DeliveryService({
    repo: repos.deliveryRepository,
    settlementPort: settlement,
    opsPorts: config.ports.inspectionOps,
    clock,
  });
  const inspections = new InspectionBatchService({
    repo: repos.deliveryRepository,
    notificationPorts: config.ports.notifications,
    settlementPort: settlement,
    opsPorts: config.ports.inspectionOps,
    clock,
    transactionRunner: {
      run: (work) => config.prisma.$transaction((tx) => work(tx)),
    },
  });
  const cancellations = new CancellationService({
    repo: repos.cancellationRepository,
    messagePort: config.ports.cancellationMessages,
    clock,
  });
  const reviews = new ReviewService({
    repo: repos.reviewRepository,
    profilePorts: config.ports.profileReview,
    clock,
  });
  const files = new FileService({
    repo: repos.fileRepository,
    storageAdapter: config.ports.storage,
    bucket: config.bucket,
    clock,
  });
  const admin = new AdminOpsService({
    repo: repos.adminRepository,
    catalogPort: config.ports.catalogAdmin,
    depositPort: completion,
    inspectionPort: inspections,
    cancellationPort: cancellations,
    clock,
  });

  const services: AppServices = {
    deposits,
    deliveries,
    settlement,
    cancellations,
    reviews,
    files,
    admin,
    projectClientId:
      config.ports.projectClientId ??
      (async (projectId: string) => {
        const row = await config.prisma.project.findUnique({
          where: { id: projectId },
          include: { draft: { select: { clientId: true } } },
        });
        return row?.draft.clientId ?? null;
      }),
  };

  const runner = createDueJobRunner({
    services: {
      completionService: completion,
      cancellationService: cancellations,
      batchService: inspections,
    },
    targets: createPrismaDueJobTargets(config.prisma),
    clock,
  });

  return { services, runner, inspections };
}

export function createAppHandler(
  config: IntegrationConfig,
  authenticate: (req: import("node:http").IncomingMessage) => Promise<HttpActor | null> | HttpActor | null,
  options: { readonly deferUnmatched?: boolean } = {},
) {
  const { services } = createIntegrationServices(config);
  return createHttpHandler({ services, authenticate, deferUnmatched: options.deferUnmatched });
}
