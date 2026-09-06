import Link from "next/link";

import { listReviewTasks } from "@/features/knowledge/server/list-review-tasks";
import { requireUser } from "@/lib/supabase/server";

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

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function KnowledgeInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const user = await requireUser();
  const { cursor } = await searchParams;
  const page = await listReviewTasks(user.id, cursor ?? null, 20);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 lg:px-10">
      <p className="text-sm font-medium text-emerald-700">知识收件箱</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
        待审核的知识草稿
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
        这里只列出仍待人工确认的知识。确认后的条目会离开收件箱，但不会从知识记录中消失。
      </p>

      {page.items.length === 0 ? (
        <section className="mt-10 rounded-2xl border border-dashed border-slate-300 bg-white p-8">
          <h2 className="text-lg font-semibold text-slate-900">目前没有待审核知识</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            完成一次 ChatGPT 采集并提取后，带引用的草稿会出现在这里。
          </p>
        </section>
      ) : (
        <div className="mt-10 space-y-4">
          {page.items.map((item) => (
            <article
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
              key={item.taskId}
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap gap-2 text-xs font-medium">
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
                      {typeLabels[item.knowledgeType] ?? item.knowledgeType}
                    </span>
                    <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-700">
                      置信度 {item.confidence.toFixed(2)}
                    </span>
                  </div>
                  <h2 className="mt-3 text-lg font-semibold text-slate-950">
                    {item.l0Summary}
                  </h2>
                  <p className="mt-2 text-sm text-slate-500">
                    {item.sourceTitle} · {formatTime(item.createdAt)}
                  </p>
                </div>
                <Link
                  className="inline-flex shrink-0 items-center justify-center rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
                  href={`/knowledge/review/${item.knowledgeItemId}`}
                >
                  开始审核
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}

      {page.nextCursor ? (
        <div className="mt-8 flex justify-center">
          <Link
            className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-medium text-slate-800 hover:bg-slate-50"
            href={`/knowledge?cursor=${encodeURIComponent(page.nextCursor)}`}
          >
            查看更多
          </Link>
        </div>
      ) : null}
    </div>
  );
}
