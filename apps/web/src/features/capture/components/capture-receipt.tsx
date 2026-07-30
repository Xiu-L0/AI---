import type { CaptureReceipt as CaptureReceiptData } from "@recall/contracts";

export interface CaptureReceiptProps {
  receipt?: CaptureReceiptData | null;
  failureReason?: string | null;
}

const processingCopy: Record<
  CaptureReceiptData["processingStatus"],
  string
> = {
  queued: "原文已保存，等待后台处理",
  processing: "原文已保存，正在后台处理",
  complete: "原文已保存，后台处理完成",
  failed: "原文已保存，后台处理失败",
  paused: "原文已保存，后台处理已暂停"
};

export function CaptureReceipt({
  receipt = null,
  failureReason = null
}: CaptureReceiptProps) {
  if (failureReason !== null) {
    return (
      <section
        aria-labelledby="capture-failure-title"
        className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-900"
        role="alert"
      >
        <h2 id="capture-failure-title" className="font-semibold">
          采集尚未完成，服务器未确认保存
        </h2>
        <p className="mt-2 text-sm">{failureReason}</p>
      </section>
    );
  }

  if (receipt === null) {
    return null;
  }

  const isComplete = receipt.captureStatus === "complete";

  return (
    <section
      aria-labelledby="capture-receipt-title"
      className={`rounded-xl border p-4 ${
        isComplete
          ? "border-emerald-200 bg-emerald-50 text-emerald-950"
          : "border-amber-200 bg-amber-50 text-amber-950"
      }`}
    >
      <h2 id="capture-receipt-title" className="font-semibold">
        {isComplete
          ? "完整采集成功，原始资料已保存"
          : "部分内容未采集"}
      </h2>

      {!isComplete && (
        <div className="mt-3">
          <p className="text-sm font-medium">缺失内容：</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
            {receipt.missingElements.map((missingElement) => (
              <li key={missingElement}>{missingElement}</li>
            ))}
          </ul>
        </div>
      )}

      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-current/70">已保存消息</dt>
          <dd className="font-medium">{receipt.savedMessageCount}</dd>
        </div>
        <div>
          <dt className="text-current/70">已保存附件</dt>
          <dd className="font-medium">{receipt.savedAttachmentCount}</dd>
        </div>
      </dl>

      <p
        className="mt-3 border-t border-current/15 pt-3 text-sm"
        data-processing-status={receipt.processingStatus}
      >
        {processingCopy[receipt.processingStatus]}
      </p>
    </section>
  );
}
