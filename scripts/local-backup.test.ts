import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  REQUIRED_BACKUP_TABLES,
  STORAGE_LIST_PAGE_SIZE,
  collectTableExportIntegrityErrors,
  hashCopyBody,
  listAllStorageEntries,
  parseCopyRows,
} from "./local-backup-lib.mjs";

describe("REQUIRED_BACKUP_TABLES", () => {
  it("covers Stage 0 through Stage 2C facts", () => {
    expect(REQUIRED_BACKUP_TABLES).toEqual(
      expect.arrayContaining([
        "spaces",
        "space_members",
        "source_items",
        "capture_sessions",
        "source_versions",
        "source_messages",
        "source_attachments",
        "source_blocks",
        "source_asset_links",
        "asset_ocr_results",
        "processing_jobs",
        "processing_runs",
        "knowledge_items",
        "knowledge_versions",
        "citations",
        "review_tasks",
      ]),
    );
  });
});

describe("listAllStorageEntries", () => {
  it("keeps listing a prefix until a page is smaller than the page size", async () => {
    const firstPage = Array.from({ length: STORAGE_LIST_PAGE_SIZE }, (_, index) => ({
      id: `obj-${index}`,
      name: `file-${index}.png`,
      metadata: { size: 12, mimetype: "image/png" },
    }));
    const secondPage = [
      { id: "obj-last", name: "file-last.png", metadata: { size: 24, mimetype: "image/png" } },
    ];
    const listPage = vi
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(secondPage);

    const objects = await listAllStorageEntries(listPage);
    expect(listPage).toHaveBeenNthCalledWith(1, "", {
      limit: STORAGE_LIST_PAGE_SIZE,
      offset: 0,
    });
    expect(listPage).toHaveBeenNthCalledWith(2, "", {
      limit: STORAGE_LIST_PAGE_SIZE,
      offset: STORAGE_LIST_PAGE_SIZE,
    });
    expect(objects).toHaveLength(STORAGE_LIST_PAGE_SIZE + 1);
    expect(objects.at(-1)).toMatchObject({
      storagePath: "file-last.png",
      bytes: 24,
    });
  });
});

describe("parseCopyRows and hashCopyBody", () => {
  it("treats an empty COPY followed by another table as zero rows", () => {
    const dump = [
      "COPY public.spaces (id) FROM stdin;",
      "\\.",
      "",
      "COPY public.source_items (id, title) FROM stdin;",
      "10000000-0000-0000-0000-000000000001\tnote-a",
      "\\.",
      "",
    ].join("\n");
    expect(parseCopyRows(dump, "spaces")).toMatchObject({ rows: [], body: "" });
    expect(parseCopyRows(dump, "source_items").rows).toHaveLength(1);
  });

  it("parses quoted pg_dump identifiers used by supabase db dump", () => {
    const dump = [
      'COPY "public"."spaces" ("id", "name") FROM stdin;',
      "aaaaaaaa-0000-0000-0000-000000000001\tPersonal",
      "\\.",
      "",
      'COPY "public"."source_attachments" ("id", "storage_path") FROM stdin;',
      "bbbbbbbb-0000-0000-0000-000000000001\tuser/file.png",
      "\\.",
      "",
    ].join("\n");
    const spaces = parseCopyRows(dump, "spaces");
    expect(spaces.columns).toEqual(["id", "name"]);
    expect(spaces.rows).toHaveLength(1);
    const attachments = parseCopyRows(dump, "source_attachments");
    expect(attachments.columns.indexOf("storage_path")).toBe(1);
    expect(attachments.rows[0][1]).toBe("user/file.png");
  });

  it("hashes exported table rows independently of surrounding dump SQL", () => {
    const dump = [
      "COPY public.source_items (id, title) FROM stdin;",
      "10000000-0000-0000-0000-000000000001\tnote-a",
      "10000000-0000-0000-0000-000000000002\tnote-b",
      "\\.",
      "",
    ].join("\n");
    const parsed = parseCopyRows(dump, "source_items");
    expect(parsed.rows).toHaveLength(2);
    expect(hashCopyBody(parsed.body)).toBe(createHash("sha256").update(parsed.body).digest("hex"));
  });
});

describe("collectTableExportIntegrityErrors", () => {
  it("rejects missing Stage 2C tables and dump hashes that do not match", () => {
    const dump = [
      "COPY public.source_items (id, title) FROM stdin;",
      "10000000-0000-0000-0000-000000000001\tnote-a",
      "\\.",
      "",
    ].join("\n");

    expect(
      collectTableExportIntegrityErrors(
        {
          tableRowCounts: { "public.source_items": 1 },
          tableExports: {
            "public.source_items": {
              rowCount: 1,
              sha256: "a".repeat(64),
              exportPath: "tables/source_items.copy",
            },
          },
        },
        dump,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/tableRowCounts missing public\.spaces/),
        expect.stringMatching(/tableExports missing public\.asset_ocr_results/),
        expect.stringMatching(/source_items export SHA-256 does not match dump COPY body/),
      ]),
    );
  });

  it("accepts matching row counts and COPY hashes for every required table", () => {
    const sections = REQUIRED_BACKUP_TABLES.map(
      (table) => `COPY public.${table} (id) FROM stdin;\n\\.\n`,
    );
    const dump = sections.join("\n");
    const emptyHash = hashCopyBody("");
    const tableRowCounts = Object.fromEntries(
      REQUIRED_BACKUP_TABLES.map((table) => [`public.${table}`, 0]),
    );
    const tableExports = Object.fromEntries(
      REQUIRED_BACKUP_TABLES.map((table) => [
        `public.${table}`,
        {
          rowCount: 0,
          sha256: emptyHash,
          exportPath: `tables/${table}.copy`,
        },
      ]),
    );

    expect(collectTableExportIntegrityErrors({ tableRowCounts, tableExports }, dump)).toEqual([]);
  });
});
