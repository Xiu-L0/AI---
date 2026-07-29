import type {
  AttachmentManifest,
  CaptureReceipt,
  FinalizeCaptureInput,
} from "@recall/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  CaptureConflictError,
  CaptureVerificationError,
  finalizeCaptureWithRepository,
  type FinalizeCaptureRepository,
  type PendingCaptureSession,
} from "./finalize-capture";
import { buildCaptureStoragePath } from "./start-capture";

const ownerUserId = "00000000-0000-0000-0000-000000000001";
const captureId = "20000000-0000-0000-0000-000000000001";
const sourceItemId = "30000000-0000-0000-0000-000000000001";
const attachment: AttachmentManifest = {
  clientId: "file-1",
  fileName: "screen shot.png",
  mimeType: "image/png",
  byteSize: 100,
  sha256: "a".repeat(64),
};
const session: PendingCaptureSession = {
  id: captureId,
  idempotencyKey: "same-key-123",
  source: "manual_screenshot",
  externalRef: null,
  status: "awaiting_upload",
  expiresAt: "2026-07-30T00:00:00.000Z",
  expectedAttachments: [],
};
const input: FinalizeCaptureInput = {
  idempotencyKey: "same-key-123",
  completeness: "complete",
  missingElements: [],
  rawText: "Q\nA",
  messages: [],
  uploadedAttachments: [],
};
const receipt: CaptureReceipt = {
  captureId,
  sourceItemId,
  captureStatus: "complete",
  processingStatus: "queued",
  savedMessageCount: 0,
  savedAttachmentCount: 0,
  missingElements: [],
};

function createRepository(
  overrides: Partial<FinalizeCaptureRepository> = {},
): FinalizeCaptureRepository {
  return {
    loadCaptureSession: vi.fn(async () => session),
    findReceiptByIdempotencyKey: vi.fn(async () => null),
    verifyAttachment: vi.fn(async ({ expected, storagePath, etag }) => ({
      ...expected,
      storagePath,
      etag: etag ?? "server-etag",
    })),
    markSessionFailed: vi.fn(async () => true),
    commitFinalization: vi.fn(async () => receipt),
    ...overrides,
  };
}

describe("finalizeCaptureWithRepository", () => {
  it("returns the existing receipt when the same finalization repeats", async () => {
    const committed = vi.fn();
    const firstRepository = createRepository();
    const first = await finalizeCaptureWithRepository(firstRepository, {
      ownerUserId,
      captureId,
      input,
    });
    const committedInput = vi.mocked(
      firstRepository.commitFinalization,
    ).mock.calls[0]?.[0];
    expect(committedInput).toBeDefined();

    const repository = createRepository({
      findReceiptByIdempotencyKey: vi.fn(async () => ({
        receipt,
        contentFingerprint: committedInput!.contentFingerprint,
      })),
      commitFinalization: committed,
    });
    await expect(
      finalizeCaptureWithRepository(repository, {
        ownerUserId,
        captureId,
        input,
      }),
    ).resolves.toEqual(first);
    expect(committed).not.toHaveBeenCalled();
  });

  it("rejects an idempotency retry with different content", async () => {
    const repository = createRepository({
      findReceiptByIdempotencyKey: vi.fn(async () => ({
        receipt,
        contentFingerprint: "b".repeat(64),
      })),
    });

    await expect(
      finalizeCaptureWithRepository(repository, {
        ownerUserId,
        captureId,
        input,
      }),
    ).rejects.toBeInstanceOf(CaptureConflictError);
  });

  it("requires every uploaded attachment to use its immutable path", async () => {
    const repository = createRepository({
      loadCaptureSession: vi.fn(async () => ({
        ...session,
        expectedAttachments: [attachment],
      })),
    });

    await expect(
      finalizeCaptureWithRepository(repository, {
        ownerUserId,
        captureId,
        input: {
          ...input,
          uploadedAttachments: [
            {
              clientId: attachment.clientId,
              storagePath: `${ownerUserId}/${captureId}/wrong.png`,
              etag: "etag",
            },
          ],
        },
      }),
    ).rejects.toBeInstanceOf(CaptureVerificationError);
  });

  it("commits only after the repository verifies attachment contents", async () => {
    const storagePath = buildCaptureStoragePath(
      ownerUserId,
      captureId,
      attachment,
    );
    const events: string[] = [];
    const repository = createRepository({
      loadCaptureSession: vi.fn(async () => ({
        ...session,
        expectedAttachments: [attachment],
      })),
      verifyAttachment: vi.fn(async ({ expected, etag }) => {
        events.push("verified");
        return { ...expected, storagePath, etag };
      }),
      commitFinalization: vi.fn(async () => {
        events.push("committed");
        return { ...receipt, savedAttachmentCount: 1 };
      }),
    });

    await expect(
      finalizeCaptureWithRepository(repository, {
        ownerUserId,
        captureId,
        input: {
          ...input,
          uploadedAttachments: [
            { clientId: attachment.clientId, storagePath, etag: "etag" },
          ],
        },
      }),
    ).resolves.toMatchObject({ savedAttachmentCount: 1 });
    expect(events).toEqual(["verified", "committed"]);
  });

  it("does not mark a session failed when it was renewed concurrently", async () => {
    const commitFinalization = vi.fn();
    const repository = createRepository({
      loadCaptureSession: vi
        .fn()
        .mockResolvedValueOnce({
          ...session,
          expiresAt: "2026-07-29T19:59:59.000Z",
        })
        .mockResolvedValueOnce({
          ...session,
          expiresAt: "2026-07-29T22:00:00.000Z",
        }),
      markSessionFailed: vi.fn(async () => false),
      commitFinalization,
    });

    await expect(
      finalizeCaptureWithRepository(repository, {
        ownerUserId,
        captureId,
        input,
        now: new Date("2026-07-29T20:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(CaptureConflictError);
    expect(repository.markSessionFailed).toHaveBeenCalledWith(
      ownerUserId,
      captureId,
      "capture session expired",
      "2026-07-29T19:59:59.000Z",
    );
    expect(commitFinalization).not.toHaveBeenCalled();
  });
});
