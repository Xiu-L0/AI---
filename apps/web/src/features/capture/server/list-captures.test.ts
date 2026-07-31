import { describe, expect, it, vi } from "vitest";

import {
  getCaptureDetailsWithRepository,
  isValidCaptureSourceItemId,
  listCapturesWithRepository,
  type CaptureHistoryRepository,
  type CaptureSourceRecord,
  type CaptureVersionRecord,
} from "./list-captures";

const ownerUserId = "00000000-0000-0000-0000-000000000001";
const item: CaptureSourceRecord = {
  createdAt: "2026-07-29T10:00:00.000Z",
  currentVersion: 2,
  id: "10000000-0000-0000-0000-000000000001",
  sensitivity: "normal",
  source: "chatgpt_web",
  title: "可靠采集讨论",
  updatedAt: "2026-07-29T12:00:00.000Z",
};
const firstVersion: CaptureVersionRecord = {
  captureSessionId: "20000000-0000-0000-0000-000000000001",
  captureStatus: "partial",
  createdAt: "2026-07-29T10:00:00.000Z",
  id: "30000000-0000-0000-0000-000000000001",
  missingElements: ["2 张图片无法读取"],
  rawText: "第一版",
  sourceItemId: item.id,
  version: 1,
};
const secondVersion: CaptureVersionRecord = {
  ...firstVersion,
  captureSessionId: "20000000-0000-0000-0000-000000000002",
  captureStatus: "complete",
  createdAt: "2026-07-29T12:00:00.000Z",
  id: "30000000-0000-0000-0000-000000000002",
  missingElements: [],
  rawText: "第二版",
  version: 2,
};

function createRepository(
  overrides: Partial<CaptureHistoryRepository> = {},
): CaptureHistoryRepository {
  return {
    createAttachmentDownloadUrl: vi.fn(async () => "https://signed.test/file"),
    listAttachments: vi.fn(async () => []),
    listMessages: vi.fn(async () => []),
    listProcessingJobs: vi.fn(async () => []),
    listSourceItems: vi.fn(async () => [item]),
    listVersions: vi.fn(async () => [firstVersion, secondVersion]),
    loadSourceItem: vi.fn(async () => item),
    ...overrides,
  };
}

describe("listCapturesWithRepository", () => {
  it("returns only the latest version and committed row counts", async () => {
    const repository = createRepository({
      listAttachments: vi.fn(async () => [
        {
          byteSize: 12,
          clientId: "image-1",
          fileName: "screen.png",
          id: "40000000-0000-0000-0000-000000000001",
          mimeType: "image/png",
          sha256: "a".repeat(64),
          sourceVersionId: secondVersion.id,
          storagePath: `${ownerUserId}/capture/screen.png`,
        },
      ]),
      listMessages: vi.fn(async () => [
        {
          body: "问题",
          externalMessageId: "m1",
          id: "50000000-0000-0000-0000-000000000001",
          ordinal: 0,
          role: "user",
          sourceVersionId: secondVersion.id,
        },
        {
          body: "回答",
          externalMessageId: "m2",
          id: "50000000-0000-0000-0000-000000000002",
          ordinal: 1,
          role: "assistant",
          sourceVersionId: secondVersion.id,
        },
      ]),
      listProcessingJobs: vi.fn<CaptureHistoryRepository["listProcessingJobs"]>(
        async () => [
          {
            failureReason: null,
            sourceVersionId: secondVersion.id,
            status: "queued",
          },
        ],
      ),
    });

    const result = await listCapturesWithRepository(
      repository,
      ownerUserId,
      null,
      20,
    );

    expect(result.items).toEqual([
      expect.objectContaining({
        captureStatus: "complete",
        savedAttachmentCount: 1,
        savedMessageCount: 2,
        sourceVersionId: secondVersion.id,
        version: 2,
      }),
    ]);
    expect(repository.listSourceItems).toHaveBeenCalledWith(ownerUserId, {
      cursor: null,
      limit: 21,
    });
    expect(repository.listVersions).toHaveBeenCalledWith(ownerUserId, [
      item.id,
    ]);
    expect(repository.listMessages).toHaveBeenCalledWith(ownerUserId, [
      secondVersion.id,
    ]);
  });

  it("uses update time and source id as a stable cursor", async () => {
    const laterItem = { ...item, id: "10000000-0000-0000-0000-000000000002" };
    const listSourceItems = vi
      .fn<CaptureHistoryRepository["listSourceItems"]>()
      .mockResolvedValueOnce([item, laterItem])
      .mockResolvedValueOnce([]);
    const repository = createRepository({
      listSourceItems,
      listVersions: vi.fn<CaptureHistoryRepository["listVersions"]>(
        async (_owner, sourceItemIds) =>
          sourceItemIds.map((sourceItemId, index) => ({
            ...secondVersion,
            id: `30000000-0000-0000-0000-00000000000${index + 2}`,
            sourceItemId,
          })),
      ),
    });

    const result = await listCapturesWithRepository(
      repository,
      ownerUserId,
      null,
      1,
    );

    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).not.toBeNull();

    await listCapturesWithRepository(
      repository,
      ownerUserId,
      result.nextCursor,
      1,
    );
    expect(listSourceItems).toHaveBeenLastCalledWith(ownerUserId, {
      cursor: { sourceItemId: item.id, updatedAt: item.updatedAt },
      limit: 2,
    });
  });
});

