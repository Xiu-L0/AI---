"use client";

import {
  CaptureReceiptSchema,
  type CaptureReceipt as CaptureReceiptData,
  type Sensitivity
} from "@recall/contracts";
import { type ChangeEvent, type FormEvent, useState } from "react";

import { CaptureReceipt } from "./capture-receipt";

const MIB = 1024 * 1024;
const MAX_PLAIN_TEXT_BYTES = 2 * MIB;
const MAX_ATTACHMENT_BYTES = 10 * MIB;
const MAX_ATTACHMENT_COUNT = 50;
const MAX_ATTACHMENT_TOTAL_BYTES = 100 * MIB;

const supportedMimeTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "text/markdown",
  "application/pdf"
]);

export interface BrowserCaptureDraft {
  idempotencyKey: string;
  title: string;
  rawText: string;
  files: File[];
  sensitivity: Sensitivity;
}

export interface CaptureSubmissionProgress {
  phase: "preparing" | "uploading" | "finalizing";
  completedFiles: number;
  totalFiles: number;
  currentFileName?: string;
}

export type SubmitCapture = (
  draft: BrowserCaptureDraft,
  onProgress?: (progress: CaptureSubmissionProgress) => void
) => Promise<CaptureReceiptData>;

export interface ManualCaptureFormProps {
  submitCapture: SubmitCapture;
}

type SubmissionState = "idle" | "submitting" | "error" | "complete";

type DraftFields = Pick<
  BrowserCaptureDraft,
  "title" | "rawText" | "files" | "sensitivity"
>;

function validateDraft(draft: DraftFields): string | null {
  if (draft.title.trim().length === 0) {
    return "请输入标题";
  }
  if (draft.title.trim().length > 500) {
    return "标题不能超过 500 个字符";
  }
  if (draft.rawText.trim().length === 0 && draft.files.length === 0) {
    return "请填写正文或添加文件";
  }
  if (
    new TextEncoder().encode(draft.rawText).byteLength >
    MAX_PLAIN_TEXT_BYTES
  ) {
    return "正文不能超过 2 MiB";
  }
  if (draft.files.length > MAX_ATTACHMENT_COUNT) {
    return "每次最多添加 50 个文件";
  }

  let totalBytes = 0;
  for (const file of draft.files) {
    if (!supportedMimeTypes.has(file.type)) {
      return `不支持的文件类型：${file.name}`;
    }
    if (file.size === 0) {
      return `文件不能为空：${file.name}`;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return "单个文件不能超过 10 MiB";
    }
    if (file.name.length > 255) {
      return `文件名不能超过 255 个字符：${file.name}`;
    }
    totalBytes += file.size;
  }

  if (totalBytes > MAX_ATTACHMENT_TOTAL_BYTES) {
    return "文件总大小不能超过 100 MiB";
  }

  return null;
}

function overallProgressCopy(progress: CaptureSubmissionProgress | null) {
  if (progress === null || progress.phase === "preparing") {
    return "正在准备采集内容";
  }
  if (progress.phase === "finalizing") {
    return "正在等待服务器确认保存";
  }
  return `正在上传文件 ${progress.completedFiles}/${progress.totalFiles}`;
}

function fileProgressCopy(
  file: File,
  index: number,
  state: SubmissionState,
  progress: CaptureSubmissionProgress | null
) {
  if (state === "error") {
    return "未完成";
  }
  if (state === "complete") {
    return "已保存";
  }
  if (state !== "submitting") {
    return "已选择";
  }
  if (progress === null || progress.phase === "preparing") {
    return "等待上传";
  }
  if (progress.completedFiles > index) {
    return "已上传，等待服务器确认";
  }
  if (
    progress.phase === "uploading" &&
    progress.currentFileName === file.name
  ) {
    return "正在上传";
  }
  if (progress.phase === "finalizing") {
    return "已上传，等待服务器确认";
  }
  return "等待上传";
}

