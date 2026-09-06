import "server-only";

import {
  EditableKnowledgeFieldSchema,
  KnowledgeReviewDecisionSchema,
  type EditableKnowledgeField,
  type KnowledgeReviewDecision,
} from "@recall/contracts";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createServerClient, requireUser } from "@/lib/supabase/server";

const UuidSchema = z.uuid();

const ReviewPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    l0Summary: z.string().trim().min(1).max(1000).optional(),
    l1Content: z.string().max(1024 * 1024).optional(),
    l2Content: z.string().max(1024 * 1024).optional(),
    conditions: z.array(z.string().min(1).max(1000)).max(50).optional(),
    limitations: z.array(z.string().min(1).max(1000)).max(50).optional(),
  })
  .strict();

export const ReviewKnowledgeInputSchema = z
  .object({
    knowledgeItemId: UuidSchema,
    decision: z.enum(["confirm", "reject", "request_changes"]),
    expectedVersion: z.number().int().positive(),
    comment: z.string().trim().min(1).max(2000).optional(),
    patch: ReviewPatchSchema.optional(),
    approvedCitationIds: z.array(UuidSchema).max(500).optional(),
    lockedFields: z.array(EditableKnowledgeFieldSchema).max(6).optional(),
    rejectionReason: z.string().trim().min(1).max(2000).optional(),
  })
  .strict();

export type ReviewKnowledgeInput = z.infer<typeof ReviewKnowledgeInputSchema>;

export class KnowledgeReviewConflict extends Error {
  readonly code = "knowledge_review_conflict";

  constructor() {
    super("这条知识已被更新，请刷新后再审核");
    this.name = "KnowledgeReviewConflict";
  }
}

const FieldToDb: Record<EditableKnowledgeField, string> = {
  title: "title",
  l0Summary: "l0_summary",
  l1Content: "l1_content",
  l2Content: "l2_content",
  conditions: "conditions",
  limitations: "limitations",
};

export type ReviewKnowledgeRpcResult = {
  knowledge_item_id: string;
  version: number;
  status: string;
  source_item_id: string | null;
  source_version_id: string | null;
};

export interface ReviewKnowledgeClient {
  rpc(
    fn: "review_knowledge_item",
    args: {
      p_knowledge_item_id: string;
      p_expected_version: number;
      p_decision: string;
      p_patch: Record<string, unknown>;
      p_approved_citation_ids: string[];
      p_locked_fields: string[];
      p_rejection_reason: string | null;
    },
  ): PromiseLike<{
    data: ReviewKnowledgeRpcResult | null;
    error: { code?: string; message?: string } | null;
  }>;
}

export type ReviewKnowledgeResult = {
  knowledgeItemId: string;
  version: number;
  status: string;
  sourceItemId: string | null;
};

function toPatchJson(patch: ReviewKnowledgeInput["patch"]) {
  if (!patch) {
    return {};
  }

  return {
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.l0Summary !== undefined ? { l0_summary: patch.l0Summary } : {}),
    ...(patch.l1Content !== undefined ? { l1_content: patch.l1Content } : {}),
    ...(patch.l2Content !== undefined ? { l2_content: patch.l2Content } : {}),
    ...(patch.conditions !== undefined ? { conditions: patch.conditions } : {}),
    ...(patch.limitations !== undefined ? { limitations: patch.limitations } : {}),
  };
}

function isVersionConflict(error: { code?: string; message?: string }) {
  return (
    error.code === "40001" ||
    /version conflict|stale|expected version/i.test(error.message ?? "")
  );
}

export async function reviewKnowledgeWithClient(
  client: ReviewKnowledgeClient,
  input: ReviewKnowledgeInput,
  revalidate: (path: string) => void = revalidatePath,
): Promise<ReviewKnowledgeResult> {
  const parsed = ReviewKnowledgeInputSchema.parse(input);
  const decision: KnowledgeReviewDecision = KnowledgeReviewDecisionSchema.parse({
    knowledgeItemId: parsed.knowledgeItemId,
    decision: parsed.decision,
    expectedVersion: parsed.expectedVersion,
    comment: parsed.comment,
  });

  const rejectionReason =
    parsed.decision === "reject"
      ? parsed.rejectionReason ?? parsed.comment
      : parsed.rejectionReason ?? null;

  const result = await client.rpc("review_knowledge_item", {
    p_knowledge_item_id: decision.knowledgeItemId,
    p_expected_version: decision.expectedVersion,
    p_decision: decision.decision,
    p_patch: toPatchJson(parsed.patch),
    p_approved_citation_ids: parsed.approvedCitationIds ?? [],
    p_locked_fields: (parsed.lockedFields ?? []).map((field) => FieldToDb[field]),
    p_rejection_reason: rejectionReason ?? null,
  });

  if (result.error) {
    if (isVersionConflict(result.error)) {
      throw new KnowledgeReviewConflict();
    }
    throw new Error("Knowledge review failed");
  }

  if (result.data == null) {
    throw new Error("Knowledge review failed");
  }

  revalidate("/knowledge");
  revalidate(`/knowledge/review/${decision.knowledgeItemId}`);
  if (result.data.source_item_id) {
    revalidate(`/captures/${result.data.source_item_id}`);
  }

  return {
    knowledgeItemId: result.data.knowledge_item_id,
    version: result.data.version,
    status: result.data.status,
    sourceItemId: result.data.source_item_id,
  };
}

export async function reviewKnowledge(input: ReviewKnowledgeInput) {
  await requireUser();
  const supabase = await createServerClient();
  return reviewKnowledgeWithClient(
    supabase as unknown as ReviewKnowledgeClient,
    input,
  );
}