describe("getCaptureDetailsWithRepository", () => {
  it("orders messages and signs each attachment for exactly sixty seconds", async () => {
    const createAttachmentDownloadUrl = vi.fn(
      async () => "https://signed.test/screen",
    );
    const repository = createRepository({
      createAttachmentDownloadUrl,
      listAttachments: vi.fn(async () => [
        {
          byteSize: 12,
          clientId: "image-1",
          fileName: "screen.png",
          id: "40000000-0000-0000-0000-000000000001",
          mimeType: "image/png",
          sha256: "a".repeat(64),
          sourceVersionId: secondVersion.id,
          storagePath: `${ownerUserId}/capture/screen.png`,
        },
      ]),
      listMessages: vi.fn(async () => [
        {
          body: "回答",
          externalMessageId: "m2",
          id: "50000000-0000-0000-0000-000000000002",
          ordinal: 1,
          role: "assistant",
          sourceVersionId: secondVersion.id,
        },
        {
          body: "问题",
          externalMessageId: "m1",
          id: "50000000-0000-0000-0000-000000000001",
          ordinal: 0,
          role: "user",
          sourceVersionId: secondVersion.id,
        },
      ]),
    });

    const result = await getCaptureDetailsWithRepository(
      repository,
      ownerUserId,
      item.id,
    );

    expect(result?.versions.map((version) => version.version)).toEqual([2, 1]);
    expect(result?.versions[0]?.messages.map((message) => message.ordinal)).toEqual([
      0, 1,
    ]);
    expect(result?.versions[0]?.attachments[0]?.downloadUrl).toBe(
      "https://signed.test/screen",
    );
    expect(createAttachmentDownloadUrl).toHaveBeenCalledWith(
      ownerUserId,
      `${ownerUserId}/capture/screen.png`,
      60,
    );
  });

  it("returns null without querying versions for another owner's item", async () => {
    const repository = createRepository({ loadSourceItem: vi.fn(async () => null) });

    await expect(
      getCaptureDetailsWithRepository(repository, ownerUserId, item.id),
    ).resolves.toBeNull();
    expect(repository.listVersions).not.toHaveBeenCalled();
  });

  it("rejects an invalid source item id before any repository query", async () => {
    const repository = createRepository();

    expect(isValidCaptureSourceItemId("not-a-uuid")).toBe(false);
    await expect(
      getCaptureDetailsWithRepository(repository, ownerUserId, "not-a-uuid"),
    ).resolves.toBeNull();
    expect(repository.loadSourceItem).not.toHaveBeenCalled();
    expect(repository.listVersions).not.toHaveBeenCalled();
  });
});
