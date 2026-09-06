"use client";

import { type EditableKnowledgeField } from "@recall/contracts";
import { useMemo, useState } from "react";

import type { ReviewKnowledgeInput } from "../server/review-knowledge";
import type { KnowledgeReview } from "../server/get-knowledge-review";

export type ReviewSubmitResult =
  | { ok: true }
  | { ok: false; conflict: true; message: string };

export type SubmitKnowledgeReview = (
  input: ReviewKnowledgeInput,
) => Promise<ReviewSubmitResult>;

const LOCK_OPTIONS: Array<{ field: EditableKnowledgeField; label: string }> = [
  { field: "title", label: "锁定标题" },
  { field: "l0Summary", label: "锁定 L0" },
  { field: "l1Content", label: "锁定 L1" },
  { field: "l2Content", label: "锁定 L2" },
  { field: "conditions", label: "锁定条件" },
  { field: "limitations", label: "锁定限制" },
];

const typeLabels: Record<string, string> = {
  case: "案例",
  concept: "概念",
  conclusion: "结论",
  fact: "事实",
  method: "方法",
  opinion: "观点",
  principle: "原则",
  question: "问题",
  scenario: "情景",
};

function splitLines(value: string) {
  return value
    .split("\n")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function ReviewForm({
  review,
  submitReview,
}: {
  review: KnowledgeReview;
  submitReview: SubmitKnowledgeReview;
}) {
  const [title, setTitle] = useState(review.title);
  const [l0Summary, setL0Summary] = useState(review.l0Summary);
  const [l1Content, setL1Content] = useState(review.l1Content);
  const [l2Content, setL2Content] = useState(review.l2Content);
  const [conditions, setConditions] = useState(review.conditions.join("\n"));
  const [limitations, setLimitations] = useState(review.limitations.join("\n"));
  const [citationStatus, setCitationStatus] = useState(
    () =>
      Object.fromEntries(
        review.citations.map((citation) => [citation.id, citation.reviewStatus]),
      ) as Record<string, "pending" | "approved" | "rejected">,
  );
  const [lockedFields, setLockedFields] = useState<EditableKnowledgeField[]>(
    review.humanLockedFields,
  );
  const [rejectionReason, setRejectionReason] = useState("");
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const approvedCitationIds = useMemo(
    () =>
      Object.entries(citationStatus)
        .filter(([, status]) => status === "approved")
        .map(([id]) => id),
    [citationStatus],
  );

  const evidenceReady =
    (review.knowledgeType === "opinion" && review.evidenceMode === "personal_inference") ||
    approvedCitationIds.length > 0;

  async function submit(decision: "confirm" | "reject") {
    setFormError(null);
    if (decision === "reject" && rejectionReason.trim() === "") {
      setFormError("拒绝时需要填写原因");
      return;
    }

    setPending(true);
    try {
      const result = await submitReview({
        knowledgeItemId: review.knowledgeItemId,
        decision,
        expectedVersion: review.currentVersion,
        patch: {
          title,
          l0Summary,
          l1Content,
          l2Content,
          conditions: splitLines(conditions),
          limitations: splitLines(limitations),
        },
        approvedCitationIds,
        lockedFields,
        rejectionReason: decision === "reject" ? rejectionReason.trim() : undefined,
      });
      if (!result.ok && result.conflict) {
        setConflictMessage(result.message);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="space-y-8" onSubmit={(event) => event.preventDefault()}>
      <section className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">可编辑知识</h2>
        <p className="mt-2 text-sm text-slate-500">
          {typeLabels[review.knowledgeType] ?? review.knowledgeType} · 置信度{" "}
          {review.confidence.toFixed(2)} · 版本 {review.currentVersion}
        </p>
        <label className="mt-5 block text-sm font-medium text-slate-800">
          标题
          <input
            className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="mt-4 block text-sm font-medium text-slate-800">
          L0
          <textarea
            className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            rows={2}
            value={l0Summary}
            onChange={(event) => setL0Summary(event.target.value)}
          />
        </label>
        <label className="mt-4 block text-sm font-medium text-slate-800">
          L1
          <textarea
            className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            rows={4}
            value={l1Content}
            onChange={(event) => setL1Content(event.target.value)}
          />
        </label>
        <label className="mt-4 block text-sm font-medium text-slate-800">
          L2
          <textarea
            className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            rows={4}
            value={l2Content}
            onChange={(event) => setL2Content(event.target.value)}
          />
        </label>
        <label className="mt-4 block text-sm font-medium text-slate-800">
          条件
          <textarea
            className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            rows={3}
            value={conditions}
            onChange={(event) => setConditions(event.target.value)}
          />
        </label>
        <label className="mt-4 block text-sm font-medium text-slate-800">
          限制
          <textarea
            className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            rows={3}
            value={limitations}
            onChange={(event) => setLimitations(event.target.value)}
          />
        </label>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">来源证据</h2>
        {review.citations.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">这条知识目前没有引用。</p>
        ) : (
          <ul className="mt-4 space-y-4">
            {review.citations.map((citation) => (
              <li className="rounded-xl border border-slate-200 p-4" key={citation.id}>
                <p className="text-xs font-medium text-slate-500">
                  {citation.role} · 第 {citation.ordinal + 1} 条 · {citation.locatorKey}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">
                  {citation.quoteExcerpt}
                </p>
                <a
                  className="mt-3 inline-block text-sm font-medium text-emerald-700"
                  href={citation.evidenceHref}
                >
                  查看原文
                </a>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className="rounded-lg border border-slate-300 px-3 py-1 text-xs"
                    type="button"
                    onClick={() =>
                      setCitationStatus((current) => ({
                        ...current,
                        [citation.id]: "approved",
                      }))
                    }
                  >
                    通过引用
                  </button>
                  <button
                    className="rounded-lg border border-slate-300 px-3 py-1 text-xs"
                    type="button"
                    onClick={() =>
                      setCitationStatus((current) => ({
                        ...current,
                        [citation.id]: "rejected",
                      }))
                    }
                  >
                    拒绝引用
                  </button>
                  <span className="text-xs text-slate-500">
                    当前：
                    {citationStatus[citation.id] === "approved"
                      ? "已通过"
                      : citationStatus[citation.id] === "rejected"
                        ? "已拒绝"
                        : "待审核"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">决策</h2>
        <fieldset className="mt-4">
          <legend className="text-sm font-medium text-slate-800">确认并锁定</legend>
          <div className="mt-3 flex flex-wrap gap-3">
            {LOCK_OPTIONS.map((option) => (
              <label className="text-sm text-slate-700" key={option.field}>
                <input
                  checked={lockedFields.includes(option.field)}
                  className="mr-2"
                  type="checkbox"
                  onChange={(event) => {
                    setLockedFields((current) =>
                      event.target.checked
                        ? [...current, option.field]
                        : current.filter((field) => field !== option.field),
                    );
                  }}
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="mt-5 block text-sm font-medium text-slate-800">
          拒绝原因
          <textarea
            className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            rows={3}
            value={rejectionReason}
            onChange={(event) => setRejectionReason(event.target.value)}
          />
        </label>
        {formError ? (
          <p className="mt-4 text-sm text-red-700">{formError}</p>
        ) : null}
        {conflictMessage ? (
          <p className="mt-4 text-sm text-amber-800">{conflictMessage}</p>
        ) : null}
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-400"
            disabled={!evidenceReady || pending}
            type="button"
            onClick={() => void submit("confirm")}
          >
            确认并锁定
          </button>
          <button
            className="rounded-xl border border-red-200 px-4 py-2 text-sm font-medium text-red-700 disabled:cursor-not-allowed"
            disabled={pending}
            type="button"
            onClick={() => void submit("reject")}
          >
            拒绝
          </button>
        </div>
      </section>
    </form>
  );
}
