"use client";

import {
  uploadCapture,
  type BrowserCaptureDraft as UploadCaptureDraft,
  type UploadCaptureProgress,
} from "@/features/capture/client/upload-capture";
import {
  ManualCaptureForm,
  type BrowserCaptureDraft as ManualCaptureDraft,
  type CaptureSubmissionProgress,
} from "@/features/capture/components/manual-capture-form";

function toFormProgress(
  progress: UploadCaptureProgress,
  totalFiles: number,
): CaptureSubmissionProgress {
  if (progress.stage === "preparing") {
    return { phase: "preparing", completedFiles: 0, totalFiles };
  }
  if (progress.stage === "finalizing") {
    return { phase: "finalizing", completedFiles: totalFiles, totalFiles };
  }
  return {
    phase: "uploading",
    completedFiles: progress.completedFiles,
    currentFileName: progress.currentFileName,
    totalFiles: progress.totalFiles,
  };
}

function toUploadDraft(draft: ManualCaptureDraft): UploadCaptureDraft {
  const onlyImages =
    draft.files.length > 0 &&
    draft.files.every((file) => file.type.startsWith("image/"));

  return {
    attachments: draft.files.map((file, index) => ({
      clientId: `file-${index + 1}`,
      file,
    })),
    completeness: "complete",
    externalRef: null,
    idempotencyKey: draft.idempotencyKey,
    ...(draft.recoveryCaptureId === undefined
      ? {}
      : { recoveryCaptureId: draft.recoveryCaptureId }),
    messages: [],
    missingElements: [],
    rawText: draft.rawText,
    scope: "upload",
    sensitivity: draft.sensitivity,
    source:
      draft.files.length === 0
        ? "manual_text"
        : onlyImages
          ? "manual_screenshot"
          : "manual_file",
    title: draft.title,
  };
}

async function submitManualCapture(
  draft: ManualCaptureDraft,
  onProgress?: (progress: CaptureSubmissionProgress) => void,
) {
  return uploadCapture(toUploadDraft(draft), {
    onProgress(progress) {
      onProgress?.(toFormProgress(progress, draft.files.length));
    },
  });
}

export function ManualCapturePage({
  recoveryCaptureId,
}: {
  recoveryCaptureId?: string;
}) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-10 lg:px-10">
      <p className="text-sm font-medium text-emerald-700">快速添加</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
        保存原始资料
      </h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        可以粘贴文字，或添加文件和多张截图。只有服务器确认原文与附件已经持久保存后，页面才会显示采集成功。
      </p>

      {recoveryCaptureId ? (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
          这是一次明确的失败恢复。请重新填写原资料并选择相同类型的附件；只有新采集获得服务器回执后，旧失败记录才会标记为已解决。
        </p>
      ) : null}

      <div className="mt-8">
        <ManualCaptureForm
          {...(recoveryCaptureId === undefined ? {} : { recoveryCaptureId })}
          submitCapture={submitManualCapture}
        />
      </div>
    </div>
  );
}
