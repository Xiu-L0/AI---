import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertSafeRelativePath,
  buildBackupManifest,
  sha256File,
} from "./local-backup-lib.mjs";

const FIXTURE_A = "backup-fixture-alpha";
const FIXTURE_B = "backup-fixture-beta";
const EXPECTED_A = createHash("sha256").update(FIXTURE_A).digest("hex");
const EXPECTED_B = createHash("sha256").update(FIXTURE_B).digest("hex");

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

async function createFixtureDir() {
  const dir = await mkdtemp(path.join(tmpdir(), "recall-backup-"));
  tempDirs.push(dir);
  return dir;
}

describe("assertSafeRelativePath", () => {
  it("accepts a nested storage object path", () => {
    expect(assertSafeRelativePath("storage/raw-captures/user/file.png")).toBe(
      "storage/raw-captures/user/file.png",
    );
  });

  it("rejects empty, absolute, and parent-traversal paths", () => {
    expect(() => assertSafeRelativePath("")).toThrow(/relative path/i);
    expect(() => assertSafeRelativePath("/etc/passwd")).toThrow(/relative/i);
    expect(() => assertSafeRelativePath("C:\\Users\\file.png")).toThrow(/relative/i);
    expect(() => assertSafeRelativePath("storage/../secret.txt")).toThrow(/parent/i);
    expect(() => assertSafeRelativePath("..\\windows\\system32")).toThrow(/parent/i);
  });
});

describe("sha256File", () => {
  it("returns deterministic SHA-256 values for two fixture files", async () => {
    const dir = await createFixtureDir();
    const fileA = path.join(dir, "a.bin");
    const fileB = path.join(dir, "b.bin");
    await writeFile(fileA, FIXTURE_A);
    await writeFile(fileB, FIXTURE_B);

    expect(await sha256File(fileA)).toBe(EXPECTED_A);
    expect(await sha256File(fileB)).toBe(EXPECTED_B);
    expect(await sha256File(fileA)).toBe(EXPECTED_A);
  });
});

describe("buildBackupManifest", () => {
  it("includes version, timestamps, table counts, storage metadata, and file hashes", () => {
    const manifest = buildBackupManifest({
      createdAt: "2026-08-12T03:15:00.000Z",
      cliVersion: "2.110.0",
      appVersion: "0.1.0",
      tableRowCounts: {
        "auth.users": 1,
        "public.source_items": 4,
      },
      files: [
        {
          relativePath: "schema.sql",
          sha256: "a".repeat(64),
          bytes: 128,
          role: "schema",
        },
        {
          relativePath: "data.sql",
          sha256: "b".repeat(64),
          bytes: 256,
          role: "data",
        },
        {
          relativePath: "storage/raw-captures/user/file.png",
          sha256: "c".repeat(64),
          bytes: 512,
          role: "storage-object",
          contentType: "image/png",
          storagePath: "user/file.png",
        },
      ],
    });

    expect(manifest.formatVersion).toBe(1);
    expect(manifest.createdAt).toBe("2026-08-12T03:15:00.000Z");
    expect(manifest.cliVersion).toBe("2.110.0");
    expect(manifest.appVersion).toBe("0.1.0");
    expect(manifest.tableRowCounts).toEqual({
      "auth.users": 1,
      "public.source_items": 4,
    });
    expect(manifest.files).toEqual([
      {
        relativePath: "schema.sql",
        sha256: "a".repeat(64),
        bytes: 128,
        role: "schema",
      },
      {
        relativePath: "data.sql",
        sha256: "b".repeat(64),
        bytes: 256,
        role: "data",
      },
      {
        relativePath: "storage/raw-captures/user/file.png",
        sha256: "c".repeat(64),
        bytes: 512,
        role: "storage-object",
        contentType: "image/png",
        storagePath: "user/file.png",
      },
    ]);
    expect(manifest.storageObjects).toEqual([
      {
        relativePath: "storage/raw-captures/user/file.png",
        sha256: "c".repeat(64),
        bytes: 512,
        contentType: "image/png",
        storagePath: "user/file.png",
      },
    ]);
  });

  it("never contains the service-role key name, signed URLs, or bearer tokens", () => {
    const manifest = buildBackupManifest({
      createdAt: "2026-08-12T03:15:00.000Z",
      cliVersion: "2.110.0",
      appVersion: "0.1.0",
      tableRowCounts: { "auth.users": 1 },
      files: [
        {
          relativePath: "schema.sql",
          sha256: "d".repeat(64),
          bytes: 10,
          role: "schema",
        },
      ],
    });
    const serialized = JSON.stringify(manifest);

    expect(serialized).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(serialized).not.toMatch(/[?&](?:token|sig)=/i);
    expect(serialized).not.toMatch(/Bearer\s+/i);
  });

  it("rejects input that would embed a signed URL or bearer token", () => {
    expect(() =>
      buildBackupManifest({
        createdAt: "2026-08-12T03:15:00.000Z",
        cliVersion: "2.110.0",
        appVersion: "0.1.0",
        tableRowCounts: { "auth.users": 1 },
        files: [
          {
            relativePath: "schema.sql",
            sha256: "e".repeat(64),
            bytes: 10,
            role: "schema",
            contentType: "https://example.supabase.co/storage/v1/object/sign/raw-captures/a?token=abc",
          },
        ],
      }),
    ).toThrow(/signed URL|secret|token/i);

    expect(() =>
      buildBackupManifest({
        createdAt: "2026-08-12T03:15:00.000Z",
        cliVersion: "Bearer leaked",
        appVersion: "0.1.0",
        tableRowCounts: { "auth.users": 1 },
        files: [
          {
            relativePath: "schema.sql",
            sha256: "f".repeat(64),
            bytes: 10,
            role: "schema",
          },
        ],
      }),
    ).toThrow(/Bearer|secret|token/i);
  });
});
