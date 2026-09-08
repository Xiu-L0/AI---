import { describe, expect, it } from "vitest";

import type { ClaimedJob } from "../worker-loop";
import { PostgresSourceRepository, type SourceQueryClient } from "./source-repository";

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

describe("PostgresSourceRepository", () => {
  it("loads a Xiaohongshu item whose source column is null", async () => {
    const row = {
      id: "30000000-0000-4000-8000-0000000000e1",
      owner_user_id: "00000000-0000-4000-8000-0000000000e1",
      source_item_id: "10000000-0000-4000-8000-0000000000e1",
      version: 1,
      capture_status: "complete",
      missing_elements: [],
      raw_text: "synthetic xiaohongshu body",
      metadata_json: { author: "合成作者" },
      source_items: {
        id: "10000000-0000-4000-8000-0000000000e1",
        title: "Synthetic XHS",
        source: null,
        source_platform: "xiaohongshu",
        source_kind: "social_post",
        sensitivity: "normal",
        space_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        owner_user_id: "00000000-0000-4000-8000-0000000000e1",
      },
      source_messages: [],
      source_attachments: [
        {
          id: "50000000-0000-4000-8000-000000000001",
          client_id: "xhs-image-1",
          file_name: "xhs-image-1.png",
          mime_type: "image/png",
          byte_size: 12,
          sha256: "a".repeat(64),
          storage_path: "00000000-0000-4000-8000-0000000000e1/xhs-image-1.png",
        },
      ],
    };
    const client: SourceQueryClient = {
      from() {
        const builder = {
          select() {
            return builder;
          },
          eq() {
            return builder;
          },
          maybeSingle: async () => ({ data: row, error: null, status: 200 }),
        };
        return builder;
      },
      rpc: async () => ({ data: null, error: null }),
    };
    const repository = new PostgresSourceRepository(client, "ocr-worker");
    const source = await repository.loadClaimedSource(job());
    expect(source.item.source).toBeNull();
    expect(source.item.sourcePlatform).toBe("xiaohongshu");
    expect(source.attachments[0]?.clientId).toBe("xhs-image-1");
  });
});
