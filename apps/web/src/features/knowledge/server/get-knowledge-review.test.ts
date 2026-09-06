import { describe, expect, it, vi } from "vitest";

import {
  getCaptureKnowledgeProvenanceWithRepository,
  getKnowledgeReviewWithRepository,
  type CaptureProvenanceRepository,
  type KnowledgeReviewRepository,
} from "./get-knowledge-review";

const ownerA = "00000000-0000-4000-8000-0000000000d1";
const ownerB = "00000000-0000-4000-8000-0000000000d2";
const knowledgeItemId = "80000000-0000-4000-8000-0000000000d1";
const sourceItemId = "10000000-0000-4000-8000-0000000000d1";
const sourceVersionId = "30000000-0000-4000-8000-0000000000d1";

function createRepository(
  overrides: Partial<KnowledgeReviewRepository> = {},
): KnowledgeReviewRepository {
  return {
    loadKnowledgeItem: vi.fn(async (ownerUserId, id) =>
      ownerUserId === ownerA && id === knowledgeItemId
        ? {
            conditions: ["ChatGPT text only"],
            confidence: 0.72,
            currentVersion: 1,
            evidenceMode: "cited",
            humanLockedFields: ["title"],
            id,
            knowledgeType: "concept",
            l0Summary: "A cited draft summary",
            l1Content: "A cited draft body",
            l2Content: "A cited draft detail",
            limitations: ["No invented locators"],
            sourceVersionId,
            status: "pending_review",
            title: "Stable cited concept",
          }
        : null,
    ),
    loadCitations: vi.fn(async () => [
      {
        claimPath: "l0_summary",
        id: "70000000-0000-4000-8000-0000000000d1",
        knowledgeItemId,
        locatorKey: "message:msg-user/body",
        ordinal: 0,
        quoteExcerpt: "A cited draft summary",
        reviewStatus: "pending" as const,
        role: "user",
        sourceItemId,
        sourceVersionId,
      },
    ]),
    loadSourceTitle: vi.fn(async () => ({
      sourceItemId,
      sourceVersionId,
      title: "ChatGPT fixture",
    })),
    ...overrides,
  };
}

describe("getKnowledgeReviewWithRepository", () => {
  it("returns editable fields, citations and a capture evidence link", async () => {
    const review = await getKnowledgeReviewWithRepository(
      createRepository(),
      ownerA,
      knowledgeItemId,
    );

    expect(review).toMatchObject({
      title: "Stable cited concept",
      l0Summary: "A cited draft summary",
      l1Content: "A cited draft body",
      l2Content: "A cited draft detail",
      confidence: 0.72,
      status: "pending_review",
      currentVersion: 1,
      humanLockedFields: ["title"],
      sourceTitle: "ChatGPT fixture",
      sourceItemId,
      sourceVersionId,
    });
    expect(review?.citations[0]).toMatchObject({
      locatorKey: "message:msg-user/body",
      role: "user",
      ordinal: 0,
      sourceItemId,
      sourceVersionId,
      evidenceHref: `/captures/${sourceItemId}#message:msg-user/body`,
    });
  });

  it("does not return another owner’s knowledge", async () => {
    await expect(
      getKnowledgeReviewWithRepository(createRepository(), ownerB, knowledgeItemId),
    ).resolves.toBeNull();
  });
});

describe("getCaptureKnowledgeProvenanceWithRepository", () => {
  it("returns block, draft and run counts for a source version", async () => {
    const repository: CaptureProvenanceRepository = {
      countBlocks: vi.fn(async () => new Map([[sourceVersionId, 2]])),
      countDrafts: vi.fn(async () => new Map([[sourceVersionId, 1]])),
      listLatestRunStatus: vi.fn(async () => new Map([[sourceVersionId, "complete"]])),
    };

    await expect(
      getCaptureKnowledgeProvenanceWithRepository(repository, ownerA, [sourceVersionId]),
    ).resolves.toEqual([
      {
        blockCount: 2,
        draftCount: 1,
        runStatus: "complete",
        sourceVersionId,
      },
    ]);
  });
});
