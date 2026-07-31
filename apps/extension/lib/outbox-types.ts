import type {
  AttachmentMimeType,
  CaptureReceipt,
  CapturedMessage,
  Sensitivity,
  UploadedAttachment,
} from "@recall/contracts";

export type ChatGptCaptureScope =
  | "full_conversation"
  | "qa_pair"
  | "selection";

export type OutboxState =
  | "pending"
  | "uploading"
  | "finalizing"
  | "retry_wait"
  | "auth_paused"
  | "terminal"
  | "complete"
  | "partial";

export type ResumeStage = "preparing" | "uploading" | "finalizing";

export type FailureReportStatus =
  | "not_applicable"
  | "pending"
  | "reported"
  | "rejected";

export type StoredAttachment = {
  blobKey: string;
  byteSize: number;
  clientId: string;
  fileName: string;
  mimeType: AttachmentMimeType;
  sha256: string;
};

export type PendingRemoteImage = {
  alt: string;
  clientId: string;
  fileName: string;
  messageOrdinal: number;
  sourceUrl: string;
};

export type CaptureDraft = {
  attachments: StoredAttachment[];
  completeness: "complete" | "partial";
  externalRef: string;
  messages: CapturedMessage[];
  missingElements: string[];
  originConversationRef: string;
  originTabId: number;
  originUrl: string;
  originWindowId: number;
  pendingImages: PendingRemoteImage[];
  rawText: string;
  scope: ChatGptCaptureScope;
  sensitivity: Sensitivity;
  source: "chatgpt_web";
  title: string;
};

export type OutboxItem = {
  attachmentsPrepared: boolean;
  attemptCount: number;
  captureId: string | null;
  createdAt: string;
  draft: CaptureDraft;
  errorCode: string | null;
  failureReportAttemptCount?: number;
  failureReportNextAttemptAt?: string | null;
  failureReportStatus?: FailureReportStatus;
  failureReportedAt?: string | null;
  id: string;
  idempotencyKey: string;
  lastError: string | null;
  lastNotifiedAttemptCount: number;
  nextAttemptAt: string | null;
  receipt: CaptureReceipt | null;
  receiptStoredAt: string | null;
  recoveryOfItemId: string | null;
  resolvedAt: string | null;
  resumeStage: ResumeStage;
  schemaVersion: 1;
  state: OutboxState;
  supersededByItemId: string | null;
  updatedAt: string;
  uploadedAttachments: UploadedAttachment[];
};

export function isReceiptState(
  state: OutboxState,
): state is "complete" | "partial" {
  return state === "complete" || state === "partial";
}

export function isUnresolvedOutboxItem(item: OutboxItem): boolean {
  return item.state !== "complete" && item.resolvedAt === null;
}
