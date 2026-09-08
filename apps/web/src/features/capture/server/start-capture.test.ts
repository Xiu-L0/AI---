import { beforeEach, describe, expect, it } from "vitest";

import {
  CaptureStartError,
  type CaptureStartRepository,
  type CaptureStartSession,
  startCaptureWithRepository,
} from "./start-capture";

const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const CAPTURE_ID = "20000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-07-29T20:00:00.000Z");

const baseCapture = {
  attachments: [
    {
      byteSize: 100,
      clientId: "file-1",
      fileName: "notes.txt",
      mimeType: "text/plain" as const,
      sha256: "a".repeat(64),
    },
  ],
  externalRef: null,
  idempotencyKey: "capture-key-1",
  scope: "upload" as const,
  sensitivity: "normal" as const,
  source: "manual_file" as const,
  title: "Notes",
};

class FakeCaptureStartRepository implements CaptureStartRepository {
  readonly sessions = new Map<string, CaptureStartSession>();
  readonly signedPaths: string[] = [];
  readonly signedUploadOptions: Array<{ upsert: boolean }> = [];
  createCount = 0;
  failSigningAt: number | null = null;
  signedTokenGeneration = 0;

  private key(ownerUserId: string, idempotencyKey: string) {
    return `${ownerUserId}:${idempotencyKey}`;
  }

  async findCaptureSession(
    ownerUserId: string,
    idempotencyKey: string,
  ) {
    return this.sessions.get(this.key(ownerUserId, idempotencyKey)) ?? null;
  }

  async findCaptureSessionById(
    _ownerUserId: string,
    captureId: string,
  ) {
    return (
      [...this.sessions.values()].find(
        (candidate) => candidate.id === captureId,
      ) ?? null
    );
  }

  async createCaptureSession(input: {
    captureId: string;
    expiresAt: string;
    ownerUserId: string;
    capture: typeof baseCapture;
  }) {
    this.createCount += 1;
    const session: CaptureStartSession = {
      expiresAt: input.expiresAt,
      failureReason: null,
      id: input.captureId,
      input: input.capture,
      resolvedAt: null,
      status: "awaiting_upload",
    };
    this.sessions.set(
      this.key(input.ownerUserId, input.capture.idempotencyKey),
      session,
    );
    return session;
  }

  async createSignedUploadUrl(
    storagePath: string,
    options: { upsert: boolean },
  ) {
    this.signedPaths.push(storagePath);
    this.signedUploadOptions.push(options);
    if (this.failSigningAt === this.signedPaths.length) {
      throw new Error("synthetic signing failure");
    }
    this.signedTokenGeneration += 1;
    return { token: `token-${this.signedTokenGeneration}` };
  }

  async markCaptureSessionFailed(
    ownerUserId: string,
    captureId: string,
    failureReason: string,
  ) {
    const session = [...this.sessions.values()].find(
      (candidate) => candidate.id === captureId,
    );
    if (!session) {
      throw new Error("session not found");
    }
    session.status = "failed";
    session.failureReason = failureReason;
    this.sessions.set(
      this.key(ownerUserId, session.input.idempotencyKey),
      session,
    );
    expect(failureReason.length).toBeGreaterThan(0);
  }

  async reopenCaptureSession(
    ownerUserId: string,
    captureId: string,
    failureReason: string,
  ) {
    const session = [...this.sessions.values()].find(
      (candidate) => candidate.id === captureId,
    );
    if (!session) {
      throw new Error("session not found");
    }
    if (session.failureReason !== failureReason) {
      throw new Error("failure reason changed");
    }
    session.status = "awaiting_upload";
    session.failureReason = null;
    this.sessions.set(
      this.key(ownerUserId, session.input.idempotencyKey),
      session,
    );
    return session;
  }

  async renewCaptureSession(
    ownerUserId: string,
    captureId: string,
    expiresAt: string,
  ) {
    const session = [...this.sessions.values()].find(
      (candidate) => candidate.id === captureId,
    );
    if (!session) {
      throw new Error("session not found");
    }
    session.status = "awaiting_upload";
    session.failureReason = null;
    session.expiresAt = expiresAt;
    this.sessions.set(
      this.key(ownerUserId, session.input.idempotencyKey),
      session,
    );
    return session;
  }
}

