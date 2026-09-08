import Link from "next/link";

import {
  listCaptures,
  type CaptureHistoryItem,
} from "@/features/capture/server/list-captures";
import { requireUser } from "@/lib/supabase/server";

const sourceLabels: Record<
  NonNullable<CaptureHistoryItem["source"]>,
  string
> = {
  chatgpt_web: "ChatGPT 会话",
  manual_file: "文件",
  manual_screenshot: "截图",
  manual_text: "文本",
};

function formatSource(source: CaptureHistoryItem["source"]) {
  return source == null ? "网页笔记" : sourceLabels[source];
}

const processingLabels: Record<CaptureHistoryItem["processingStatus"], string> = {
  complete: "处理完成",
  failed: "后台处理失败",
  paused: "处理暂停",
  processing: "处理中",
  queued: "等待后台处理",
};

function formatSavedAt(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function CapturesPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const user = await requireUser();
  const { cursor } = await searchParams;
  const history = await listCaptures(user.id, cursor ?? null, 20);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 lg:px-10">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-emerald-700">采集记录</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
            已由服务器确认保存的原始资料
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
            每条记录展示最新版本。完整度和后台处理状态彼此独立，不会把排队中误报为采集失败。
          </p>
        </div>
        <Link
          className="inline-flex items-center justify-center rounded-xl bg-emerald-700 px-5 py-3 text-sm font-medium text-white transition hover:bg-emerald-800"
          href="/captures/new"
        >
          快速添加
        </Link>
      </div>

      {history.items.length === 0 ? (
        <section className="mt-10 rounded-2xl border border-dashed border-slate-300 bg-white p-8">
          <h2 className="text-lg font-semibold text-slate-900">还没有采集记录</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            完成一次手动或扩展采集后，服务器确认的保存结果会出现在这里。
          </p>
        </section>
      ) : (
        <div className="mt-10 space-y-4">
          {history.items.map((capture) => (
            <article
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
              key={capture.sourceItemId}
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
                      {formatSource(capture.source)}
                    </span>
                    <span
                      className={
                        capture.captureStatus === "complete"
                          ? "rounded-full bg-emerald-50 px-3 py-1 text-emerald-700"
                          : "rounded-full bg-amber-50 px-3 py-1 text-amber-800"
                      }
                    >
                      {capture.captureStatus === "complete"
                        ? "完整采集"
                        : "部分采集"}
                    </span>
                    <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-700">
                      {processingLabels[capture.processingStatus]}
                    </span>
                  </div>
                  <h2 className="mt-3 truncate text-lg font-semibold text-slate-950">
                    {capture.title}
                  </h2>
                  <p className="mt-2 text-sm text-slate-500">
                    版本 {capture.version} · {capture.savedMessageCount} 条消息 ·{" "}
                    {capture.savedAttachmentCount} 个附件 · 保存于{" "}
                    {formatSavedAt(capture.updatedAt)}
                  </p>
                </div>
                <Link
                  className="inline-flex shrink-0 items-center justify-center rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
                  href={`/captures/${capture.sourceItemId}`}
                >
                  查看详情
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}

      {history.nextCursor ? (
        <div className="mt-8 flex justify-center">
          <Link
            className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-medium text-slate-800 hover:bg-slate-50"
            href={`/captures?cursor=${encodeURIComponent(history.nextCursor)}`}
          >
            查看更早记录
          </Link>
        </div>
      ) : null}
    </div>
  );
}
