import { describe, expect, it } from "vitest";

import {
  createAttachmentStore,
  type AttachmentPersistence,
  type AttachmentRecord,
} from "./attachment-store";

class MemoryAttachmentPersistence implements AttachmentPersistence {
  readonly records = new Map<string, AttachmentRecord>();

  async delete(blobKey: string) {
    this.records.delete(blobKey);
  }

  async get(blobKey: string) {
    return this.records.get(blobKey) ?? null;
  }

  async list() {
    return [...this.records.values()];
  }

  async put(record: AttachmentRecord) {
    this.records.set(record.blobKey, record);
  }
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)), {
      once: true,
    });
    reader.addEventListener("error", () => reject(reader.error), { once: true });
    reader.readAsText(blob);
  });
}

describe("attachment store", () => {
  it("keeps a Blob readable from a new store instance", async () => {
    const persistence = new MemoryAttachmentPersistence();
    const first = createAttachmentStore({
      now: () => new Date("2026-07-30T10:00:00.000Z"),
      persistence,
    });

    await first.putAttachment("blob-1", new Blob(["saved bytes"], {
      type: "text/plain",
    }));

    const reopened = createAttachmentStore({ persistence });
    const stored = await reopened.getAttachment("blob-1");
    expect(stored?.type).toBe("text/plain");
    expect(stored && (await readBlob(stored))).toBe("saved bytes");
    expect(await reopened.listAttachmentMetadata()).toEqual([
      {
        blobKey: "blob-1",
        byteSize: 11,
        createdAt: "2026-07-30T10:00:00.000Z",
        mimeType: "text/plain",
      },
    ]);
  });

  it("deletes an attachment explicitly", async () => {
    const persistence = new MemoryAttachmentPersistence();
    const store = createAttachmentStore({ persistence });
    await store.putAttachment("blob-1", new Blob(["one"]));

    await store.deleteAttachment("blob-1");

    expect(await store.getAttachment("blob-1")).toBeNull();
  });

  it("deletes only old unreferenced orphan Blobs", async () => {
    const persistence = new MemoryAttachmentPersistence();
    const oldStore = createAttachmentStore({
      now: () => new Date("2026-07-01T00:00:00.000Z"),
      persistence,
    });
    await oldStore.putAttachment("referenced", new Blob(["keep"]));
    await oldStore.putAttachment("orphan", new Blob(["delete"]));
    const recentStore = createAttachmentStore({
      now: () => new Date("2026-07-29T00:00:00.000Z"),
      persistence,
    });
    await recentStore.putAttachment("recent-orphan", new Blob(["keep"]));

    const deleted = await recentStore.deleteOrphanedAttachments(
      new Set(["referenced"]),
      new Date("2026-07-23T00:00:00.000Z"),
    );

    expect(deleted).toEqual(["orphan"]);
    expect(await recentStore.getAttachment("referenced")).not.toBeNull();
    expect(await recentStore.getAttachment("recent-orphan")).not.toBeNull();
    expect(await recentStore.getAttachment("orphan")).toBeNull();
  });
});
