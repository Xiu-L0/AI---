import { z } from "zod";

const MIB = 1024 * 1024;

export const KnowledgeTypeSchema = z.enum([
  "concept",
  "principle",
  "method",
  "scenario",
  "case",
  "fact",
  "opinion",
  "question",
  "conclusion"
]);

export const KnowledgeStatusSchema = z.enum([
  "ai_draft",
  "pending_review",
  "confirmed",
  "rejected",
  "archived",
  "needs_review"
]);

export const KnowledgeEvidenceModeSchema = z.enum([
  "cited",
  "personal_inference"
]);

export const KnowledgeChangeOriginSchema = z.enum(["ai", "user", "system"]);

export const KnowledgeClaimPathSchema = z.enum([
  "l0Summary",
  "l1Content",
  "l2Content",
  "conditions",
  "limitations"
]);

export const EditableKnowledgeFieldSchema = z.enum([
  "title",
  "l0Summary",
  "l1Content",
  "l2Content",
  "conditions",
  "limitations"
]);

export const KnowledgeClaimPathToDb = {
  l0Summary: "l0_summary",
  l1Content: "l1_content",
  l2Content: "l2_content",
  conditions: "conditions",
  limitations: "limitations"
} as const;

export const KnowledgeDraftSchema = z
  .object({
    clientKey: z.string().min(1).max(100),
    knowledgeType: KnowledgeTypeSchema,
    title: z.string().trim().min(1).max(500),
    l0Summary: z.string().trim().min(1).max(1000),
    l1Content: z.string().max(MIB),
    l2Content: z.string().max(MIB),
    conditions: z.array(z.string().min(1).max(1000)).max(50),
    limitations: z.array(z.string().min(1).max(1000)).max(50),
    confidence: z.number().min(0).max(1),
    evidenceMode: KnowledgeEvidenceModeSchema
  })
  .strict();

export const KnowledgeCitationDraftSchema = z
  .object({
    knowledgeClientKey: z.string().min(1).max(100),
    locatorKey: z.string().min(1).max(500),
    claimPath: KnowledgeClaimPathSchema,
    quoteExcerpt: z.string().trim().min(1).max(2000)
  })
  .strict();

export const KnowledgeExtractionResultSchema = z
  .object({
    schemaVersion: z.literal("knowledge-extraction.v1"),
    promptVersion: z.string().min(1).max(100),
    sourceVersionId: z.uuid(),
    knowledgeDrafts: z.array(KnowledgeDraftSchema).max(100),
    citations: z.array(KnowledgeCitationDraftSchema).max(500)
  })
  .strict();

export const KnowledgeReviewDecisionSchema = z
  .object({
    knowledgeItemId: z.uuid(),
    decision: z.enum(["confirm", "reject", "request_changes"]),
    expectedVersion: z.number().int().positive(),
    comment: z.string().trim().min(1).max(2000).optional()
  })
  .strict();

export type KnowledgeType = z.infer<typeof KnowledgeTypeSchema>;
export type KnowledgeStatus = z.infer<typeof KnowledgeStatusSchema>;
export type KnowledgeEvidenceMode = z.infer<typeof KnowledgeEvidenceModeSchema>;
export type KnowledgeChangeOrigin = z.infer<typeof KnowledgeChangeOriginSchema>;
export type KnowledgeClaimPath = z.infer<typeof KnowledgeClaimPathSchema>;
export type EditableKnowledgeField = z.infer<typeof EditableKnowledgeFieldSchema>;
export type KnowledgeDraft = z.infer<typeof KnowledgeDraftSchema>;
export type KnowledgeCitationDraft = z.infer<typeof KnowledgeCitationDraftSchema>;
export type KnowledgeExtractionResult = z.infer<
  typeof KnowledgeExtractionResultSchema
>;
export type KnowledgeReviewDecision = z.infer<
  typeof KnowledgeReviewDecisionSchema
>;
