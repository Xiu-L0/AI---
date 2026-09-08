import "server-only";

import {
  AttachmentManifestSchema,
  CaptureMetadataSchema,
  CaptureReceiptSchema,
  resolveSourceIdentity,
  type AttachmentManifest,
  type CaptureMetadata,
  type CaptureReceipt,
  type CaptureSource,
  type FinalizeCaptureInput,
  type SourceKind,
  type SourcePlatform,
} from "@recall/contracts";
import { computeContentFingerprint } from "@recall/domain";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";

import { buildCaptureStoragePath } from "./start-capture";

const RAW_CAPTURE_BUCKET = "raw-captures";

export class CaptureNotFoundError extends Error {
  constructor() {
    super("Capture session was not found");
    this.name = "CaptureNotFoundError";
  }
}

export class CaptureConflictError extends Error {
  constructor(message = "Capture finalization conflicts with existing data") {
    super(message);
    this.name = "CaptureConflictError";
  }
}

export class CaptureVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptureVerificationError";
  }
}

export class CaptureExpiredError extends Error {
  constructor() {
    super("Capture session expired");
    this.name = "CaptureExpiredError";
  }
}

export type PendingCaptureSession = {
  id: string;
  idempotencyKey: string;
  source?: CaptureSource | null;
  sourceKind?: SourceKind;
  sourcePlatform?: SourcePlatform;
  metadata?: CaptureMetadata;
  externalRef: string | null;
  status: "awaiting_upload" | "finalized" | "failed";
  expiresAt: string;
  expectedAttachments: AttachmentManifest[];
};

export type EnrichedAttachment = AttachmentManifest & {
  storagePath: string;
  etag: string;
};

type ExistingFinalization = {
  receipt: CaptureReceipt;
  contentFingerprint: string;
};

export interface FinalizeCaptureRepository {
  loadCaptureSession(
    ownerUserId: string,
    captureId: string,
  ): Promise<PendingCaptureSession | null>;
  findReceiptByIdempotencyKey(
    ownerUserId: string,
    idempotencyKey: string,
  ): Promise<ExistingFinalization | null>;
  verifyAttachment(input: {
    expected: AttachmentManifest;
    storagePath: string;
    etag: string | undefined;
  }): Promise<EnrichedAttachment>;
  markSessionFailed(
    ownerUserId: string,
    captureId: string,
    reason: string,
    expectedExpiresAt: string,
  ): Promise<boolean>;
  commitFinalization(input: {
    ownerUserId: string;
    captureId: string;
    idempotencyKey: string;
    completeness: FinalizeCaptureInput["completeness"];
    missingElements: string[];
    rawText: string;
    contentFingerprint: string;
    messages: FinalizeCaptureInput["messages"];
    attachments: EnrichedAttachment[];
  }): Promise<CaptureReceipt>;
}

