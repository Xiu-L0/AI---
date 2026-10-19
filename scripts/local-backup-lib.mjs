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

export const STORAGE_LIST_PAGE_SIZE = 1000;

export const REQUIRED_BACKUP_TABLES = Object.freeze([
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
]);

export const OPTIONAL_BACKUP_TABLES = Object.freeze(["extension_tokens"]);

const FILE_ROLES = new Set(["schema", "data", "storage-object", "table-export"]);

/**
 * @param {string} body
 * @returns {string}
 */
export function hashCopyBody(body) {
  return createHash("sha256").update(body ?? "").digest("hex");
}

/**
 * @param {string} sql
 * @param {string} tableName
 * @param {string} [schema]
 * @returns {{ columns: string[], rows: string[][], body: string }}
 */
function findCopyMarker(sql, tableName, schema) {
  const candidates = [
    `COPY "${schema}"."${tableName}" (`,
    `COPY ${schema}.${tableName} (`,
    `COPY ${schema}."${tableName}" (`,
  ];
  for (const marker of candidates) {
    const start = sql.indexOf(marker);
    if (start !== -1) {
      return { marker, start };
    }
  }
  return null;
}

function unquoteIdent(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replaceAll('""', '"');
  }
  return trimmed;
}

export function parseCopyRows(sql, tableName, schema = "public") {
  if (typeof sql !== "string" || typeof tableName !== "string") {
    return { columns: [], rows: [], body: "" };
  }

  const found = findCopyMarker(sql, tableName, schema);
  if (!found) {
    return { columns: [], rows: [], body: "" };
  }
  const { marker, start } = found;
  const headerEnd = sql.indexOf(") FROM stdin;", start);
  if (headerEnd === -1) {
    return { columns: [], rows: [], body: "" };
  }
  const columns = sql
    .slice(start + marker.length, headerEnd)
    .split(",")
    .map((column) => unquoteIdent(column));
  const afterHeader = sql.slice(headerEnd + ") FROM stdin;".length);
  const newline = afterHeader.startsWith("\r\n") ? "\r\n" : "\n";
  const rowsStart = headerEnd + ") FROM stdin;".length + newline.length;
  if (sql.startsWith("\\.", rowsStart)) {
    return { columns, rows: [], body: "" };
  }
  const terminator = `${newline}\\.${newline}`;
  let rowsEnd = sql.indexOf(terminator, rowsStart);
  if (rowsEnd === -1) {
    rowsEnd = sql.indexOf("\n\\.\n", rowsStart);
  }
  if (rowsEnd === -1) {
    return { columns, rows: [], body: "" };
  }
  const body = sql.slice(rowsStart, rowsEnd).replaceAll("\r\n", "\n");
  const rows = body
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => line.split("\t"));
  return { columns, rows, body };
}

/**
 * @param {(prefix: string, options: { limit: number, offset: number }) => Promise<unknown[] | null | undefined>} listPage
 * @param {string} [prefix]
 * @returns {Promise<{ storagePath: string, bytes: number, contentType?: string }[]>}
 */
export async function listAllStorageEntries(listPage, prefix = "") {
  const objects = [];
  let offset = 0;
  for (;;) {
    const page = (await listPage(prefix, { limit: STORAGE_LIST_PAGE_SIZE, offset })) ?? [];
    for (const entry of page) {
      const name = typeof entry?.name === "string" ? entry.name : "";
      const nextPrefix = prefix ? `${prefix}/${name}` : name;
      const isFolder = entry?.id === null || entry?.metadata == null;
      if (isFolder) {
        objects.push(...(await listAllStorageEntries(listPage, nextPrefix)));
        continue;
      }
      objects.push({
        storagePath: nextPrefix,
        bytes: Number(entry?.metadata?.size ?? 0),
        ...(typeof entry?.metadata?.mimetype === "string" ? { contentType: entry.metadata.mimetype } : {}),
      });
    }
    if (page.length < STORAGE_LIST_PAGE_SIZE) {
      break;
    }
    offset += STORAGE_LIST_PAGE_SIZE;
  }
  return objects;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} manifest
 * @param {string} dataSql
 * @returns {string[]}
 */
