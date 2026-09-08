import Link from "next/link";
import { notFound } from "next/navigation";

import {
  getCaptureDetails,
  isValidCaptureSourceItemId,
} from "@/features/capture/server/list-captures";
import { getCaptureKnowledgeProvenance } from "@/features/knowledge/server/get-knowledge-review";
import { requireUser } from "@/lib/supabase/server";

const sourceLabels = {
  chatgpt_web: "ChatGPT 会话",
  manual_file: "文件",
  manual_screenshot: "截图",
  manual_text: "文本",
} as const;

function formatSource(
  source: keyof typeof sourceLabels | null,
) {
  return source == null ? "网页笔记" : sourceLabels[source];
}

const sensitivityLabels = {
  normal: "普通",
  sensitive: "敏感",
  strictly_sensitive: "严格敏感",
} as const;

const roleLabels: Record<string, string> = {
  assistant: "助手",
  system: "系统",
  tool: "工具",
  user: "用户",
};

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

export default async function CaptureDetailsPage({
  params,
}: {
  params: Promise<{ sourceItemId: string }>;
}) {
  const { sourceItemId } = await params;
  if (!isValidCaptureSourceItemId(sourceItemId)) {
    notFound();
  }
  const user = await requireUser();
  const capture = await getCaptureDetails(user.id, sourceItemId);
  if (!capture) {
    notFound();
  }
  const provenance = await getCaptureKnowledgeProvenance(
    user.id,
    capture.versions.map((version) => version.id),
  );
  const provenanceByVersion = new Map(
    provenance.map((entry) => [entry.sourceVersionId, entry]),
  );

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 lg:px-10">
      <Link className="text-sm font-medium text-emerald-700" href="/captures">
        ← 返回采集记录
      </Link>
      <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <div className="flex flex-wrap gap-2 text-xs font-medium text-slate-700">
          <span className="rounded-full bg-slate-100 px-3 py-1">
            {formatSource(capture.source)}
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1">
            {sensitivityLabels[capture.sensitivity]}
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1">
            共 {capture.versions.length} 个版本
          </span>
        </div>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">
          {capture.title}
        </h1>
        <p className="mt-3 text-sm text-slate-500">
          最近保存于 {formatTime(capture.updatedAt)}
        </p>
      </div>

      <div className="mt-8 space-y-8">
        {capture.versions.map((version) => (
          <article
            className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm"
            key={version.id}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-950">
                  版本 {version.version}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {formatTime(version.createdAt)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs font-medium">
                <span
                  className={
                    version.captureStatus === "complete"
                      ? "rounded-full bg-emerald-50 px-3 py-1 text-emerald-700"
                      : "rounded-full bg-amber-50 px-3 py-1 text-amber-800"
                  }
                >
                  {version.captureStatus === "complete"
                    ? "完整采集"
                    : "部分采集"}
                </span>
                <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-700">
                  后台状态：{version.processingStatus}
                </span>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
                  证据块 {provenanceByVersion.get(version.id)?.blockCount ?? 0}
                </span>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
                  处理运行：{provenanceByVersion.get(version.id)?.runStatus ?? version.processingStatus}
                </span>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
                  已提取草稿 {provenanceByVersion.get(version.id)?.draftCount ?? 0}
                </span>
              </div>
            </div>

            {version.missingElements.length > 0 ? (
              <section className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
                <h3 className="text-sm font-semibold text-amber-950">缺失内容</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
                  {version.missingElements.map((missing) => (
                    <li key={missing}>{missing}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            {version.processingFailureReason ? (
              <p className="mt-5 rounded-xl bg-blue-50 p-4 text-sm text-blue-900">
                原文已保存，后台处理失败：{version.processingFailureReason}
              </p>
            ) : null}

            {version.rawText ? (
              <section className="mt-6">
                <h3 className="text-sm font-semibold text-slate-900">原始文本</h3>
                <pre className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-slate-950 p-5 text-sm leading-6 text-slate-100">
                  {version.rawText}
                </pre>
              </section>
            ) : null}

            {version.messages.length > 0 ? (
              <section className="mt-6">
                <h3 className="text-sm font-semibold text-slate-900">消息顺序</h3>
                <ol className="mt-3 space-y-3">
                  {version.messages.map((message) => (
                    <li
                      className="rounded-xl border border-slate-200 bg-slate-50 p-4"
                      id={`message:${message.externalMessageId}/body`}
                      key={message.id}
                    >
                      <p className="text-xs font-semibold text-slate-500">
                        {message.ordinal + 1}. {roleLabels[message.role] ?? message.role}
                      </p>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">
                        {message.body}
                      </p>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            {version.attachments.length > 0 ? (
              <section className="mt-6">
                <h3 className="text-sm font-semibold text-slate-900">附件</h3>
                <ul className="mt-3 divide-y divide-slate-200 rounded-xl border border-slate-200">
                  {version.attachments.map((attachment) => (
                    <li
                      className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                      key={attachment.id}
                    >
                      <div>
                        <p className="text-sm font-medium text-slate-900">
                          {attachment.fileName}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {attachment.mimeType} · {formatBytes(attachment.byteSize)} · SHA-256{" "}
                          {attachment.sha256.slice(0, 12)}…
                        </p>
                      </div>
                      <a
                        className="text-sm font-medium text-emerald-700 hover:text-emerald-800"
                        href={attachment.downloadUrl}
                      >
                        下载（链接 60 秒有效）
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}
