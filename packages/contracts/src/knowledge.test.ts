import { describe, expect, it } from "vitest";
import {
  KnowledgeCitationDraftSchema,
  KnowledgeDraftSchema,
  KnowledgeExtractionResultSchema,
  KnowledgeReviewDecisionSchema,
  KnowledgeStatusSchema,
  KnowledgeTypeSchema
} from "./knowledge";

const MIB = 1024 * 1024;

function draft(overrides: Record<string, unknown> = {}) {
  return {
    clientKey: "draft-1",
    knowledgeType: "concept",
    title: "Stable evidence block",
    l0Summary: "Evidence blocks keep citations stable.",
    l1Content: "A block is addressed by locatorKey.",
    l2Content: "",
    conditions: ["ChatGPT text only"],
    limitations: ["No OCR in stage 1B"],
    confidence: 0.72,
    evidenceMode: "cited",
    ...overrides
  };
}

function citation(overrides: Record<string, unknown> = {}) {
  return {
    knowledgeClientKey: "draft-1",
    locatorKey: "message:0/body",
    claimPath: "l0Summary",
    quoteExcerpt: "Evidence blocks keep citations stable.",
    ...overrides
  };
}

function extraction(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "knowledge-extraction.v1",
    promptVersion: "extract-knowledge.v1",
    sourceVersionId: "30000000-0000-4000-8000-000000000001",
    knowledgeDrafts: [draft()],
    citations: [citation()],
    ...overrides
  };
}

describe("knowledge contracts", () => {
  it("accepts the database-aligned knowledge type and status enums", () => {
    expect(KnowledgeTypeSchema.parse("opinion")).toBe("opinion");
    expect(KnowledgeStatusSchema.parse("pending_review")).toBe(
      "pending_review"
    );
    expect(KnowledgeTypeSchema.safeParse("主题").success).toBe(false);
    expect(KnowledgeStatusSchema.safeParse("published").success).toBe(false);
  });

  it("accepts a bounded camelCase knowledge draft", () => {
    expect(KnowledgeDraftSchema.parse(draft())).toMatchObject({
      clientKey: "draft-1",
      knowledgeType: "concept"
    });
    expect(
      KnowledgeDraftSchema.safeParse(draft({ title: "" })).success
    ).toBe(false);
    expect(
      KnowledgeDraftSchema.safeParse(draft({ l1Content: "x".repeat(MIB + 1) }))
        .success
    ).toBe(false);
    expect(
      KnowledgeDraftSchema.safeParse(draft({ confidence: 1.01 })).success
    ).toBe(false);
  });

  it("requires citations to address a deterministic block locator", () => {
    expect(KnowledgeCitationDraftSchema.parse(citation()).locatorKey).toBe(
      "message:0/body"
    );
    expect(
      KnowledgeCitationDraftSchema.safeParse(citation({ locatorKey: "" }))
        .success
    ).toBe(false);
    expect(
      KnowledgeCitationDraftSchema.safeParse(
        citation({ claimPath: "l0_summary" })
      ).success
    ).toBe(false);
  });

  it("requires a versioned extraction payload and rejects unknown keys", () => {
    const result = KnowledgeExtractionResultSchema.parse(extraction());
    expect(result.schemaVersion).toBe("knowledge-extraction.v1");
    expect(result.sourceVersionId).toBe(
      "30000000-0000-4000-8000-000000000001"
    );
    expect(
      KnowledgeExtractionResultSchema.safeParse(
        extraction({ schemaVersion: "knowledge-extraction.v0" })
      ).success
    ).toBe(false);
    expect(
      KnowledgeExtractionResultSchema.safeParse(
        extraction({ ownerUserId: "should-not-leak" })
      ).success
    ).toBe(false);
  });

  it("accepts an explicit human review decision", () => {
    expect(
      KnowledgeReviewDecisionSchema.parse({
        knowledgeItemId: "80000000-0000-4000-8000-000000000001",
        decision: "confirm",
        expectedVersion: 1
      }).decision
    ).toBe("confirm");
    expect(
      KnowledgeReviewDecisionSchema.safeParse({
        knowledgeItemId: "80000000-0000-4000-8000-000000000001",
        decision: "confirm",
        expectedVersion: 1,
        spaceId: "client-must-not-send"
      }).success
    ).toBe(false);
  });
});
