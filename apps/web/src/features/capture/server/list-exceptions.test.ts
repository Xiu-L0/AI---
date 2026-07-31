import { describe, expect, it, vi } from "vitest";

import type {
  CaptureSourceRecord,
  CaptureVersionRecord,
} from "./list-captures";
import {
  listExceptionsWithRepository,
  type CaptureExceptionRepository,
} from "./list-exceptions";

const ownerUserId = "00000000-0000-0000-0000-000000000001";
const item: CaptureSourceRecord = {
  createdAt: "2026-07-29T10:00:00.000Z",
  currentVersion: 2,
  id: "10000000-0000-0000-0000-000000000001",
  sensitivity: "normal",
  source: "chatgpt_web",
  title: "异常恢复讨论",
  updatedAt: "2026-07-29T12:00:00.000Z",
};
const partial: CaptureVersionRecord = {
  captureSessionId: "20000000-0000-0000-0000-000000000001",
  captureStatus: "partial",
  createdAt: "2026-07-29T10:00:00.000Z",
  id: "30000000-0000-0000-0000-000000000001",
  missingElements: ["2 张图片无法读取"],
  rawText: "已保存内容",
  sourceItemId: item.id,
  version: 1,
};

function createRepository(
  overrides: Partial<CaptureExceptionRepository> = {},
): CaptureExceptionRepository {
  return {
    listFailedCaptureSessions: vi.fn(async () => []),
    listFailedProcessingJobs: vi.fn(async () => []),
    listSourceItems: vi.fn(async () => [item]),
    listVersions: vi.fn(async () => [partial]),
    ...overrides,
  };
}

describe("listExceptionsWithRepository", () => {
  it("keeps the latest partial capture visible with its missing elements", async () => {
    const repository = createRepository();

    const result = await listExceptionsWithRepository(
      repository,
      ownerUserId,
    );

    expect(result).toEqual([
      expect.objectContaining({
        kind: "partial_capture",
        missingElements: ["2 张图片无法读取"],
        rawDataSafe: true,
        recovery: "extension_screenshot",
        sourceItemId: item.id,
      }),
    ]);
    expect(repository.listSourceItems).toHaveBeenCalledWith(ownerUserId);
    expect(repository.listVersions).toHaveBeenCalledWith(ownerUserId);
    expect(repository.listFailedCaptureSessions).toHaveBeenCalledWith(
      ownerUserId,
    );
  });

  it("does not show an older partial after a newer complete version", async () => {
    const repository = createRepository({
      listVersions: vi.fn<CaptureExceptionRepository["listVersions"]>(
        async () => [
          partial,
          {
            ...partial,
            captureSessionId: "20000000-0000-0000-0000-000000000002",
            captureStatus: "complete",
            createdAt: "2026-07-29T12:00:00.000Z",
            id: "30000000-0000-0000-0000-000000000002",
            missingElements: [],
            version: 2,
          },
        ],
      ),
    });

    await expect(
      listExceptionsWithRepository(repository, ownerUserId),
    ).resolves.toEqual([]);
  });

  it("combines real failed sessions and failed processing jobs", async () => {
    const repository = createRepository({
      listFailedCaptureSessions: vi.fn<
        CaptureExceptionRepository["listFailedCaptureSessions"]
      >(async () => [
        {
          captureId: "20000000-0000-0000-0000-000000000003",
          createdAt: "2026-07-29T14:00:00.000Z",
          externalRef: "conversation:test",
          failureReason: "capture session expired",
          source: "chatgpt_web",
          sourceItemId: null,
          title: "未完成会话",
        },
        {
          captureId: "20000000-0000-0000-0000-000000000004",
          createdAt: "2026-07-29T14:30:00.000Z",
          externalRef: "conversation:terminal",
          failureReason: "attachment verification failed",
          source: "chatgpt_web",
          sourceItemId: null,
          title: "无法证明已恢复的终止会话",
        },
      ]),
      listFailedProcessingJobs: vi.fn(async () => [
        {
          failureReason: "worker unavailable",
          sourceVersionId: partial.id,
          updatedAt: "2026-07-29T13:00:00.000Z",
        },
      ]),
    });

    const result = await listExceptionsWithRepository(
      repository,
      ownerUserId,
    );

    expect(result.map((entry) => entry.kind)).toEqual([
      "failed_capture",
      "failed_capture",
      "processing_failed",
      "partial_capture",
    ]);
    expect(result[0]).toMatchObject({ rawDataSafe: false });
    expect(result[1]).toMatchObject({ rawDataSafe: false });
    expect(result[2]).toMatchObject({ rawDataSafe: true });
    expect(result.map((entry) => entry.id)).toContain(
      "capture:20000000-0000-0000-0000-000000000004",
    );
  });

  it("keeps a manual recoverable session visible until that exact session changes status", async () => {
    const repository = createRepository({
      listFailedCaptureSessions: vi.fn<
        CaptureExceptionRepository["listFailedCaptureSessions"]
      >(async () => [
        {
          captureId: "20000000-0000-0000-0000-000000000005",
          createdAt: "2026-07-29T14:20:00.000Z",
          externalRef: null,
          failureReason: "capture session expired",
          source: "manual_text",
          sourceItemId: null,
          title: "没有持久 Outbox 的手动采集",
        },
      ]),
      listSourceItems: vi.fn(async () => []),
      listVersions: vi.fn(async () => []),
    });

    const result = await listExceptionsWithRepository(
      repository,
      ownerUserId,
    );

    expect(result).toEqual([
      expect.objectContaining({
        captureId: "20000000-0000-0000-0000-000000000005",
        kind: "failed_capture",
        source: "manual_text",
      }),
    ]);
  });

  it("marks non-ChatGPT partial recovery as an independent manual upload", async () => {
    const repository = createRepository({
      listSourceItems: vi.fn<CaptureExceptionRepository["listSourceItems"]>(
        async () => [
          { ...item, source: "manual_text", title: "手动资料" },
        ],
      ),
    });

    const result = await listExceptionsWithRepository(
      repository,
      ownerUserId,
    );

    expect(result).toEqual([
      expect.objectContaining({
        kind: "partial_capture",
        recovery: "independent_manual_screenshot",
      }),
    ]);
  });

  it("never invents an exception when every server query is empty", async () => {
    const repository = createRepository({
      listSourceItems: vi.fn(async () => []),
      listVersions: vi.fn(async () => []),
    });

    await expect(
      listExceptionsWithRepository(repository, ownerUserId),
    ).resolves.toEqual([]);
  });
});
