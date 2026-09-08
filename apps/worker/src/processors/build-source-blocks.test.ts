import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { ClaimedJob } from "../worker-loop";
import type { ClaimedSource, SourceRepository } from "../repositories/source-repository";
import { buildSourceBlocks, buildSocialPostBlocks, createBuildSourceBlocksProcessor, hashMessageBlock } from "./build-source-blocks";
import { normalizeSource } from "./normalize-source";

function job(overrides: Partial<ClaimedJob> = {}): ClaimedJob {
  return {
    jobId: "11111111-1111-4111-8111-111111111111",
    runId: "22222222-2222-4222-8222-222222222222",
    ownerUserId: "00000000-0000-4000-8000-0000000000b1",
    spaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    sourceVersionId: "30000000-0000-4000-8000-0000000000b1",
    jobType: "build_source_blocks",
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
      missingElements: ["missing image"],
      rawText: "",
      captureStatus: "partial",
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
    ],
    attachments: [],
    ...overrides,
  };
}

describe("buildSourceBlocks", () => {
  it("creates one stable message block per ChatGPT message", () => {
    const normalized = normalizeSource(source());
    const blocks = buildSourceBlocks(normalized);
    const userBody = normalized.messages[0]!.body;

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      sourceMessageId: "40000000-0000-4000-8000-000000000001",
      blockType: "message",
      ordinal: 0,
      locatorKey: "message:msg-user/body",
      textContent: userBody,
      contentHash: hashMessageBlock("user", userBody),
    });
    expect(blocks[0]?.locatorJson).toEqual({
      sourceMessageId: "40000000-0000-4000-8000-000000000001",
      externalMessageId: "msg-user",
      role: "user",
      ordinal: 0,
    });
    expect(blocks[0]?.contentHash).toBe(
      createHash("sha256").update(`message\0user\0${userBody}`, "utf8").digest("hex"),
    );
    expect(blocks[1]?.locatorKey).toBe("message:msg-assistant/body");
    expect(blocks[1]?.textContent).toContain("```ts\r\nconst  x  =  1;\r\n```");
  });

  it("builds Xiaohongshu paragraph, metadata and OCR region blocks with attachment ids", () => {
    const xhs = source({
      item: {
        ...source().item,
        source: null,
        sourcePlatform: "xiaohongshu",
        sourceKind: "social_post",
      },
      version: {
        ...source().version,
        rawText: "synthetic xiaohongshu body",
        missingElements: [],
        captureStatus: "complete",
        metadata: {
          author: "合成作者",
          canonicalUrl: "https://www.xiaohongshu.com/explore/note-1",
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
          storagePath: "00000000-0000-4000-8000-0000000000b1/a.png",
        },
      ],
    });
    const blocks = buildSocialPostBlocks(xhs, [
      {
        id: "70000000-0000-4000-8000-000000000001",
        sourceAttachmentId: "50000000-0000-4000-8000-000000000001",
        inputSha256: "b".repeat(64),
        provider: "zhipu",
        model: "glm-ocr",
        providerRequestId: "req-ocr-1xxxxx",
        markdown: "Synthetic OCR markdown.",
        layoutDetails: [
          {
            page: 1,
            index: 0,
            label: "text",
            bbox: [0.1, 0.1, 0.5, 0.3],
            content: "Synthetic OCR markdown.",
            width: 600,
            height: 800,
          },
        ],
        dataInfo: { pages: [{ width: 600, height: 800 }] },
        usage: null,
      },
    ]);
    expect(blocks.map((block) => block.locatorKey)).toEqual([
      "post:body",
      "post:metadata",
      "image:xhs-image-1/page:1/region:0",
    ]);
    expect(blocks[2]).toMatchObject({
      blockType: "ocr_region",
      ordinal: 2,
      sourceAttachmentId: "50000000-0000-4000-8000-000000000001",
      textContent: "Synthetic OCR markdown.",
      locatorJson: {
        page: 1,
        index: 0,
        label: "text",
        bbox: [0.1, 0.1, 0.5, 0.3],
        provider: "zhipu",
        model: "glm-ocr",
        sourceAttachmentId: "50000000-0000-4000-8000-000000000001",
      },
    });
  });

  it("rerunning the same version yields identical locator keys and hashes", () => {
    const first = buildSourceBlocks(normalizeSource(source()));
    const second = buildSourceBlocks(normalizeSource(source()));
    expect(first.map((block) => [block.locatorKey, block.contentHash])).toEqual(
      second.map((block) => [block.locatorKey, block.contentHash]),
    );
  });
});

