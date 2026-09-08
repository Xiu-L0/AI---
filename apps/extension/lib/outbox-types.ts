import type {
  AttachmentMimeType,
  CaptureMetadata,
  CaptureReceipt,
  CaptureScope,
  CaptureSource,
  CapturedMessage,
  Sensitivity,
  SourceKind,
  SourcePlatform,
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
  missingLabel: string;
  ordinal: number;
  sourceUrl: string;
};

export type CaptureDraft = {
  attachments: StoredAttachment[];
  completeness: "complete" | "partial";
  externalRef: string;
  messages: CapturedMessage[];
  metadata?: CaptureMetadata | undefined;
  missingElements: string[];
  originConversationRef: string;
  originTabId: number;
  originUrl: string;
  originWindowId: number;
  pendingImages: PendingRemoteImage[];
  rawText: string;
  scope: Extract<CaptureScope, ChatGptCaptureScope | "web_page">;
  sensitivity: Sensitivity;
  source?: CaptureSource | undefined;
  sourceKind: SourceKind;
  sourcePlatform: SourcePlatform;
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
  schemaVersion: 1 | 2;
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

export function migratePendingImage(value: {
  alt: string;
  clientId: string;
  fileName: string;
  messageOrdinal?: number;
  missingLabel?: string;
  ordinal?: number;
  sourceUrl: string;
}): PendingRemoteImage {
  const ordinal = value.ordinal ?? value.messageOrdinal ?? 0;
  return {
    alt: value.alt,
    clientId: value.clientId,
    fileName: value.fileName,
    missingLabel:
      value.missingLabel ??
      `第 ${ordinal + 1} 条消息中的图片无法读取`,
    ordinal,
    sourceUrl: value.sourceUrl,
  };
}