function sameStringArray(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export async function finalizeCaptureWithRepository(
  repository: FinalizeCaptureRepository,
  args: {
    ownerUserId: string;
    captureId: string;
    input: FinalizeCaptureInput;
    now?: Date;
  },
): Promise<CaptureReceipt> {
  const session = await repository.loadCaptureSession(
    args.ownerUserId,
    args.captureId,
  );
  if (!session) {
    throw new CaptureNotFoundError();
  }
  if (session.idempotencyKey !== args.input.idempotencyKey) {
    throw new CaptureConflictError("Idempotency key does not match capture");
  }

  const identity = resolveSourceIdentity({
    source: session.source ?? undefined,
    sourceKind: session.sourceKind,
    sourcePlatform: session.sourcePlatform,
  });
  const contentFingerprint = await computeContentFingerprint({
    sourceKind: identity.sourceKind,
    sourcePlatform: identity.sourcePlatform,
    ...(identity.source == null ? {} : { source: identity.source }),
    externalRef: session.externalRef,
    metadata: session.metadata ?? null,
    rawText: args.input.rawText,
    messages: args.input.messages,
    attachmentHashes: session.expectedAttachments.map(
      (attachment) => attachment.sha256,
    ),
  });
  const existing = await repository.findReceiptByIdempotencyKey(
    args.ownerUserId,
    args.input.idempotencyKey,
  );

  if (existing) {
    const isSameFinalization =
      existing.receipt.captureId === args.captureId &&
      existing.contentFingerprint === contentFingerprint &&
      existing.receipt.captureStatus === args.input.completeness &&
      sameStringArray(
        existing.receipt.missingElements,
        args.input.missingElements,
      );
    if (!isSameFinalization) {
      throw new CaptureConflictError();
    }
    return existing.receipt;
  }

  if (session.status !== "awaiting_upload") {
    throw new CaptureConflictError("Capture session is not awaiting upload");
  }

  const now = args.now ?? new Date();
  if (new Date(session.expiresAt).getTime() <= now.getTime()) {
    const markedFailed = await repository.markSessionFailed(
      args.ownerUserId,
      args.captureId,
      "capture session expired",
      session.expiresAt,
    );
    if (!markedFailed) {
      const currentSession = await repository.loadCaptureSession(
        args.ownerUserId,
        args.captureId,
      );
      if (!currentSession) {
        throw new CaptureNotFoundError();
      }
      if (currentSession.status === "finalized") {
        const currentReceipt =
          await repository.findReceiptByIdempotencyKey(
            args.ownerUserId,
            args.input.idempotencyKey,
          );
        if (
          currentReceipt &&
          currentReceipt.contentFingerprint === contentFingerprint &&
          currentReceipt.receipt.captureStatus === args.input.completeness &&
          sameStringArray(
            currentReceipt.receipt.missingElements,
            args.input.missingElements,
          )
        ) {
          return currentReceipt.receipt;
        }
      }
      throw new CaptureConflictError(
        "Capture session changed while expiration was being recorded; retry",
      );
    }
    throw new CaptureExpiredError();
  }

  if (
    args.input.uploadedAttachments.length !==
    session.expectedAttachments.length
  ) {
    throw new CaptureVerificationError(
      "Uploaded attachments do not match the expected manifest",
    );
  }

  const uploadsByClientId = new Map(
    args.input.uploadedAttachments.map((attachment) => [
      attachment.clientId,
      attachment,
    ]),
  );
  const attachments: EnrichedAttachment[] = [];

  for (const expected of session.expectedAttachments) {
    const uploaded = uploadsByClientId.get(expected.clientId);
    if (!uploaded) {
      throw new CaptureVerificationError(
        `Expected attachment ${expected.clientId} is missing`,
      );
    }
    const expectedPath = buildCaptureStoragePath(
      args.ownerUserId,
      args.captureId,
      expected,
    );
    if (uploaded.storagePath !== expectedPath) {
      throw new CaptureVerificationError(
        `Attachment ${expected.clientId} has an unexpected storage path`,
      );
    }
    attachments.push(
      await repository.verifyAttachment({
        expected,
        storagePath: uploaded.storagePath,
        etag: uploaded.etag,
      }),
    );
  }

  return repository.commitFinalization({
    ownerUserId: args.ownerUserId,
    captureId: args.captureId,
    idempotencyKey: args.input.idempotencyKey,
    completeness: args.input.completeness,
    missingElements: args.input.missingElements,
    rawText: args.input.rawText,
    contentFingerprint,
    messages: args.input.messages,
    attachments,
  });
}

function normalizeEtag(value: string) {
  return value.trim().replace(/^W\//i, "").replace(/^"|"$/g, "");
}

async function hashBlob(blob: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function createFinalizeCaptureRepository(): FinalizeCaptureRepository {
  const admin = createAdminClient();

  return {
    async loadCaptureSession(ownerUserId, captureId) {
      const { data, error } = await admin
        .from("capture_sessions")
        .select(
          "id, idempotency_key, source, source_kind, source_platform, metadata_json, external_ref, status, expires_at, expected_attachments",
        )
        .eq("id", captureId)
        .eq("owner_user_id", ownerUserId)
        .maybeSingle();
      if (error) {
        throw error;
      }
      if (!data) {
        return null;
      }

      const expectedAttachments = z
        .array(AttachmentManifestSchema)
        .parse(data.expected_attachments);
      const metadataValue = data.metadata_json;
      const metadata =
        metadataValue == null ||
        typeof metadataValue !== "object" ||
        Array.isArray(metadataValue) ||
        Object.keys(metadataValue).length === 0
          ? undefined
          : CaptureMetadataSchema.parse(metadataValue);
      return {
        id: data.id,
        idempotencyKey: data.idempotency_key,
        source: data.source,
        sourceKind: data.source_kind,
        sourcePlatform: data.source_platform,
        ...(metadata == null ? {} : { metadata }),
        externalRef: data.external_ref,
        status: data.status,
        expiresAt: data.expires_at,
        expectedAttachments,
      };
    },
    async findReceiptByIdempotencyKey(ownerUserId, idempotencyKey) {
      const { data: session, error: sessionError } = await admin
        .from("capture_sessions")
        .select("id, source_item_id, result_source_version_id")
        .eq("owner_user_id", ownerUserId)
        .eq("idempotency_key", idempotencyKey)
        .eq("status", "finalized")
        .maybeSingle();
      if (sessionError) {
        throw sessionError;
      }
      if (!session?.source_item_id) {
        return null;
      }

      let versionQuery = admin
        .from("source_versions")
        .select("id, capture_status, missing_elements, content_fingerprint")
        .eq("owner_user_id", ownerUserId);
      versionQuery = session.result_source_version_id
        ? versionQuery.eq("id", session.result_source_version_id)
        : versionQuery.eq("capture_session_id", session.id);
      const { data: version, error: versionError } =
        await versionQuery.single();
      if (versionError) {
        throw versionError;
      }
      const [
        { count: savedMessageCount, error: messageError },
        { count: savedAttachmentCount, error: attachmentError },
        { data: job, error: jobError },
      ] = await Promise.all([
        admin
          .from("source_messages")
          .select("id", { count: "exact", head: true })
          .eq("source_version_id", version.id)
          .eq("owner_user_id", ownerUserId),
        admin
          .from("source_attachments")
          .select("id", { count: "exact", head: true })
          .eq("source_version_id", version.id)
          .eq("owner_user_id", ownerUserId),
        admin
          .from("processing_jobs")
          .select("status")
          .eq("source_version_id", version.id)
          .eq("owner_user_id", ownerUserId)
          .eq("job_type", "normalize_source")
          .single(),
      ]);
      if (messageError || attachmentError || jobError) {
        throw messageError ?? attachmentError ?? jobError;
      }

      return {
        contentFingerprint: version.content_fingerprint,
        receipt: CaptureReceiptSchema.parse({
          captureId: session.id,
          sourceItemId: session.source_item_id,
          captureStatus: version.capture_status,
          processingStatus: job.status,
          savedMessageCount: savedMessageCount ?? 0,
          savedAttachmentCount: savedAttachmentCount ?? 0,
          missingElements: version.missing_elements,
        }),
      };
    },
    async verifyAttachment({ expected, storagePath, etag }) {
      const bucket = admin.storage.from(RAW_CAPTURE_BUCKET);
      const { data: info, error: infoError } = await bucket.info(storagePath);
      if (infoError || !info) {
        throw new CaptureVerificationError(
          `Attachment ${expected.clientId} is not present in private storage`,
        );
      }
      if (
        info.size !== expected.byteSize ||
        info.contentType !== expected.mimeType
      ) {
        throw new CaptureVerificationError(
          `Attachment ${expected.clientId} metadata does not match its manifest`,
        );
      }
      if (
        !info.etag ||
        (etag !== undefined &&
          normalizeEtag(info.etag) !== normalizeEtag(etag))
      ) {
        throw new CaptureVerificationError(
          `Attachment ${expected.clientId} ETag was not confirmed`,
        );
      }

      const { data: blob, error: downloadError } = await bucket.download(
        storagePath,
        {},
        { cache: "no-store" },
      );
      if (downloadError || !blob) {
        throw new CaptureVerificationError(
          `Attachment ${expected.clientId} could not be verified`,
        );
      }
      if ((await hashBlob(blob)) !== expected.sha256) {
        throw new CaptureVerificationError(
          `Attachment ${expected.clientId} hash does not match its manifest`,
        );
      }

      return { ...expected, storagePath, etag: info.etag };
    },
    async markSessionFailed(
      ownerUserId,
      captureId,
      reason,
      expectedExpiresAt,
    ) {
      const { data, error } = await admin
        .from("capture_sessions")
        .update({ failure_reason: reason, status: "failed" })
        .eq("id", captureId)
        .eq("owner_user_id", ownerUserId)
        .eq("status", "awaiting_upload")
        .eq("expires_at", expectedExpiresAt)
        .select("id")
        .maybeSingle();
      if (error) {
        throw error;
      }
      return data !== null;
    },
    async commitFinalization(input) {
      const { data, error } = await admin.rpc("finalize_capture", {
        p_attachments: input.attachments,
        p_capture_id: input.captureId,
        p_capture_status: input.completeness,
        p_content_fingerprint: input.contentFingerprint,
        p_idempotency_key: input.idempotencyKey,
        p_messages: input.messages,
        p_missing_elements: input.missingElements,
        p_owner_user_id: input.ownerUserId,
        p_raw_text: input.rawText,
      });
      if (error?.code === "P0002") {
        throw new CaptureNotFoundError();
      }
      if (error?.code === "23505" || error?.code === "22023") {
        throw new CaptureConflictError(error.message);
      }
      if (error) {
        throw error;
      }
      return CaptureReceiptSchema.parse(data);
    },
  };
}

export async function finalizeCapture(
  ownerUserId: string,
  captureId: string,
  input: FinalizeCaptureInput,
): Promise<CaptureReceipt> {
  return finalizeCaptureWithRepository(createFinalizeCaptureRepository(), {
    ownerUserId,
    captureId,
    input,
  });
}
