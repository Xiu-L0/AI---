import { describe, expect, it, vi } from "vitest";

import type { ClaimedJob } from "../worker-loop";
import type { ClaimedSource, SourceRepository } from "../repositories/source-repository";
import {
  createNormalizeSourceProcessor,
  normalizeMessageBody,
  normalizeSource,
} from "./normalize-source";

function job(overrides: Partial<ClaimedJob> = {}): ClaimedJob {
  return {
    jobId: "11111111-1111-4111-8111-111111111111",
    runId: "22222222-2222-4222-8222-222222222222",
    ownerUserId: "00000000-0000-4000-8000-0000000000b1",
    spaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    sourceVersionId: "30000000-0000-4000-8000-0000000000b1",
    jobType: "normalize_source",
    attempt: 1,
    leaseExpiresAt: "2026-09-06T06:00:00.000Z",
    ...overrides,
  };
}

function source(overrides: Partial<ClaimedSource> = {}): ClaimedSource {
  return {
    item: {
      id: "10000000-0000-4000-8000-0000000000b1",
      title: "ChatGPT fixture",
      source: "chatgpt_web",
      sourcePlatform: "chatgpt",
      sourceKind: "ai_conversation",
      sensitivity: "normal",
      spaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    },
    version: {
      id: "30000000-0000-4000-8000-0000000000b1",
      sourceItemId: "10000000-0000-4000-8000-0000000000b1",
      missingElements: [],
      rawText: "",
      captureStatus: "complete",
      metadata: null,
    },
    messages: [
      {
        id: "40000000-0000-4000-8000-000000000001",
        externalMessageId: "msg-user",
        role: "user",
        body: "Hello   world\r\n\r\nNext",
        ordinal: 0,
      },
      {
        id: "40000000-0000-4000-8000-000000000002",
        externalMessageId: "msg-assistant",
        role: "assistant",
        body: "See:\r\n```ts\r\nconst  x  =  1;\r\n```\r\nDone",
        ordinal: 1,
      },
      {
        id: "40000000-0000-4000-8000-000000000003",
        externalMessageId: "msg-system",
        role: "system",
        body: "system   note",
        ordinal: 2,
      },
      {
        id: "40000000-0000-4000-8000-000000000004",
        externalMessageId: "msg-tool",
        role: "tool",
        body: "tool   output",
        ordinal: 3,
      },
    ],
    attachments: [],
    ...overrides,
  };
}

describe("normalizeSource", () => {
  it("orders ChatGPT user/assistant/system/tool messages", () => {
    const normalized = normalizeSource(
      source({
        messages: [
          source().messages[3]!,
          source().messages[1]!,
          source().messages[0]!,
          source().messages[2]!,
        ],
      }),
    );

    expect(normalized.schemaVersion).toBe("normalized-source.v1");
    expect(normalized.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "system",
      "tool",
    ]);
    expect(normalized.messages.map((message) => message.ordinal)).toEqual([0, 1, 2, 3]);
  });

  it("keeps messages when raw text is empty", () => {
    const normalized = normalizeSource(source({
      version: { ...source().version, rawText: "" },
    }));
    expect(normalized.messages).toHaveLength(4);
    expect(normalized.messages[0]?.body).toContain("Hello world");
  });

  it("normalizes duplicate whitespace and CRLF without altering fenced code", () => {
    expect(normalizeMessageBody("Hello   world\r\n\r\nNext")).toBe("Hello world\n\nNext");
    const assistant = normalizeMessageBody("See:\r\n```ts\r\nconst  x  =  1;\r\n```\r\nDone");
    expect(assistant).toContain("```ts\r\nconst  x  =  1;\r\n```");
    expect(assistant).not.toContain("const x = 1");
  });

  it("preserves a partial capture missing-image note", () => {
    const normalized = normalizeSource(
      source({
        version: {
          ...source().version,
          captureStatus: "partial",
          missingElements: ["missing image"],
        },
      }),
    );
    expect(normalized.missingElements).toEqual(["missing image"]);
  });

  it("is deterministic for the same source version", () => {
    const first = normalizeSource(source());
    const second = normalizeSource(source());
    expect(first).toEqual(second);
  });
});

describe("createNormalizeSourceProcessor", () => {
  it("enqueues build_source_blocks after a successful normalize", async () => {
    const enqueueFollowupJob = vi.fn(async () => undefined);
    const repository: SourceRepository = {
      loadClaimedSource: async () => source(),
      enqueueFollowupJob,
      replaceSourceBlocks: async () => {
        throw new Error("normalize must not persist blocks");
      },
    };

    const result = await createNormalizeSourceProcessor(repository)(job());
    expect(result.resultSummary).toBe("normalized 4 messages");
    expect(enqueueFollowupJob).toHaveBeenCalledWith(job(), "build_source_blocks");
  });

  it("routes Xiaohongshu notes with images to ocr_assets", async () => {
    const enqueueFollowupJob = vi.fn(async () => undefined);
    const xhs = source({
      item: {
        ...source().item,
        source: null,
        sourcePlatform: "xiaohongshu",
        sourceKind: "social_post",
        title: "Synthetic XHS",
      },
      version: {
        ...source().version,
        rawText: "synthetic xiaohongshu body",
        metadata: {
          author: "合成作者",
          canonicalUrl: "https://www.xiaohongshu.com/explore/note-1",
          assets: [{ clientId: "xhs-image-1", ordinal: 0, alt: "" }],
        },
      },
      messages: [],
      attachments: [
        {
          id: "50000000-0000-4000-8000-000000000001",
          clientId: "xhs-image-1",
          fileName: "xhs-image-1.png",
          mimeType: "image/png",
          byteSize: 12,
          sha256: "a".repeat(64),
          storagePath: "00000000-0000-4000-8000-0000000000b1/xhs-image-1.png",
        },
      ],
    });
    const repository: SourceRepository = {
      loadClaimedSource: async () => xhs,
      enqueueFollowupJob,
      replaceSourceBlocks: async () => {
        throw new Error("normalize must not persist blocks");
      },
    };
    const result = await createNormalizeSourceProcessor(repository)(job());
    expect(result.resultSummary).toContain("queued OCR");
    expect(enqueueFollowupJob).toHaveBeenCalledWith(job(), "ocr_assets");
  });

  it("skips OCR when a Xiaohongshu note has no eligible images", async () => {
    const enqueueFollowupJob = vi.fn(async () => undefined);
    const xhs = source({
      item: {
        ...source().item,
        source: null,
        sourcePlatform: "xiaohongshu",
        sourceKind: "social_post",
      },
      messages: [],
      attachments: [],
    });
    const repository: SourceRepository = {
      loadClaimedSource: async () => xhs,
      enqueueFollowupJob,
      replaceSourceBlocks: async () => {
        throw new Error("normalize must not persist blocks");
      },
    };
    const result = await createNormalizeSourceProcessor(repository)(job());
    expect(result.resultSummary).toContain("without OCR images");
    expect(enqueueFollowupJob).toHaveBeenCalledWith(job(), "build_source_blocks");
  });
});
