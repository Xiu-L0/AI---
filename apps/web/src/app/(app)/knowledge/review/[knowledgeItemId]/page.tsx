import Link from "next/link";
import { notFound } from "next/navigation";

import { ReviewForm } from "@/features/knowledge/components/review-form";
import { getKnowledgeReview } from "@/features/knowledge/server/get-knowledge-review";
import {
  KnowledgeReviewConflict,
  reviewKnowledge,
  type ReviewKnowledgeInput,
} from "@/features/knowledge/server/review-knowledge";
import { requireUser } from "@/lib/supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function KnowledgeReviewPage({
  params,
}: {
  params: Promise<{ knowledgeItemId: string }>;
}) {
  const { knowledgeItemId } = await params;
  if (!UUID_PATTERN.test(knowledgeItemId)) {
    notFound();
  }

  const user = await requireUser();
  const review = await getKnowledgeReview(user.id, knowledgeItemId);
  if (!review) {
    notFound();
  }

  async function submitReview(input: ReviewKnowledgeInput) {
    "use server";

    try {
      await reviewKnowledge(input);
      return { ok: true as const };
    } catch (error) {
      if (error instanceof KnowledgeReviewConflict) {
        return {
          ok: false as const,
          conflict: true as const,
          message: error.message,
        };
      }
      throw error;
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-10 lg:px-10">
      <Link className="text-sm font-medium text-emerald-700" href="/knowledge">
        ← 返回知识收件箱
      </Link>
      <p className="mt-5 text-sm font-medium text-emerald-700">知识审核</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
        {review.title}
      </h1>
      <p className="mt-3 text-sm text-slate-500">{review.sourceTitle}</p>
      <div className="mt-8">
        <ReviewForm review={review} submitReview={submitReview} />
      </div>
    </div>
  );
}
