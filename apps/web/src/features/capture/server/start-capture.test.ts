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
      status: "awaiting_upload",
    };
    this.sessions.set(
      this.key(input.ownerUserId, input.capture.idempotencyKey),
      session,
    );
    return session;
  }

  async createSignedUploadUrl(storagePath: string) {
    this.signedPaths.push(storagePath);
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
});
