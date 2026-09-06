import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";

const SECRET_PATTERNS = [
  /SUPABASE_SERVICE_ROLE_KEY/,
  /[?&](?:token|sig)=/i,
  /Bearer\s+\S+/i,
];

/**
 * @param {string} relativePath
 * @returns {string}
 */
export function assertSafeRelativePath(relativePath) {
  if (typeof relativePath !== "string" || relativePath.trim() === "") {
    throw new Error("Backup path must be a non-empty relative path");
  }

  const raw = relativePath.trim();
  const unified = raw.replaceAll("\\", "/");

  if (path.win32.isAbsolute(raw) || path.posix.isAbsolute(unified)) {
    throw new Error("Backup path must be relative");
  }

  const segments = unified.split("/").filter((segment) => segment.length > 0 && segment !== ".");
  if (segments.length === 0) {
    throw new Error("Backup path must be a non-empty relative path");
  }
  if (segments.some((segment) => segment === "..")) {
    throw new Error("Backup path must not contain parent segments");
  }

  return segments.join("/");
}

/**
 * @param {string} filePath
 * @returns {Promise<string>}
 */
export function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => {
      hash.update(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => {
      resolve(hash.digest("hex"));
    });
  });
}

/**
 * @param {unknown} value
 * @returns {void}
 */
function assertNoSecrets(value) {
  const serialized = JSON.stringify(value);
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(serialized)) {
      throw new Error("Backup manifest must not contain secrets, signed URLs, or bearer tokens");
    }
  }
}

/**
 * @typedef {{
 *   relativePath: string,
 *   sha256: string,
 *   bytes: number,
 *   role: "schema" | "data" | "storage-object",
 *   contentType?: string,
 *   storagePath?: string,
 * }} BackupFileEntry
 *
 * @typedef {{
 *   createdAt: string,
 *   cliVersion: string,
 *   appVersion: string,
 *   tableRowCounts: Record<string, number>,
 *   files: BackupFileEntry[],
 * }} BackupManifestInput
 */

/**
 * @param {BackupManifestInput} input
 */
export function buildBackupManifest(input) {
  assertNoSecrets(input);

  if (!input || typeof input.createdAt !== "string" || input.createdAt.length === 0) {
    throw new Error("Backup manifest requires createdAt");
  }
  if (typeof input.cliVersion !== "string" || input.cliVersion.length === 0) {
    throw new Error("Backup manifest requires cliVersion");
  }
  if (typeof input.appVersion !== "string" || input.appVersion.length === 0) {
    throw new Error("Backup manifest requires appVersion");
  }
  if (!input.tableRowCounts || typeof input.tableRowCounts !== "object") {
    throw new Error("Backup manifest requires tableRowCounts");
  }
  if (!Array.isArray(input.files)) {
    throw new Error("Backup manifest requires files");
  }

  const files = input.files.map((file) => {
    if (!/^[a-f0-9]{64}$/.test(file.sha256)) {
      throw new Error("Backup file hash must be a SHA-256 hex digest");
    }
    if (!Number.isInteger(file.bytes) || file.bytes < 0) {
      throw new Error("Backup file bytes must be a non-negative integer");
    }
    if (file.role !== "schema" && file.role !== "data" && file.role !== "storage-object") {
      throw new Error("Backup file role is invalid");
    }

    /** @type {BackupFileEntry} */
    const entry = {
      relativePath: assertSafeRelativePath(file.relativePath),
      sha256: file.sha256,
      bytes: file.bytes,
      role: file.role,
    };
    if (file.contentType !== undefined) {
      entry.contentType = file.contentType;
    }
    if (file.storagePath !== undefined) {
      entry.storagePath = file.storagePath;
    }
    return entry;
  });

  const manifest = {
    formatVersion: 1,
    createdAt: input.createdAt,
    cliVersion: input.cliVersion,
    appVersion: input.appVersion,
    tableRowCounts: { ...input.tableRowCounts },
    files,
    storageObjects: files
      .filter((file) => file.role === "storage-object")
      .map((file) => ({
        relativePath: file.relativePath,
        sha256: file.sha256,
        bytes: file.bytes,
        ...(file.contentType !== undefined ? { contentType: file.contentType } : {}),
        ...(file.storagePath !== undefined ? { storagePath: file.storagePath } : {}),
      })),
  };

  assertNoSecrets(manifest);
  return manifest;
}
