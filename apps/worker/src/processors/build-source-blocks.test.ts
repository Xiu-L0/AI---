import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { ClaimedJob } from "../worker-loop";
import type { ClaimedSource, SourceRepository } from "../repositories/source-repository";
import { buildSourceBlocks, createBuildSourceBlocksProcessor, hashMessageBlock } from "./build-source-blocks";
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

function source(): ClaimedSource {
  return {
    item: {
      id: "10000000-0000-4000-8000-0000000000b1",
      title: "ChatGPT fixture",
      source: "chatgpt_web",
      spaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    },
    version: {
      id: "30000000-0000-4000-8000-0000000000b1",
      sourceItemId: "10000000-0000-4000-8000-0000000000b1",
      missingElements: ["missing image"],
      rawText: "",
      captureStatus: "partial",
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

    const result = await createBuildSourceBlocksProcessor(repository)(job());
    expect(result.resultSummary).toBe("persisted 2 source blocks");
    expect(replaceSourceBlocks).toHaveBeenCalledOnce();
    expect(replaceSourceBlocks).toHaveBeenCalledWith(
      job(),
      expect.arrayContaining([
        expect.objectContaining({ locatorKey: "message:msg-user/body" }),
      ]),
    );
  });
});
