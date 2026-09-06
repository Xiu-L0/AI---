export const promptVersion = "knowledge-extraction.2026-08-11.v1";

export const knowledgeExtractionExample = {
  schemaVersion: "knowledge-extraction.v1",
  promptVersion,
  sourceVersionId: "30000000-0000-4000-8000-000000000001",
  knowledgeDrafts: [
    {
      clientKey: "draft-1",
      knowledgeType: "concept",
      title: "Example claim",
      l0Summary: "A short supported claim.",
      l1Content: "A fuller explanation grounded in the supplied blocks.",
      l2Content: "",
      conditions: ["ChatGPT text only"],
      limitations: ["No invented locators"],
      confidence: 0.7,
      evidenceMode: "cited",
    },
  ],
  citations: [
    {
      knowledgeClientKey: "draft-1",
      locatorKey: "message:msg-user/body",
      claimPath: "l0Summary",
      quoteExcerpt: "A short supported claim.",
    },
  ],
} as const;

export type KnowledgeExtractionPromptInput = {
  title: string;
  sourceVersionId: string;
  blocks: Array<{
    locatorKey: string;
    role: string;
    ordinal: number;
    text: string;
  }>;
};

export function buildKnowledgeExtractionPrompt(input: KnowledgeExtractionPromptInput) {
  const systemPrompt = [
    "Return only valid JSON. Do not include Markdown or code fences.",
    "Use this JSON shape:",
    JSON.stringify(knowledgeExtractionExample),
    "Extract only claims supported by the supplied source blocks.",
    "Use exactly one of these knowledge types: concept, principle, method, scenario, case, fact, opinion, question, conclusion.",
    "For each draft produce title, L0, L1, L2, conditions, limitations and confidence between 0 and 1.",
    "Cite one or more exact locatorKey values from the supplied blocks for every draft.",
    "Preserve disagreements as separate drafts.",
    "Never invent source locators and never mark anything confirmed.",
    "Return 1 to 12 drafts.",
  ].join(" ");

  return {
    promptVersion,
    systemPrompt,
    userPayload: {
      schemaVersion: "knowledge-extraction.v1",
      promptVersion,
      title: input.title,
      sourceVersionId: input.sourceVersionId,
      blocks: input.blocks,
    },
  };
}
