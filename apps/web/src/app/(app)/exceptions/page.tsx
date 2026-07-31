import Link from "next/link";

import {
  listExceptions,
  type CaptureException,
} from "@/features/capture/server/list-exceptions";
import { requireUser } from "@/lib/supabase/server";

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function exceptionHeading(exception: CaptureException) {
  if (exception.kind === "partial_capture") return "部分内容未采集";
  if (exception.kind === "failed_capture") return "服务器尚未确认保存";
  return "原文已保存，后台处理失败";
}

export default async function ExceptionsPage() {
  const user = await requireUser();
  const exceptions = await listExceptions(user.id);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 lg:px-10">
      <p className="text-sm font-medium text-amber-700">异常</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
        仍需处理的采集与后台异常
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
        此处只展示服务器中真实存在的采集会话、原始版本或处理任务；仅保存在扩展本地的离线草稿不会被伪造成服务器异常。
      </p>

      {exceptions.length === 0 ? (
        <section className="mt-10 rounded-2xl border border-dashed border-slate-300 bg-white p-8">
          <h2 className="text-lg font-semibold text-slate-900">目前没有未恢复异常</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            如果扩展仍显示待重试，请以扩展本地 Outbox 状态为准。
          </p>
        </section>
      ) : (
        <div className="mt-10 space-y-5">
          {exceptions.map((exception) => (
            <article
              className={
                exception.kind === "failed_capture"
                  ? "rounded-2xl border border-red-200 bg-red-50 p-6"
                  : exception.kind === "partial_capture"
                    ? "rounded-2xl border border-amber-200 bg-amber-50 p-6"
                    : "rounded-2xl border border-blue-200 bg-blue-50 p-6"
              }
              key={exception.id}
            >
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {formatTime(exception.createdAt)}
                  </p>
                  <h2 className="mt-2 text-xl font-semibold text-slate-950">
                    {exceptionHeading(exception)}
                  </h2>
                  <p className="mt-2 text-sm font-medium text-slate-800">
                    {exception.title}
                  </p>

                  {exception.kind === "partial_capture" ? (
                    <>
                      <p className="mt-4 text-sm text-emerald-800">
                        已采集到的原文安全保存在服务器中。
                      </p>
                      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-amber-950">
                        {exception.missingElements.map((missing) => (
                          <li key={missing}>{missing}</li>
                        ))}
                      </ul>
                      {exception.recovery === "extension_screenshot" ? (
                        <p className="mt-3 text-sm text-amber-950">
                          请回到原 ChatGPT 会话，在扩展中选择补充截图。扩展会把恢复结果保存为同一来源的新版本。
                        </p>
                      ) : (
                        <p className="mt-3 text-sm text-amber-950">
                          你可以手动上传新截图，但它会保存为独立资料，不会自动解决当前异常。
                        </p>
                      )}
                    </>
                  ) : null}

                  {exception.kind === "failed_capture" ? (
                    <>
                      <p className="mt-4 text-sm text-red-950">
                        原始资料尚未获得持久化回执：{exception.failureReason}
                      </p>
                      {exception.source === "chatgpt_web" ? (
                        <p className="mt-2 text-sm text-red-900">
                          请在扩展中打开对应待处理项目：可重试错误会沿用原会话，终止错误会创建显式关联的恢复会话。只有服务器返回持久化回执后，这条异常才会消失。
                        </p>
                      ) : (
                        <p className="mt-2 text-sm text-red-900">
                          如果原提交页面仍打开，可在原页面重试同一次提交；否则请使用右侧恢复入口重新填写。只有新采集取得服务器回执后，旧失败才会关闭。
                        </p>
                      )}
                    </>
                  ) : null}

                  {exception.kind === "processing_failed" ? (
                    <p className="mt-4 text-sm text-blue-950">
                      原文没有丢失。后台处理失败原因：{exception.failureReason}
                    </p>
                  ) : null}
                </div>

                <div className="flex shrink-0 flex-wrap gap-3">
                  {exception.kind === "partial_capture" &&
                  exception.recovery === "independent_manual_screenshot" ? (
                    <Link
                      className="rounded-xl bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800"
                      href="/captures/new"
                    >
                      手动上传新截图
                    </Link>
                  ) : null}
                  {exception.kind === "failed_capture" &&
                  exception.source !== "chatgpt_web" ? (
                    <Link
                      className="rounded-xl bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800"
                      href={`/captures/new?recoveryCaptureId=${exception.captureId}`}
                    >
                      重新填写并恢复
                    </Link>
                  ) : null}
                  {exception.sourceItemId ? (
                    <Link
                      className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
                      href={`/captures/${exception.sourceItemId}`}
                    >
                      查看已保存内容
                    </Link>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