export function collectTableExportIntegrityErrors(manifest, dataSql) {
  const errors = [];
  if (!isPlainObject(manifest)) {
    return ["manifest.json must be a JSON object"];
  }
  if (!isPlainObject(manifest.tableRowCounts)) {
    errors.push("manifest.json tableRowCounts must be an object");
  }
  if (!isPlainObject(manifest.tableExports)) {
    errors.push("manifest.json tableExports must be an object");
    return errors;
  }

  for (const table of REQUIRED_BACKUP_TABLES) {
    const key = `public.${table}`;
    const counted = manifest.tableRowCounts?.[key];
    const exported = manifest.tableExports[key];
    if (!Number.isInteger(counted) || counted < 0) {
      errors.push(`manifest.json tableRowCounts missing ${key}`);
    }
    if (!isPlainObject(exported)) {
      errors.push(`manifest.json tableExports missing ${key}`);
      continue;
    }
    const parsed = parseCopyRows(typeof dataSql === "string" ? dataSql : "", table);
    if (exported.rowCount !== parsed.rows.length) {
      errors.push(`${key} export row count ${exported.rowCount} does not match dump ${parsed.rows.length}`);
    }
    if (Number.isInteger(counted) && exported.rowCount !== counted) {
      errors.push(`${key} export row count ${exported.rowCount} does not match tableRowCounts ${counted}`);
    }
    const expectedHash = hashCopyBody(parsed.body);
    if (exported.sha256 !== expectedHash) {
      errors.push(`${key} export SHA-256 does not match dump COPY body`);
    }
    if (exported.exportPath !== `tables/${table}.copy`) {
      errors.push(`${key} exportPath must be tables/${table}.copy`);
    }
  }

  return errors;
}

/**
 * @typedef {{
 *   relativePath: string,
 *   sha256: string,
 *   bytes: number,
 *   role: "schema" | "data" | "storage-object" | "table-export",
 *   contentType?: string,
 *   storagePath?: string,
 * }} BackupFileEntry
 *
 * @typedef {{
 *   rowCount: number,
 *   sha256: string,
 *   exportPath: string,
 * }} BackupTableExport
 *
 * @typedef {{
 *   createdAt: string,
 *   cliVersion: string,
 *   appVersion: string,
 *   tableRowCounts: Record<string, number>,
 *   tableExports?: Record<string, BackupTableExport>,
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
  if (input.tableExports !== undefined && (!input.tableExports || typeof input.tableExports !== "object")) {
    throw new Error("Backup manifest tableExports must be an object");
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
    if (!FILE_ROLES.has(file.role)) {
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

  const tableExports = {};
  for (const [table, exported] of Object.entries(input.tableExports ?? {})) {
    if (!exported || typeof exported !== "object") {
      throw new Error(`Backup tableExports.${table} must be an object`);
    }
    if (!Number.isInteger(exported.rowCount) || exported.rowCount < 0) {
      throw new Error(`Backup tableExports.${table}.rowCount must be a non-negative integer`);
    }
    if (!/^[a-f0-9]{64}$/.test(exported.sha256 ?? "")) {
      throw new Error(`Backup tableExports.${table}.sha256 must be a SHA-256 hex digest`);
    }
    tableExports[table] = {
      rowCount: exported.rowCount,
      sha256: exported.sha256,
      exportPath: assertSafeRelativePath(exported.exportPath),
    };
  }

  const manifest = {
    formatVersion: 1,
    createdAt: input.createdAt,
    cliVersion: input.cliVersion,
    appVersion: input.appVersion,
    tableRowCounts: { ...input.tableRowCounts },
    tableExports,
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
