import { describe, expect, it } from "vitest";
import {
  applyKnowledgePatch,
  canTransitionKnowledge,
  nextKnowledgeVersion,
  type KnowledgeContent
} from "./state";

const current: KnowledgeContent = {
  title: "Stable evidence",
  l0Summary: "Keep citations stable.",
  l1Content: "Use locator keys.",
  l2Content: "",
  conditions: ["ChatGPT text"],
  limitations: []
};

describe("knowledge lifecycle", () => {
  it("lets AI create and update drafts, but only propose review", () => {
    expect(canTransitionKnowledge("ai_draft", "ai_draft", "ai")).toBe(true);
    expect(canTransitionKnowledge("ai_draft", "pending_review", "ai")).toBe(
      true
    );
    expect(canTransitionKnowledge("ai_draft", "confirmed", "ai")).toBe(false);
    expect(canTransitionKnowledge("pending_review", "rejected", "ai")).toBe(
      false
    );
    expect(canTransitionKnowledge("needs_review", "pending_review", "ai")).toBe(
      true
    );
  });

  it("lets only a user confirm or reject knowledge", () => {
    expect(
      canTransitionKnowledge("pending_review", "confirmed", "user")
    ).toBe(true);
    expect(canTransitionKnowledge("pending_review", "rejected", "user")).toBe(
      true
    );
    expect(canTransitionKnowledge("pending_review", "confirmed", "ai")).toBe(
      false
    );
    expect(canTransitionKnowledge("pending_review", "rejected", "system")).toBe(
      false
    );
  });

  it("restores archived knowledge only to needs_review", () => {
    expect(canTransitionKnowledge("archived", "needs_review", "user")).toBe(
      true
    );
    expect(canTransitionKnowledge("archived", "confirmed", "user")).toBe(false);
    expect(canTransitionKnowledge("archived", "ai_draft", "ai")).toBe(false);
  });

  it("returns a typed conflict when AI tries to change a locked field", () => {
    const result = applyKnowledgePatch(
      current,
      { title: "AI rewrite", l0Summary: "Keep citations stable." },
      ["title"],
      "ai"
    );

    expect(result).toEqual({
      ok: false,
      code: "locked_field",
      field: "title"
    });
  });

  it("applies unlocked AI fields and lets users edit locked fields", () => {
    expect(
      applyKnowledgePatch(
        current,
        { l1Content: "Updated explanation" },
        ["title"],
        "ai"
      )
    ).toEqual({
      ok: true,
      next: {
        ...current,
        l1Content: "Updated explanation"
      }
    });

    expect(
      applyKnowledgePatch(current, { title: "Human title" }, ["title"], "user")
    ).toEqual({
      ok: true,
      next: {
        ...current,
        title: "Human title"
      }
    });
  });

  it("increments versions from a positive integer", () => {
    expect(nextKnowledgeVersion(1)).toBe(2);
    expect(nextKnowledgeVersion(4)).toBe(5);
    expect(() => nextKnowledgeVersion(0)).toThrow("start at 1");
  });
});
