import { describe, expect, it, vi } from "vitest";

import {
  KnowledgeReviewConflict,
  reviewKnowledgeWithClient,
  type ReviewKnowledgeClient,
} from "./review-knowledge";

const knowledgeItemId = "80000000-0000-4000-8000-0000000000d1";
const sourceItemId = "10000000-0000-4000-8000-0000000000d1";
const citationId = "70000000-0000-4000-8000-0000000000d1";

function createClient(
  impl: ReviewKnowledgeClient["rpc"] = async () => ({
    data: {
      knowledge_item_id: knowledgeItemId,
      version: 2,
      status: "confirmed",
      source_item_id: sourceItemId,
      source_version_id: "30000000-0000-4000-8000-0000000000d1",
    },
    error: null,
  }),
): ReviewKnowledgeClient & { rpc: ReturnType<typeof vi.fn> } {
  return { rpc: vi.fn(impl) };
}

describe("reviewKnowledgeWithClient", () => {
  it("parses the review decision and calls the authenticated RPC", async () => {
    const client = createClient();
    const revalidate = vi.fn();

    await expect(
      reviewKnowledgeWithClient(
        client,
        {
          knowledgeItemId,
          decision: "confirm",
          expectedVersion: 1,
          patch: {
            title: "Human title",
            l0Summary: "Edited L0",
            l1Content: "Edited L1",
            l2Content: "Edited L2",
          },
          approvedCitationIds: [citationId],
          lockedFields: ["title", "l0Summary"],
        },
        revalidate,
      ),
    ).resolves.toEqual({
      knowledgeItemId,
      version: 2,
      status: "confirmed",
      sourceItemId,
    });

    expect(client.rpc).toHaveBeenCalledWith("review_knowledge_item", {
      p_knowledge_item_id: knowledgeItemId,
      p_expected_version: 1,
      p_decision: "confirm",
      p_patch: {
        title: "Human title",
        l0_summary: "Edited L0",
        l1_content: "Edited L1",
        l2_content: "Edited L2",
      },
      p_approved_citation_ids: [citationId],
      p_locked_fields: ["title", "l0_summary"],
      p_rejection_reason: null,
    });
    expect(client.rpc.mock.calls[0]?.[1]).not.toHaveProperty("p_owner_user_id");
    expect(revalidate).toHaveBeenCalledWith("/knowledge");
    expect(revalidate).toHaveBeenCalledWith(`/knowledge/review/${knowledgeItemId}`);
    expect(revalidate).toHaveBeenCalledWith(`/captures/${sourceItemId}`);
  });

  it("maps a stale version to KnowledgeReviewConflict", async () => {
    const client = createClient(async () => ({
      data: null,
      error: { code: "40001", message: "knowledge item version conflict" },
    }));

    await expect(
      reviewKnowledgeWithClient(client, {
        knowledgeItemId,
        decision: "confirm",
        expectedVersion: 1,
      }),
    ).rejects.toBeInstanceOf(KnowledgeReviewConflict);
  });

  it("sends a rejection reason and does not accept an owner override", async () => {
    const client = createClient(async () => ({
      data: {
        knowledge_item_id: knowledgeItemId,
        version: 2,
        status: "rejected",
        source_item_id: sourceItemId,
        source_version_id: "30000000-0000-4000-8000-0000000000d1",
      },
      error: null,
    }));

    await reviewKnowledgeWithClient(
      client,
      {
        knowledgeItemId,
        decision: "reject",
        expectedVersion: 1,
        comment: "Not supported by the source",
      },
      vi.fn(),
    );

    expect(client.rpc).toHaveBeenCalledWith(
      "review_knowledge_item",
      expect.objectContaining({
        p_decision: "reject",
        p_rejection_reason: "Not supported by the source",
      }),
    );
    expect(JSON.stringify(client.rpc.mock.calls[0]?.[1])).not.toContain("ownerUserId");
  });
});