export function ManualCaptureForm({
  submitCapture
}: ManualCaptureFormProps) {
  const [title, setTitle] = useState("");
  const [rawText, setRawText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sensitivity, setSensitivity] = useState<Sensitivity>("normal");
  const [state, setState] = useState<SubmissionState>("idle");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<CaptureReceiptData | null>(null);
  const [progress, setProgress] =
    useState<CaptureSubmissionProgress | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);

  const isSubmitting = state === "submitting";

  function clearResult() {
    setState("idle");
    setValidationError(null);
    setSubmissionError(null);
    setReceipt(null);
    setProgress(null);
    setIdempotencyKey(null);
  }

  function handleFilesChange(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? []);
    clearResult();
    setFiles(selectedFiles);

    const error = validateDraft({
      title: title.length === 0 ? "pending-title" : title,
      rawText,
      files: selectedFiles,
      sensitivity
    });
    if (
      error !== null &&
      error !== "请填写正文或添加文件" &&
      error !== "请输入标题"
    ) {
      setValidationError(error);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const draftFields: DraftFields = {
      title: title.trim(),
      rawText,
      files,
      sensitivity
    };
    const error = validateDraft(draftFields);
    if (error !== null) {
      setState("idle");
      setValidationError(error);
      setSubmissionError(null);
      setReceipt(null);
      return;
    }

    const stableIdempotencyKey =
      idempotencyKey ?? globalThis.crypto.randomUUID();
    const draft: BrowserCaptureDraft = {
      idempotencyKey: stableIdempotencyKey,
      ...draftFields
    };

    setIdempotencyKey(stableIdempotencyKey);
    setState("submitting");
    setValidationError(null);
    setSubmissionError(null);
    setReceipt(null);
    setProgress({
      phase: "preparing",
      completedFiles: 0,
      totalFiles: files.length
    });

    try {
      const serverReceipt = CaptureReceiptSchema.parse(
        await submitCapture(draft, setProgress)
      );
      setReceipt(serverReceipt);
      setState("complete");
      setProgress(null);
    } catch (caughtError) {
      const reason =
        caughtError instanceof Error
          ? caughtError.message
          : "请检查网络后重试";
      setState("error");
      setSubmissionError(reason);
      setReceipt(null);
      setProgress(null);
    }
  }

  return (
    <div className="space-y-6">
      <form
        className="space-y-5 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"
        onSubmit={handleSubmit}
      >
        <div>
          <label className="block text-sm font-medium text-zinc-800" htmlFor="capture-title">
            标题
          </label>
          <input
            className="mt-2 w-full rounded-lg border border-zinc-300 px-3 py-2 disabled:bg-zinc-100"
            disabled={isSubmitting}
            id="capture-title"
            maxLength={500}
            onChange={(event) => {
              clearResult();
              setTitle(event.target.value);
            }}
            required
            type="text"
            value={title}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-800" htmlFor="capture-body">
            正文
          </label>
          <textarea
            className="mt-2 min-h-40 w-full rounded-lg border border-zinc-300 px-3 py-2 disabled:bg-zinc-100"
            disabled={isSubmitting}
            id="capture-body"
            onChange={(event) => {
              clearResult();
              setRawText(event.target.value);
            }}
            value={rawText}
          />
          <p className="mt-1 text-xs text-zinc-500">
            有文件时正文可以留空，正文最多 2 MiB。
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-800" htmlFor="capture-files">
            添加文件或截图
          </label>
          <input
            accept={Array.from(supportedMimeTypes).join(",")}
            className="mt-2 block w-full text-sm"
            disabled={isSubmitting}
            id="capture-files"
            multiple
            onChange={handleFilesChange}
            type="file"
          />
          <p className="mt-1 text-xs text-zinc-500">
            单个文件最多 10 MiB，每次最多 50 个、总计 100 MiB。
          </p>

          {files.length > 0 && (
            <ul className="mt-3 space-y-2" aria-label="已添加文件">
              {files.map((file, index) => (
                <li
                  className="flex items-center justify-between gap-4 rounded-lg bg-zinc-50 px-3 py-2 text-sm"
                  key={`${file.name}-${file.lastModified}-${index}`}
                >
                  <span className="min-w-0 truncate">{file.name}</span>
                  <span className="shrink-0 text-zinc-600">
                    {fileProgressCopy(file, index, state, progress)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-800" htmlFor="capture-sensitivity">
            敏感级别
          </label>
          <select
            className="mt-2 w-full rounded-lg border border-zinc-300 px-3 py-2 disabled:bg-zinc-100"
            disabled={isSubmitting}
            id="capture-sensitivity"
            onChange={(event) => {
              clearResult();
              setSensitivity(event.target.value as Sensitivity);
            }}
            value={sensitivity}
          >
            <option value="normal">普通</option>
            <option value="sensitive">敏感</option>
            <option value="strictly_sensitive">严格敏感</option>
          </select>
        </div>

        {validationError !== null && (
          <p className="text-sm text-red-700" role="alert">
            {validationError}
          </p>
        )}

        {isSubmitting && (
          <p
            aria-live="polite"
            className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-900"
            role="status"
          >
            {overallProgressCopy(progress)}
          </p>
        )}

        <button
          className="w-full rounded-lg bg-zinc-900 px-4 py-3 font-medium text-white disabled:cursor-not-allowed disabled:bg-zinc-400"
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting ? "正在保存…" : "保存并后台整理"}
        </button>
      </form>

      <CaptureReceipt
        failureReason={submissionError}
        receipt={receipt}
      />
    </div>
  );
}