describe("startCaptureWithRepository", () => {
  let repository: FakeCaptureStartRepository;

  beforeEach(() => {
    repository = new FakeCaptureStartRepository();
  });

  it("creates a two-hour capture session and signed upload targets", async () => {
    const result = await startCaptureWithRepository(repository, {
      createCaptureId: () => CAPTURE_ID,
      input: baseCapture,
      now: NOW,
      ownerUserId: OWNER_ID,
    });

    expect(result.captureId).toBe(CAPTURE_ID);
    expect(result.uploadTargets).toEqual([
      {
        clientId: "file-1",
        storagePath: `${OWNER_ID}/${CAPTURE_ID}/file-1-${"a".repeat(
          64,
        )}-notes.txt`,
        token: "token-1",
      },
    ]);
    expect(repository.createCount).toBe(1);
    expect(repository.signedUploadOptions).toEqual([{ upsert: false }]);
    expect(
      repository.sessions.get(`${OWNER_ID}:capture-key-1`)?.expiresAt,
    ).toBe("2026-07-29T22:00:00.000Z");
  });

  it("reuses the capture id and paths while refreshing signed tokens", async () => {
    const first = await startCaptureWithRepository(repository, {
      createCaptureId: () => CAPTURE_ID,
      input: baseCapture,
      now: NOW,
      ownerUserId: OWNER_ID,
    });
    const second = await startCaptureWithRepository(repository, {
      createCaptureId: () => {
        throw new Error("a retry must not allocate a capture id");
      },
      input: baseCapture,
      now: new Date(NOW.getTime() + 60_000),
      ownerUserId: OWNER_ID,
    });

    expect(second.captureId).toBe(first.captureId);
    expect(second.uploadTargets[0]?.storagePath).toBe(
      first.uploadTargets[0]?.storagePath,
    );
    expect(second.uploadTargets[0]?.token).not.toBe(
      first.uploadTargets[0]?.token,
    );
    expect(repository.createCount).toBe(1);
    expect(repository.signedUploadOptions).toEqual([
      { upsert: false },
      { upsert: true },
    ]);
  });

  it("marks the whole session failed when any signed URL fails", async () => {
    repository.failSigningAt = 1;

    await expect(
      startCaptureWithRepository(repository, {
        createCaptureId: () => CAPTURE_ID,
        input: baseCapture,
        now: NOW,
        ownerUserId: OWNER_ID,
      }),
    ).rejects.toMatchObject({
      captureId: CAPTURE_ID,
      code: "signed_upload_failed",
    });
    expect(
      repository.sessions.get(`${OWNER_ID}:capture-key-1`)?.status,
    ).toBe("failed");
  });

  it("retries a transient signing failure with the same capture id", async () => {
    repository.failSigningAt = 1;
    await expect(
      startCaptureWithRepository(repository, {
        createCaptureId: () => CAPTURE_ID,
        input: baseCapture,
        now: NOW,
        ownerUserId: OWNER_ID,
      }),
    ).rejects.toMatchObject({ code: "signed_upload_failed" });

    repository.failSigningAt = null;
    const result = await startCaptureWithRepository(repository, {
      input: baseCapture,
      now: new Date(NOW.getTime() + 60_000),
      ownerUserId: OWNER_ID,
    });

    expect(result.captureId).toBe(CAPTURE_ID);
    expect(repository.createCount).toBe(1);
    expect(repository.signedUploadOptions.at(-1)).toEqual({ upsert: true });
    expect(
      repository.sessions.get(`${OWNER_ID}:capture-key-1`)?.status,
    ).toBe("awaiting_upload");
  });

  it("renews an expired session without changing its idempotency key", async () => {
    repository.sessions.set(`${OWNER_ID}:capture-key-1`, {
      expiresAt: "2026-07-29T19:59:59.000Z",
      failureReason: null,
      id: CAPTURE_ID,
      input: baseCapture,
      resolvedAt: null,
      status: "awaiting_upload",
    });

    const result = await startCaptureWithRepository(repository, {
      input: baseCapture,
      now: NOW,
      ownerUserId: OWNER_ID,
    });

    expect(result.captureId).toBe(CAPTURE_ID);
    expect(
      repository.sessions.get(`${OWNER_ID}:capture-key-1`),
    ).toMatchObject({
      expiresAt: "2026-07-29T22:00:00.000Z",
      status: "awaiting_upload",
    });
  });

  it("creates a new session only for an explicit compatible recovery target", async () => {
    const originalInput = {
      ...baseCapture,
      idempotencyKey: "original-failed-key",
    };
    repository.sessions.set(`${OWNER_ID}:${originalInput.idempotencyKey}`, {
      expiresAt: "2026-07-29T19:59:59.000Z",
      failureReason: "capture session expired",
      id: CAPTURE_ID,
      input: originalInput,
      resolvedAt: null,
      status: "failed",
    });
    const recoveryId = "20000000-0000-4000-8000-000000000002";
    const recoveryInput = {
      ...baseCapture,
      idempotencyKey: "recovery-capture-key",
      recoveryCaptureId: CAPTURE_ID,
    };

    const result = await startCaptureWithRepository(repository, {
      createCaptureId: () => recoveryId,
      input: recoveryInput,
      now: NOW,
      ownerUserId: OWNER_ID,
    });

    expect(result.captureId).toBe(recoveryId);
    expect(
      repository.sessions.get(`${OWNER_ID}:${recoveryInput.idempotencyKey}`)
        ?.input.recoveryCaptureId,
    ).toBe(CAPTURE_ID);
  });

  it("rejects a recovery link to a finalized session", async () => {
    repository.sessions.set(`${OWNER_ID}:finalized-original`, {
      expiresAt: "2026-07-29T22:00:00.000Z",
      failureReason: null,
      id: CAPTURE_ID,
      input: { ...baseCapture, idempotencyKey: "finalized-original" },
      resolvedAt: null,
      status: "finalized",
    });

    await expect(
      startCaptureWithRepository(repository, {
        input: {
          ...baseCapture,
          idempotencyKey: "invalid-recovery-key",
          recoveryCaptureId: CAPTURE_ID,
        },
        now: NOW,
        ownerUserId: OWNER_ID,
      }),
    ).rejects.toMatchObject({ code: "invalid_recovery" });
    expect(repository.createCount).toBe(0);
  });

  it("removes traversal segments from client ids and file names", async () => {
    const unsafeCapture = {
      ...baseCapture,
      attachments: [
        {
          ...baseCapture.attachments[0]!,
          clientId: "../private",
          fileName: "..\\..\\secret?.txt",
        },
      ],
    };

    const result = await startCaptureWithRepository(repository, {
      createCaptureId: () => CAPTURE_ID,
      input: unsafeCapture,
      now: NOW,
      ownerUserId: OWNER_ID,
    });
    const path = result.uploadTargets[0]?.storagePath;

    expect(path?.split("/")).toHaveLength(3);
    expect(path).toMatch(
      new RegExp(`^${OWNER_ID}/${CAPTURE_ID}/~[a-f0-9]+-${"a".repeat(64)}-secret_.txt$`),
    );
    expect(path).not.toContain("..");
    expect(path).not.toContain("\\");
  });

  it("returns an existing-session error for a finalized retry", async () => {
    repository.sessions.set(`${OWNER_ID}:capture-key-1`, {
      expiresAt: "2026-07-29T22:00:00.000Z",
      failureReason: null,
      id: CAPTURE_ID,
      input: baseCapture,
      resolvedAt: null,
      status: "finalized",
    });

    await expect(
      startCaptureWithRepository(repository, {
        input: baseCapture,
        now: NOW,
        ownerUserId: OWNER_ID,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<CaptureStartError>>({
        captureId: CAPTURE_ID,
        code: "capture_already_finalized",
      }),
    );
    expect(repository.signedPaths).toEqual([]);
  });

  it("reuses a typed Xiaohongshu start and conflicts on metadata changes", async () => {
    const xhsStart = {
      attachments: [] as Array<{
        byteSize: number;
        clientId: string;
        fileName: string;
        mimeType: "image/png";
        sha256: string;
      }>,
      externalRef: "65abc123",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      metadata: {
        adapterName: "xiaohongshu" as const,
        adapterVersion: "2026-09-08.v1",
        assets: [
          { alt: "cover", clientId: "img-1", ordinal: 0 },
        ],
        author: "合成作者",
        capturedAt: "2026-09-08T01:00:00.000Z",
        canonicalUrl: "https://www.xiaohongshu.com/explore/65abc123",
      },
      scope: "web_page" as const,
      sensitivity: "normal" as const,
      sourceKind: "social_post" as const,
      sourcePlatform: "xiaohongshu" as const,
      title: "合成小红书笔记",
    };

    const first = await startCaptureWithRepository(repository, {
      createCaptureId: () => CAPTURE_ID,
      input: xhsStart,
      now: NOW,
      ownerUserId: OWNER_ID,
    });
    const retry = await startCaptureWithRepository(repository, {
      input: {
        ...xhsStart,
        metadata: {
          ...xhsStart.metadata,
          capturedAt: "2026-09-08T02:00:00.000Z",
        },
      },
      now: new Date(NOW.getTime() + 60_000),
      ownerUserId: OWNER_ID,
    });

    expect(retry.captureId).toBe(first.captureId);
    expect(repository.createCount).toBe(1);
    expect(
      repository.sessions.get(`${OWNER_ID}:${xhsStart.idempotencyKey}`)
        ?.input.sourcePlatform,
    ).toBe("xiaohongshu");

    await expect(
      startCaptureWithRepository(repository, {
        input: {
          ...xhsStart,
          metadata: {
            ...xhsStart.metadata,
            author: "另一个作者",
          },
        },
        now: NOW,
        ownerUserId: OWNER_ID,
      }),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
  });

  it("still accepts a legacy ChatGPT web start payload", async () => {
    const result = await startCaptureWithRepository(repository, {
      createCaptureId: () => CAPTURE_ID,
      input: {
        attachments: [],
        externalRef: "conversation-1",
        idempotencyKey: "chatgpt-legacy-start",
        scope: "full_conversation",
        sensitivity: "normal",
        source: "chatgpt_web",
        title: "合成对话",
      },
      now: NOW,
      ownerUserId: OWNER_ID,
    });

    expect(result.captureId).toBe(CAPTURE_ID);
    expect(
      repository.sessions.get(`${OWNER_ID}:chatgpt-legacy-start`)?.input,
    ).toMatchObject({
      source: "chatgpt_web",
      sourceKind: "ai_conversation",
      sourcePlatform: "chatgpt",
    });
  });
});
