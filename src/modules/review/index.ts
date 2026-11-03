export class ReviewHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ReviewHttpError";
    this.status = status;
  }
}

export type ReviewerRole = "CLIENT" | "SUPPLIER";

export interface ReviewEntity {
  id: string;
  contractId: string;
  reviewerId: string;
  revieweeId: string;
  reviewerRole: ReviewerRole;
  rating: number;
  comment: string | null;
  tags: string[];
  createdAt: Date;
}

export interface ReviewContractEntity {
  id: string;
  clientUserId: string;
  supplierUserId: string;
  status: string;
}

export interface ProfileReviewPorts {
  updateProfileReviewStats(input: { targetUserId: string; rating: number }): Promise<{ success: boolean }>;
}

export interface ReviewRepository {
  seedContract(contract: ReviewContractEntity): void;
  getContract(id: string): Promise<ReviewContractEntity | null>;
  createReview(data: Omit<ReviewEntity, "id">): Promise<ReviewEntity>;
  findReviewByContractAndReviewer(contractId: string, reviewerId: string): Promise<ReviewEntity | null>;
  listReviewsByContract(contractId: string): Promise<ReviewEntity[]>;
  listReviewsByReviewee(revieweeId: string): Promise<ReviewEntity[]>;
}

export function createInMemoryReviewRepository(): ReviewRepository {
  const contracts = new Map<string, ReviewContractEntity>();
  const reviews = new Map<string, ReviewEntity>();
  let idCounter = 1;

  return {
    seedContract(contract) {
      contracts.set(contract.id, { ...contract });
    },
    async getContract(id) {
      return contracts.get(id) ?? null;
    },
    async createReview(data) {
      const id = `rev-${idCounter++}`;
      const rec: ReviewEntity = { ...data, id };
      reviews.set(id, rec);
      return rec;
    },
    async findReviewByContractAndReviewer(contractId, reviewerId) {
      for (const r of reviews.values()) {
        if (r.contractId === contractId && r.reviewerId === reviewerId) return r;
      }
      return null;
    },
    async listReviewsByContract(contractId) {
      return Array.from(reviews.values()).filter((r) => r.contractId === contractId);
    },
    async listReviewsByReviewee(revieweeId) {
      return Array.from(reviews.values()).filter((r) => r.revieweeId === revieweeId);
    },
  };
}

// 연락처/이메일/메신저 아이디 마스킹 규칙
export function maskContactInfo(text: string): string {
  const phoneRegex = /\b01[0-9]-?[0-9]{3,4}-?[0-9]{4}\b/g;
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  return text.replace(phoneRegex, "[연락처]").replace(emailRegex, "[연락처]");
}

export interface ReviewServiceOptions {
  repo: ReviewRepository;
  profilePorts: ProfileReviewPorts;
  clock?: { now(): Date };
}

export class ReviewService {
  private readonly repo: ReviewRepository;
  private readonly profilePorts: ProfileReviewPorts;
  private readonly clock: { now(): Date };

  constructor(options: ReviewServiceOptions) {
    this.repo = options.repo;
    this.profilePorts = options.profilePorts;
    this.clock = options.clock ?? { now: () => new Date() };
  }

  async createReview(
    actor: { userId: string; role: string },
    input: {
      contractId: string;
      rating: number;
      comment?: string;
      tags?: string[];
    },
  ): Promise<ReviewEntity> {
    const contract = await this.repo.getContract(input.contractId);
    if (!contract) throw new ReviewHttpError(404, "계약을 찾을 수 없습니다.");

    // C-07-T01: 계약 완료(COMPLETED) 상태에서만 리뷰 작성 가능
    if (contract.status !== "COMPLETED") {
      throw new ReviewHttpError(409, "완료된 계약만 리뷰를 작성할 수 있습니다.");
    }

    const isClient = actor.role === "CLIENT" && actor.userId === contract.clientUserId;
    const isSupplier = actor.role === "SUPPLIER" && actor.userId === contract.supplierUserId;

    if (!isClient && !isSupplier) {
      throw new ReviewHttpError(403, "계약 당사자만 리뷰를 작성할 수 있습니다.");
    }

    // C-07-T03: 별점은 정수 1~5만 허용
    if (
      typeof input.rating !== "number" ||
      !Number.isInteger(input.rating)
    ) {
      throw new ReviewHttpError(400, "별점은 정수여야 합니다.");
    }
    if (input.rating < 1 || input.rating > 5) {
      throw new ReviewHttpError(400, "별점은 1~5 사이의 정수여야 합니다.");
    }

    // C-07-T02: 계약당 1회 유니크
    const existing = await this.repo.findReviewByContractAndReviewer(contract.id, actor.userId);
    if (existing) {
      throw new ReviewHttpError(409, "이미 리뷰를 작성하셨습니다. 리뷰는 계약당 1회만 작성할 수 있습니다.");
    }

    const reviewerRole: ReviewerRole = isClient ? "CLIENT" : "SUPPLIER";
    const revieweeId = isClient ? contract.supplierUserId : contract.clientUserId;

    let cleanComment: string | null = null;
    if (input.comment) {
      if (input.comment.length > 500) {
        throw new ReviewHttpError(400, "리뷰 본문은 최대 500자까지 작성할 수 있습니다.");
      }
      // C-07-T06: 연락처 마스킹
      cleanComment = maskContactInfo(input.comment);
    }

    const review = await this.repo.createReview({
      contractId: contract.id,
      reviewerId: actor.userId,
      revieweeId,
      reviewerRole,
      rating: input.rating,
      comment: cleanComment,
      tags: input.tags ?? [],
      createdAt: this.clock.now(),
    });

    // A 포트를 통한 프로필 평점 통계 갱신
    await this.profilePorts.updateProfileReviewStats({
      targetUserId: revieweeId,
      rating: input.rating,
    });

    return review;
  }

  async listContractReviews(contractId: string): Promise<ReviewEntity[]> {
    return this.repo.listReviewsByContract(contractId);
  }

  async listSupplierReviews(supplierUserId: string): Promise<ReviewEntity[]> {
    return this.repo.listReviewsByReviewee(supplierUserId);
  }

  async listClientReviews(clientUserId: string): Promise<ReviewEntity[]> {
    return this.repo.listReviewsByReviewee(clientUserId);
  }
}
