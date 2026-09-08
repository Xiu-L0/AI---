import {
  AttachmentManifestSchema,
  CaptureMetadataSchema,
  StartCaptureInputSchema,
  resolveSourceIdentity,
  type AttachmentManifest,
  type StartCaptureInput,
  type StartCaptureResult,
} from "@recall/contracts";
import { ZodError, z } from "zod";

import type { Json } from "@/lib/supabase/database.types";

const CAPTURE_SESSION_LIFETIME_MS = 2 * 60 * 60 * 1000;
const RAW_CAPTURE_BUCKET = "raw-captures";
const SIGNING_FAILURE_REASON = "unable to create every signed upload URL";
const EXPIRED_FAILURE_REASON = "capture session expired";
const OwnerUserIdSchema = z.string().uuid();

export type CaptureStartErrorCode =
  | "capture_already_failed"
  | "capture_already_finalized"
  | "capture_session_expired"
  | "idempotency_conflict"
  | "invalid_capture"
  | "invalid_recovery"
  | "signed_upload_failed";

export class CaptureStartError extends Error {
  readonly captureId: string | undefined;
  readonly code: CaptureStartErrorCode;

  constructor(
    code: CaptureStartErrorCode,
    message: string,
    options: { captureId?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "CaptureStartError";
    this.code = code;
    this.captureId = options.captureId;
  }
}

export type CaptureStartSession = {
  id: string;
  expiresAt: string;
  failureReason: string | null;
  input: StartCaptureInput;
  resolvedAt: string | null;
  status: "awaiting_upload" | "failed" | "finalized";
};

export interface CaptureStartRepository {
  findCaptureSession(
    ownerUserId: string,
    idempotencyKey: string,
  ): Promise<CaptureStartSession | null>;
  findCaptureSessionById(
    ownerUserId: string,
    captureId: string,
  ): Promise<CaptureStartSession | null>;
  createCaptureSession(input: {
    captureId: string;
    expiresAt: string;
    ownerUserId: string;
    capture: StartCaptureInput;
  }): Promise<CaptureStartSession>;
  createSignedUploadUrl(
    storagePath: string,
    options: { upsert: boolean },
  ): Promise<{ token: string }>;
  markCaptureSessionFailed(
    ownerUserId: string,
    captureId: string,
    failureReason: string,
  ): Promise<void>;
  reopenCaptureSession(
    ownerUserId: string,
    captureId: string,
    failureReason: string,
  ): Promise<CaptureStartSession>;
  renewCaptureSession(
    ownerUserId: string,
    captureId: string,
    expiresAt: string,
    previous: {
      status: CaptureStartSession["status"];
      failureReason: string | null;
    },
  ): Promise<CaptureStartSession>;
}

type StartCaptureArguments = {
  ownerUserId: string;
  input: StartCaptureInput;
  now?: Date;
  createCaptureId?: () => string;
};

function byteHex(value: string): string {
  return Array.from(new TextEncoder().encode(value), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function safeClientId(clientId: string): string {
  return /^[A-Za-z0-9_-]+$/.test(clientId)
    ? clientId
    : `~${byteHex(clientId)}`;
}

function safeFileName(fileName: string): string {
  const leafName = fileName.normalize("NFKC").split(/[\\/]/).at(-1) ?? "";
  const safeName = leafName
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_")
    .replace(/^\.+/, "")
    .trim();

  return safeName.length === 0 ? "attachment" : safeName.slice(0, 180);
}

export function buildCaptureStoragePath(
  ownerUserId: string,
  captureId: string,
  attachment: AttachmentManifest,
): string {
  return [
    ownerUserId,
    captureId,
    `${safeClientId(attachment.clientId)}-${attachment.sha256}-${safeFileName(
      attachment.fileName,
    )}`,
  ].join("/");
}

function normalizeStartInput(input: StartCaptureInput): StartCaptureInput {
  const identity = resolveSourceIdentity(input);
  return {
    ...input,
    ...(identity.source == null ? {} : { source: identity.source }),
    sourceKind: identity.sourceKind,
    sourcePlatform: identity.sourcePlatform,
  };
}

function comparableCaptureInput(input: StartCaptureInput) {
  const identity = resolveSourceIdentity(input);
  const metadata = input.metadata;
  return {
    attachments: [...input.attachments]
      .sort((left, right) => left.clientId.localeCompare(right.clientId))
      .map((attachment) => ({
        byteSize: attachment.byteSize,
        clientId: attachment.clientId,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        sha256: attachment.sha256,
      })),
    externalRef: input.externalRef,
    metadata: metadata
      ? {
          adapterName: metadata.adapterName,
          adapterVersion: metadata.adapterVersion,
          assets: [...metadata.assets]
            .sort(
              (left, right) =>
                left.ordinal - right.ordinal ||
                left.clientId.localeCompare(right.clientId),
            )
            .map((asset) => ({
              alt: asset.alt,
              clientId: asset.clientId,
              ordinal: asset.ordinal,
            })),
          author: metadata.author,
          canonicalUrl: metadata.canonicalUrl,
        }
      : null,
    recoveryCaptureId: input.recoveryCaptureId ?? null,
    scope: input.scope,
    sensitivity: input.sensitivity,
    sourceKind: identity.sourceKind,
    sourcePlatform: identity.sourcePlatform,
    title: input.title,
  };
}

function sameCaptureInput(
  existing: StartCaptureInput,
  incoming: StartCaptureInput,
): boolean {
  return (
    JSON.stringify(comparableCaptureInput(existing)) ===
    JSON.stringify(comparableCaptureInput(incoming))
  );
}

async function failSessionAfterSigningError(
  repository: CaptureStartRepository,
  ownerUserId: string,
  captureId: string,
  cause: unknown,
): Promise<never> {
  try {
    await repository.markCaptureSessionFailed(
      ownerUserId,
      captureId,
      SIGNING_FAILURE_REASON,
    );
  } catch (markFailedError) {
    throw new CaptureStartError(
      "signed_upload_failed",
      "Signed upload setup failed and the session could not be marked failed",
      {
        captureId,
        cause: new AggregateError([cause, markFailedError]),
      },
    );
  }

  throw new CaptureStartError(
    "signed_upload_failed",
    "Signed upload setup failed; the capture session was marked failed",
    { captureId, cause },
  );
}

async function createUploadTargets(
  repository: CaptureStartRepository,
  ownerUserId: string,
  session: CaptureStartSession,
  options: { upsert: boolean },
): Promise<StartCaptureResult> {
  const uploadTargets: StartCaptureResult["uploadTargets"] = [];

  try {
    for (const attachment of session.input.attachments) {
      const storagePath = buildCaptureStoragePath(
        ownerUserId,
        session.id,
        attachment,
      );
      const { token } =
        await repository.createSignedUploadUrl(storagePath, options);
      if (token.length === 0) {
        throw new Error("signed upload token is empty");
      }
      uploadTargets.push({
        clientId: attachment.clientId,
        storagePath,
        token,
      });
    }
  } catch (error) {
    return failSessionAfterSigningError(
      repository,
      ownerUserId,
      session.id,
      error,
    );
  }

  return { captureId: session.id, uploadTargets };
}

async function requireReusableSession(
  repository: CaptureStartRepository,
  ownerUserId: string,
  session: CaptureStartSession,
  input: StartCaptureInput,
  now: Date,
): Promise<CaptureStartSession> {
  if (!sameCaptureInput(session.input, input)) {
    throw new CaptureStartError(
      "idempotency_conflict",
      "The idempotency key is already associated with different capture data",
      { captureId: session.id },
    );
  }

  if (session.status === "finalized") {
    throw new CaptureStartError(
      "capture_already_finalized",
      "The capture session is already finalized",
      { captureId: session.id },
    );
  }
  if (session.resolvedAt !== null) {
    throw new CaptureStartError(
      "capture_already_failed",
      "The capture session was resolved by a later recovery",
      { captureId: session.id },
    );
  }
  const isExpired = new Date(session.expiresAt).getTime() <= now.getTime();
  if (isExpired) {
    const canRenew =
      session.status === "awaiting_upload" ||
      session.failureReason === SIGNING_FAILURE_REASON ||
      session.failureReason === EXPIRED_FAILURE_REASON;
    if (!canRenew) {
      throw new CaptureStartError(
        "capture_already_failed",
        "The capture session has already failed",
        { captureId: session.id },
      );
    }
    return repository.renewCaptureSession(
      ownerUserId,
      session.id,
      new Date(
        now.getTime() + CAPTURE_SESSION_LIFETIME_MS,
      ).toISOString(),
      { status: session.status, failureReason: session.failureReason },
    );
  }
  if (session.status === "failed") {
    if (
      session.failureReason === SIGNING_FAILURE_REASON ||
      session.failureReason === EXPIRED_FAILURE_REASON
    ) {
      return repository.reopenCaptureSession(
        ownerUserId,
        session.id,
        session.failureReason,
      );
    }
    throw new CaptureStartError(
      "capture_already_failed",
      "The capture session has already failed",
      { captureId: session.id },
    );
  }

  return session;
}

async function requireValidRecoveryTarget(
  repository: CaptureStartRepository,
  ownerUserId: string,
  input: StartCaptureInput,
): Promise<void> {
  if (input.recoveryCaptureId == null) return;

  const target = await repository.findCaptureSessionById(
    ownerUserId,
    input.recoveryCaptureId,
  );
  const sameSource =
    target !== null &&
    (() => {
      const existing = resolveSourceIdentity(target.input);
      const incoming = resolveSourceIdentity(input);
      return (
        existing.sourceKind === incoming.sourceKind &&
        existing.sourcePlatform === incoming.sourcePlatform &&
        target.input.scope === input.scope &&
        target.input.externalRef === input.externalRef
      );
    })();
  if (
    target === null ||
    target.status === "finalized" ||
    target.resolvedAt !== null ||
    !sameSource
  ) {
    throw new CaptureStartError(
      "invalid_recovery",
      "The referenced capture session cannot be recovered by this capture",
      { captureId: input.recoveryCaptureId },
    );
  }
}

export async function startCaptureWithRepository(
  repository: CaptureStartRepository,
  args: StartCaptureArguments,
): Promise<StartCaptureResult> {
  let ownerUserId: string;
  let input: StartCaptureInput;

  try {
    ownerUserId = OwnerUserIdSchema.parse(args.ownerUserId);
    input = normalizeStartInput(StartCaptureInputSchema.parse(args.input));
  } catch (error) {
    if (error instanceof ZodError) {
      throw new CaptureStartError(
        "invalid_capture",
        "Capture start input is invalid",
        { cause: error },
      );
    }
    throw error;
  }

  const now = args.now ?? new Date();
  const existing = await repository.findCaptureSession(
    ownerUserId,
    input.idempotencyKey,
  );

  if (existing === null) {
    await requireValidRecoveryTarget(repository, ownerUserId, input);
  }

  const requestedCaptureId =
    existing === null
      ? (args.createCaptureId ?? (() => crypto.randomUUID()))()
      : null;
  const session =
    existing ??
    (await repository.createCaptureSession({
      capture: input,
      captureId: requestedCaptureId!,
      expiresAt: new Date(
        now.getTime() + CAPTURE_SESSION_LIFETIME_MS,
      ).toISOString(),
      ownerUserId,
    }));
  const isRetry =
    existing !== null || session.id !== requestedCaptureId;

  const reusableSession = await requireReusableSession(
    repository,
    ownerUserId,
    session,
    input,
    now,
  );

  return createUploadTargets(repository, ownerUserId, reusableSession, {
    upsert: isRetry,
  });
}

function parseStoredMetadata(value: Json): StartCaptureInput["metadata"] {
  if (
    value == null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length === 0
  ) {
    return undefined;
  }
  return CaptureMetadataSchema.parse(value);
}

function parseCaptureSession(
  row: {
    expected_attachments: Json;
    expires_at: string;
    failure_reason: string | null;
    external_ref: string | null;
    id: string;
    idempotency_key: string;
    metadata_json: Json;
    recovery_of_capture_session_id: string | null;
    resolved_at: string | null;
    scope: StartCaptureInput["scope"];
    sensitivity: StartCaptureInput["sensitivity"];
    source: StartCaptureInput["source"] | null;
    source_kind: NonNullable<StartCaptureInput["sourceKind"]>;
    source_platform: NonNullable<StartCaptureInput["sourcePlatform"]>;
    status: CaptureStartSession["status"];
    title: string;
  },
): CaptureStartSession {
  const metadata = parseStoredMetadata(row.metadata_json);
  return {
    expiresAt: row.expires_at,
    failureReason: row.failure_reason,
    id: row.id,
    input: StartCaptureInputSchema.parse({
      attachments: AttachmentManifestSchema.array().parse(
        row.expected_attachments,
      ),
      externalRef: row.external_ref,
      idempotencyKey: row.idempotency_key,
      ...(row.recovery_of_capture_session_id == null
        ? {}
        : { recoveryCaptureId: row.recovery_of_capture_session_id }),
      scope: row.scope,
      sensitivity: row.sensitivity,
      ...(row.source == null ? {} : { source: row.source }),
      sourceKind: row.source_kind,
      sourcePlatform: row.source_platform,
      ...(metadata == null ? {} : { metadata }),
      title: row.title,
    }),
    resolvedAt: row.resolved_at,
    status: row.status,
  };
}

async function createCaptureStartRepository(): Promise<CaptureStartRepository> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const selection =
    "id, idempotency_key, source, source_kind, source_platform, metadata_json, scope, title, sensitivity, external_ref, expected_attachments, status, failure_reason, expires_at, recovery_of_capture_session_id, resolved_at";

  const findCaptureSession: CaptureStartRepository["findCaptureSession"] =
    async (ownerUserId, idempotencyKey) => {
      const { data, error } = await admin
        .from("capture_sessions")
        .select(selection)
        .eq("owner_user_id", ownerUserId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();

      if (error) {
        throw error;
      }
      return data === null ? null : parseCaptureSession(data);
    };
  const findCaptureSessionById: CaptureStartRepository["findCaptureSessionById"] = async (
    ownerUserId: string,
    captureId: string,
  ) => {
    const { data, error } = await admin
      .from("capture_sessions")
      .select(selection)
      .eq("owner_user_id", ownerUserId)
      .eq("id", captureId)
      .maybeSingle();

    if (error) {
      throw error;
    }
    return data === null ? null : parseCaptureSession(data);
  };

  return {
    findCaptureSession,
    findCaptureSessionById,
    async createCaptureSession({
      capture,
      captureId,
      expiresAt,
      ownerUserId,
    }) {
      const { data, error } = await admin
        .from("capture_sessions")
        .insert({
          expected_attachments: capture.attachments as Json,
          expires_at: expiresAt,
          external_ref: capture.externalRef,
          id: captureId,
          idempotency_key: capture.idempotencyKey,
          metadata_json: (capture.metadata ?? {}) as Json,
          owner_user_id: ownerUserId,
          recovery_of_capture_session_id: capture.recoveryCaptureId ?? null,
          scope: capture.scope,
          sensitivity: capture.sensitivity,
          source: capture.source ?? null,
          source_kind: capture.sourceKind!,
          source_platform: capture.sourcePlatform!,
          status: "awaiting_upload",
          title: capture.title,
        })
        .select(selection)
        .single();

      if (error?.code === "23505") {
        const racedSession = await findCaptureSession(
          ownerUserId,
          capture.idempotencyKey,
        );
        if (racedSession !== null) {
          return racedSession;
        }
      }
      if (error) {
        throw error;
      }

      return parseCaptureSession(data);
    },
    async createSignedUploadUrl(storagePath, options) {
      const { data, error } = await admin.storage
        .from(RAW_CAPTURE_BUCKET)
        .createSignedUploadUrl(storagePath, options);

      if (error) {
        throw error;
      }
      return { token: data.token };
    },
    async markCaptureSessionFailed(
      ownerUserId,
      captureId,
      failureReason,
    ) {
      const { error } = await admin
        .from("capture_sessions")
        .update({
          failure_reason: failureReason,
          status: "failed",
        })
        .eq("id", captureId)
        .eq("owner_user_id", ownerUserId)
        .eq("status", "awaiting_upload");

      if (error) {
        throw error;
      }
    },
    async reopenCaptureSession(ownerUserId, captureId, failureReason) {
      const { data, error } = await admin
        .from("capture_sessions")
        .update({
          failure_reason: null,
          status: "awaiting_upload",
        })
        .eq("id", captureId)
        .eq("owner_user_id", ownerUserId)
        .eq("status", "failed")
        .eq("failure_reason", failureReason)
        .is("resolved_at", null)
        .select(selection)
        .maybeSingle();

      if (error) {
        throw error;
      }
      if (data) {
        return parseCaptureSession(data);
      }

      const racedSession = await findCaptureSessionById(
        ownerUserId,
        captureId,
      );
      if (
        racedSession?.status === "awaiting_upload" &&
        racedSession.failureReason === null
      ) {
        return racedSession;
      }
      throw new CaptureStartError(
        "capture_already_failed",
        "The capture session could not be reopened",
        { captureId },
      );
    },
    async renewCaptureSession(
      ownerUserId,
      captureId,
      expiresAt,
      previous,
    ) {
      let update = admin
        .from("capture_sessions")
        .update({
          expires_at: expiresAt,
          failure_reason: null,
          status: "awaiting_upload",
        })
        .eq("id", captureId)
        .eq("owner_user_id", ownerUserId)
        .eq("status", previous.status);
      update = update.is("resolved_at", null);
      update =
        previous.failureReason === null
          ? update.is("failure_reason", null)
          : update.eq("failure_reason", previous.failureReason);
      const { data, error } = await update.select(selection).maybeSingle();

      if (error) {
        throw error;
      }
      if (data) {
        return parseCaptureSession(data);
      }

      const racedSession = await findCaptureSessionById(
        ownerUserId,
        captureId,
      );
      if (
        racedSession?.status === "awaiting_upload" &&
        new Date(racedSession.expiresAt).getTime() > Date.now()
      ) {
        return racedSession;
      }
      if (racedSession?.status === "finalized") {
        throw new CaptureStartError(
          "capture_already_finalized",
          "The capture session was finalized concurrently",
          { captureId },
        );
      }
      throw new CaptureStartError(
        "capture_session_expired",
        "The expired capture session could not be renewed",
        { captureId },
      );
    },
  };
}

export async function startCapture(
  ownerUserId: string,
  input: StartCaptureInput,
): Promise<StartCaptureResult> {
  return startCaptureWithRepository(await createCaptureStartRepository(), {
    input,
    ownerUserId,
  });
}