describe("createBuildSourceBlocksProcessor", () => {
  it("persists blocks through the replacement RPC port", async () => {
    const replaceSourceBlocks = vi.fn(async () => undefined);
    const repository: SourceRepository = {
      loadClaimedSource: async () => source(),
      enqueueFollowupJob: async () => {
        throw new Error("build_source_blocks must enqueue extract via RPC");
      },
      replaceSourceBlocks,
    };

    const result = await createBuildSourceBlocksProcessor(repository, {
      downloadAttachment: async () => {
        throw new Error("chatgpt blocks must not download OCR attachments");
      },
      findResult: async () => null,
      persistResult: async () => {
        throw new Error("chatgpt blocks must not persist OCR");
      },
      listResults: async () => {
        throw new Error("chatgpt blocks must not list OCR");
      },
    })(job());
    expect(result.resultSummary).toBe("persisted 2 source blocks");
    expect(replaceSourceBlocks).toHaveBeenCalledOnce();
    expect(replaceSourceBlocks).toHaveBeenCalledWith(
      job(),
      expect.arrayContaining([
        expect.objectContaining({ locatorKey: "message:msg-user/body" }),
      ]),
    );
  });

  it("builds Xiaohongshu OCR regions from version-scoped results", async () => {
    const xhs = source({
      item: {
        ...source().item,
        source: null,
        sourcePlatform: "xiaohongshu",
        sourceKind: "social_post",
      },
      version: {
        ...source().version,
        rawText: "synthetic xiaohongshu body",
        missingElements: [],
        captureStatus: "complete",
        metadata: {
          author: "合成作者",
          canonicalUrl: "https://www.xiaohongshu.com/explore/note-1",
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
          storagePath: "00000000-0000-4000-8000-0000000000b1/a.png",
        },
      ],
    });
    const replaceSourceBlocks = vi.fn(async () => undefined);
    const listResults = vi.fn(async () => [
      {
        id: "70000000-0000-4000-8000-000000000001",
        sourceAttachmentId: "50000000-0000-4000-8000-000000000001",
        inputSha256: "b".repeat(64),
        provider: "zhipu",
        model: "glm-ocr",
        providerRequestId: "req-ocr-1xxxxx",
        markdown: "Synthetic OCR markdown.",
        layoutDetails: [
          {
            page: 1,
            index: 0,
            label: "text",
            bbox: [0.1, 0.1, 0.5, 0.3],
            content: "Synthetic OCR markdown.",
            width: 600,
            height: 800,
          },
        ],
        dataInfo: { pages: [{ width: 600, height: 800 }] },
        usage: null,
      },
    ]);

    await createBuildSourceBlocksProcessor(
      {
        loadClaimedSource: async () => xhs,
        enqueueFollowupJob: async () => {
          throw new Error("build_source_blocks must enqueue extract via RPC");
        },
        replaceSourceBlocks,
      },
      {
        downloadAttachment: async () => {
          throw new Error("block builder must not download attachments");
        },
        findResult: async () => {
          throw new Error("block builder must not look up OCR by attachment alone");
        },
        persistResult: async () => {
          throw new Error("block builder must not persist OCR");
        },
        listResults,
      },
    )(job());

    expect(listResults).toHaveBeenCalledWith(job());
    expect(replaceSourceBlocks).toHaveBeenCalledWith(
      job(),
      expect.arrayContaining([
        expect.objectContaining({
          locatorKey: "image:xhs-image-1/page:1/region:0",
          sourceAttachmentId: "50000000-0000-4000-8000-000000000001",
        }),
      ]),
    );
  });
});
