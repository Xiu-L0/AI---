import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { ClaimedJob } from "../worker-loop";
import { ProcessorError } from "../worker-loop";
import {
  PostgresOcrRepository,
  type ClaimedAttachment,
  type OcrQueryClient,
} from "./ocr-repository";

const pngBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const pngSha = createHash("sha256").update(pngBytes).digest("hex");

function job(): ClaimedJob {
  return {
    jobId: "11111111-1111-4111-8111-111111111111",
    runId: "22222222-2222-4222-8222-222222222222",
    ownerUserId: "00000000-0000-4000-8000-0000000000e1",
    spaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    sourceVersionId: "30000000-0000-4000-8000-0000000000e1",
    jobType: "ocr_assets",
    attempt: 1,
    leaseExpiresAt: "2026-09-08T06:00:00.000Z",
  };
}

function attachment(overrides: Partial<ClaimedAttachment> = {}): ClaimedAttachment {
  return {
    id: "50000000-0000-4000-8000-000000000001",
    clientId: "xhs-image-1",
    fileName: "xhs-image-1.png",
    mimeType: "image/png",
    byteSize: pngBytes.byteLength,
    sha256: pngSha,
    storagePath: "00000000-0000-4000-8000-0000000000e1/xhs-image-1.png",
    ...overrides,
  };
}

describe("PostgresOcrRepository", () => {
  it("rejects downloads whose storage path is not owned by the claimed user", async () => {
    const download = vi.fn();
    const repository = new PostgresOcrRepository(
      {
        from() {
          throw new Error("must not query before path check");
        },
        rpc: async () => ({ data: null, error: null }),
        storage: { from: () => ({ download }) },
      } as unknown as OcrQueryClient,
      "ocr-worker",
    );

    await expect(
      repository.downloadAttachment(
        job(),
        attachment({ storagePath: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/xhs-image-1.png" }),
      ),
    ).rejects.toMatchObject({
      code: "ancestry_mismatch",
    });
    expect(download).not.toHaveBeenCalled();
  });

  it("rejects downloads whose SHA does not match the stored digest", async () => {
    const repository = new PostgresOcrRepository(
      {
        from() {
          throw new Error("download must not query OCR rows");
        },
        rpc: async () => ({ data: null, error: null }),
        storage: {
          from: () => ({
            download: async () => ({ data: pngBytes, error: null }),
          }),
        },
      } as unknown as OcrQueryClient,
      "ocr-worker",
    );

    await expect(
      repository.downloadAttachment(job(), attachment({ sha256: "b".repeat(64) })),
    ).rejects.toBeInstanceOf(ProcessorError);
    await expect(
      repository.downloadAttachment(job(), attachment({ sha256: "b".repeat(64) })),
    ).rejects.toMatchObject({
      code: "attachment_sha_mismatch",
    });
  });
});
