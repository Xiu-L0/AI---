import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertSafeRelativePath, sha256File } from "./local-backup-lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BACKUPS_ROOT = path.join(REPO_ROOT, "backups");
const FILE_ROLES = new Set(["schema", "data", "storage-object"]);
const SECRET_PATTERNS = [
  { name: "signed URL query", pattern: /[?&](?:token|sig)=/i },
  { name: "bearer token", pattern: /Bearer\s+\S+/i },
  { name: "service-role key name", pattern: /SUPABASE_SERVICE_ROLE_KEY/ },
];
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

function usage() {
  return "Usage: pnpm backup:verify -- backups/<timestamp>";
}

function addError(errors, message) {
  errors.push(message);
}

function resolveBackupDir(rawPath) {
  if (typeof rawPath !== "string" || rawPath.trim() === "") {
    throw new Error(usage());
  }

  const resolved = path.resolve(REPO_ROOT, rawPath.trim());
  const relative = path.relative(BACKUPS_ROOT, resolved);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Backup directory must be inside ${path.relative(REPO_ROOT, BACKUPS_ROOT)}/`);
  }
  return resolved;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateManifestSchema(manifest, errors) {
  if (!isPlainObject(manifest)) {
    addError(errors, "manifest.json must be a JSON object");
    return;
  }
  if (manifest.formatVersion !== 1) {
    addError(errors, "manifest.json formatVersion must equal 1");
  }
  if (typeof manifest.createdAt !== "string" || Number.isNaN(Date.parse(manifest.createdAt))) {
    addError(errors, "manifest.json createdAt must be an ISO timestamp");
  }
  if (typeof manifest.cliVersion !== "string" || manifest.cliVersion.length === 0) {
    addError(errors, "manifest.json cliVersion is missing");
  }
  if (typeof manifest.appVersion !== "string" || manifest.appVersion.length === 0) {
    addError(errors, "manifest.json appVersion is missing");
  }
  if (!isPlainObject(manifest.tableRowCounts)) {
    addError(errors, "manifest.json tableRowCounts must be an object");
  } else {
    for (const [table, count] of Object.entries(manifest.tableRowCounts)) {
      if (!Number.isInteger(count) || count < 0) {
        addError(errors, `manifest.json tableRowCounts.${table} must be a non-negative integer`);
      }
    }
  }
  if (!Array.isArray(manifest.files)) {
    addError(errors, "manifest.json files must be an array");
  }
  if (!Array.isArray(manifest.storageObjects)) {
    addError(errors, "manifest.json storageObjects must be an array");
  }
}

function validateFileEntry(file, index, errors) {
  if (!isPlainObject(file)) {
    addError(errors, `manifest.json files[${index}] must be an object`);
    return null;
  }
  try {
    file.relativePath = assertSafeRelativePath(file.relativePath);
  } catch (error) {
    addError(errors, `manifest.json files[${index}].relativePath is unsafe: ${error.message}`);
    return null;
  }
  if (!/^[a-f0-9]{64}$/.test(file.sha256 ?? "")) {
    addError(errors, `manifest.json files[${index}].sha256 must be a SHA-256 hex digest`);
  }
  if (!Number.isInteger(file.bytes) || file.bytes < 0) {
    addError(errors, `manifest.json files[${index}].bytes must be a non-negative integer`);
  }
  if (!FILE_ROLES.has(file.role)) {
    addError(errors, `manifest.json files[${index}].role is invalid`);
  }
  return file;
}

async function verifyListedFiles(backupDir, files, errors) {
  let totalBytes = 0;
  for (const [index, rawFile] of files.entries()) {
    const file = validateFileEntry(rawFile, index, errors);
    if (!file?.relativePath) {
      continue;
    }
    const absolute = path.join(backupDir, ...file.relativePath.split("/"));
    try {
      const info = await stat(absolute);
      if (info.size !== file.bytes) {
        addError(errors, `${file.relativePath} size ${info.size} does not match manifest ${file.bytes}`);
      }
      const digest = await sha256File(absolute);
      if (digest !== file.sha256) {
        addError(errors, `${file.relativePath} SHA-256 does not match the manifest`);
      }
      totalBytes += info.size;
    } catch {
      addError(errors, `${file.relativePath} is listed in the manifest but missing on disk`);
    }
  }
  return totalBytes;
}

function collectStoragePaths(manifest) {
  const fromObjects = (manifest.storageObjects ?? [])
    .map((object) => object?.storagePath)
    .filter((value) => typeof value === "string" && value.length > 0);
  const fromFiles = (manifest.files ?? [])
    .filter((file) => file?.role === "storage-object")
    .map((file) => file.storagePath)
    .filter((value) => typeof value === "string" && value.length > 0);
  return new Set([...fromObjects, ...fromFiles]);
}

function parseCopyRows(sql, tableName) {
  const marker = `COPY public.${tableName} (`;
  const start = sql.indexOf(marker);
  if (start === -1) {
    return { columns: [], rows: [] };
  }
  const headerEnd = sql.indexOf(") FROM stdin;", start);
  if (headerEnd === -1) {
    return { columns: [], rows: [] };
  }
  const columns = sql
    .slice(start + marker.length, headerEnd)
    .split(",")
    .map((column) => column.trim());
  const rowsStart = headerEnd + ") FROM stdin;\n".length;
  const rowsEnd = sql.indexOf("\n\\.\n", rowsStart);
  if (rowsEnd === -1) {
    return { columns, rows: [] };
  }
  const body = sql.slice(rowsStart, rowsEnd);
  const rows = body
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => line.split("\t"));
  return { columns, rows };
}

function attachmentStoragePathsFromDump(sql) {
  const { columns, rows } = parseCopyRows(sql, "source_attachments");
  const index = columns.indexOf("storage_path");
  if (index === -1) {
    return [];
  }
  return rows
    .map((row) => row[index])
    .filter((value) => typeof value === "string" && value !== "\\N" && value.length > 0);
}

function decodeJwtPayload(token) {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  try {
    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function scanSecrets(label, text, errors) {
  for (const { name, pattern } of SECRET_PATTERNS) {
    if (pattern.test(text)) {
      addError(errors, `${label} contains a ${name}`);
    }
  }
  for (const token of text.match(JWT_PATTERN) ?? []) {
    const payload = decodeJwtPayload(token);
    if (payload?.role === "service_role") {
      addError(errors, `${label} contains a service-role JWT`);
    }
  }
}

async function readOptional(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function main() {
  const errors = [];
  let backupDir;

  try {
    backupDir = resolveBackupDir(process.argv[2]);
  } catch (error) {
    failAndExit([error instanceof Error ? error.message : String(error)]);
    return;
  }

  const manifestPath = path.join(backupDir, "manifest.json");
  let manifestText;
  try {
    manifestText = await readFile(manifestPath, "utf8");
  } catch {
    failAndExit([`manifest.json is missing in ${path.relative(REPO_ROOT, backupDir)}`]);
    return;
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    failAndExit(["manifest.json is not valid JSON"]);
    return;
  }

  validateManifestSchema(manifest, errors);
  scanSecrets("manifest.json", manifestText, errors);

  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const totalBytes = await verifyListedFiles(backupDir, files, errors);

  const schemaSql = await readOptional(path.join(backupDir, "schema.sql"));
  const dataSql = await readOptional(path.join(backupDir, "data.sql"));
  if (schemaSql === null) {
    addError(errors, "schema.sql is missing");
  } else {
    scanSecrets("schema.sql", schemaSql, errors);
  }
  if (dataSql === null) {
    addError(errors, "data.sql is missing");
  } else {
    scanSecrets("data.sql", dataSql, errors);
    const requiredPaths = attachmentStoragePathsFromDump(dataSql);
    const presentPaths = collectStoragePaths(manifest);
    for (const storagePath of requiredPaths) {
      if (!presentPaths.has(storagePath)) {
        addError(errors, `source_attachments.storage_path ${storagePath} has no downloaded object in the manifest`);
      }
    }
  }

  if (errors.length > 0) {
    failAndExit(errors);
    return;
  }

  const tableCount = Object.keys(manifest.tableRowCounts ?? {}).length;
  const storageObjectCount = (manifest.storageObjects ?? []).length;
  console.log(
    [
      `Backup timestamp: ${manifest.createdAt}`,
      `Tables recorded: ${tableCount}`,
      `Storage objects: ${storageObjectCount}`,
      `Total bytes: ${totalBytes}`,
      "Verification: pass",
    ].join("\n"),
  );
}

function failAndExit(errors) {
  for (const error of errors) {
    console.error(error);
  }
  process.exitCode = 1;
}

await main();
