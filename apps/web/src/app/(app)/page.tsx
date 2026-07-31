import Link from "next/link";

import { listCaptures } from "@/features/capture/server/list-captures";
import { listExceptions } from "@/features/capture/server/list-exceptions";
import { requireUser } from "@/lib/supabase/server";

export default async function HomePage() {
  const user = await requireUser();
  const [history, exceptions] = await Promise.all([
    listCaptures(user.id, null, 100),
    listExceptions(user.id),
  ]);
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
  const todayCaptureCount = history.items.filter((capture) => {
    const saved = new Date(capture.updatedAt);
    return `${saved.getFullYear()}-${saved.getMonth()}-${saved.getDate()}` === todayKey;
  }).length;
  const queuedCount = history.items.filter(
    (capture) =>
      capture.processingStatus === "queued" ||
      capture.processingStatus === "processing",
  ).length;
  const overviewCards = [
    {
      description: "今天由服务器确认保存的原始资料。",
      title: "今日采集",
      value: todayCaptureCount,
    },
    {
      description: "原文已安全保存，后台任务可以独立排队。",
      title: "等待后台处理",
      value: queuedCount,
    },
    {
      description: "部分采集、失败会话和处理失败不会静默消失。",
      title: "未恢复异常",
      value: exceptions.length,
    },
  ];

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 lg:px-10">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-emerald-700">今天</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
            先可靠保存，再慢慢整理
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
            Milestone A 只关注原始资料是否完整、持久地保存，以及异常是否诚实可见。
          </p>
        </div>
        <Link
          className="inline-flex items-center justify-center rounded-xl bg-emerald-700 px-5 py-3 text-sm font-medium text-white transition hover:bg-emerald-800"
          href="/captures/new"
        >
          快速添加
        </Link>
      </div>

      <section aria-label="今日概览" className="mt-10 grid gap-5 md:grid-cols-3">
        {overviewCards.map((card) => (
          <article
            className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
            key={card.title}
          >
            <p className="text-sm font-medium text-slate-600">{card.title}</p>
            <p className="mt-4 text-4xl font-semibold text-slate-950">
              {card.value}
            </p>
            <p className="mt-4 text-sm leading-6 text-slate-500">
              {card.description}
            </p>
          </article>
        ))}
      </section>

      {exceptions.length > 0 ? (
        <section className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-8">
          <h2 className="text-lg font-semibold text-amber-950">
            有 {exceptions.length} 项异常需要恢复
          </h2>
          <p className="mt-2 text-sm leading-6 text-amber-900">
            请先确认部分采集的缺失内容，或重试尚未获得服务器保存回执的采集。
          </p>
          <Link
            className="mt-5 inline-flex rounded-xl bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800"
            href="/exceptions"
          >
            查看异常
          </Link>
        </section>
      ) : (
        <section className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-white/70 p-8">
          <h2 className="text-lg font-semibold text-slate-900">暂无待处理异常</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            如果扩展仍有离线待提交项，它会继续保留在本地 Outbox 中，直到服务器确认保存。
          </p>
        </section>
      )}
    </div>
  );
}
