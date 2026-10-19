import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import {
  OPTIONAL_BACKUP_TABLES,
  REQUIRED_BACKUP_TABLES,
  STORAGE_LIST_PAGE_SIZE,
  assertSafeRelativePath,
  buildBackupManifest,
  hashCopyBody,
  listAllStorageEntries,
  parseCopyRows,
  sha256File,
} from "./local-backup-lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BACKUPS_ROOT = path.join(REPO_ROOT, "backups");
const STORAGE_BUCKET = "raw-captures";
const BUSINESS_TABLES = [...REQUIRED_BACKUP_TABLES, ...OPTIONAL_BACKUP_TABLES];

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function isLoopbackHostname(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]" || hostname === "::1";
}

function resolveLocalSupabaseUrl() {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  if (!raw) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL is required");
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Supabase URL must be a valid http(s) URL");
  }

  if (!isLoopbackHostname(parsed.hostname)) {
    throw new Error("Local backup only runs against a loopback Supabase URL");
  }

  return `${parsed.protocol}//${parsed.host}`;
}

function requireServiceRoleKey() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (typeof key !== "string" || key.trim() === "") {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY must be present in the process environment");
  }
  return key.trim();
}

function utcTimestamp(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, "-").replace(/-(\d{3})Z$/, "Z");
}

function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed (${code}): ${stderr.trim() || stdout.trim()}`));
    });
  });
}

function pnpmBin() {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(REPO_ROOT, relativePath), "utf8"));
}

async function resolveVersions() {
  const rootPackage = await readJson("package.json");
  const webPackage = await readJson("apps/web/package.json");
  let cliVersion = String(rootPackage.devDependencies?.supabase ?? "unknown").replace(/^\^/, "");
  try {
    const { stdout } = await runCommand(pnpmBin(), ["supabase", "--version"], REPO_ROOT);
    const match = stdout.match(/\d+\.\d+\.\d+/);
    if (match) {
      cliVersion = match[0];
    }
  } catch {
    // Keep the package.json pin when the CLI is unavailable during version probing.
  }
  return {
    appVersion: String(webPackage.version ?? "0.0.0"),
    cliVersion,
  };
}

async function countTable(client, table) {
  const { count, error } = await client.from(table).select("*", { count: "exact", head: true });
  if (error) {
    throw new Error(`Failed to count ${table}: ${error.message}`);
  }
  return count ?? 0;
}

async function countAuthUsers(client) {
  let page = 1;
  let total = 0;
  for (;;) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) {
      throw new Error(`Failed to count auth.users: ${error.message}`);
    }
    const users = data?.users ?? [];
    total += users.length;
    if (users.length < 1000) {
      return total;
    }
    page += 1;
  }
}

async function listStorageObjects(client) {
  return listAllStorageEntries(async (prefix, options) => {
    const { data, error } = await client.storage.from(STORAGE_BUCKET).list(prefix, {
      limit: options.limit ?? STORAGE_LIST_PAGE_SIZE,
      offset: options.offset ?? 0,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) {
      throw new Error(`Failed to list ${STORAGE_BUCKET}/${prefix}: ${error.message}`);
    }
    return data ?? [];
  });
}

async function downloadStorageObjects(client, backupDir) {
  const objects = await listStorageObjects(client);
  /** @type {import("./local-backup-lib.mjs").BackupFileEntry[]} */
  const files = [];

  for (const object of objects) {
    const relativePath = assertSafeRelativePath(`storage/${STORAGE_BUCKET}/${object.storagePath}`);
    const destination = path.join(backupDir, ...relativePath.split("/"));
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });

    const { data, error } = await client.storage.from(STORAGE_BUCKET).download(object.storagePath);
    if (error || !data) {
      throw new Error(`Failed to download ${object.storagePath}: ${error?.message ?? "empty object"}`);
    }

    const bytes = Buffer.from(await data.arrayBuffer());
    await writeFile(destination, bytes);
    const info = await stat(destination);
    files.push({
      relativePath,
      sha256: await sha256File(destination),
      bytes: info.size,
      role: "storage-object",
      ...(object.contentType ? { contentType: object.contentType } : {}),
      storagePath: object.storagePath,
    });
  }

  return files;
}

async function dumpDatabase(backupDir) {
  const schemaFile = path.join(backupDir, "schema.sql");
  const dataFile = path.join(backupDir, "data.sql");
  await runCommand(
    pnpmBin(),
    ["supabase", "db", "dump", "--local", "--schema", "public,auth,storage", "--file", schemaFile],
    REPO_ROOT,
  );
  await runCommand(
    pnpmBin(),
    [
      "supabase",
      "db",
      "dump",
      "--local",
      "--schema",
      "public,auth,storage",
      "--data-only",
      "--use-copy",
      "--file",
      dataFile,
    ],
    REPO_ROOT,
  );
}

async function hashedSqlFiles(backupDir) {
  const files = [];
  for (const [relativePath, role] of [
    ["schema.sql", "schema"],
    ["data.sql", "data"],
  ]) {
    const absolute = path.join(backupDir, relativePath);
    const info = await stat(absolute);
    files.push({
      relativePath,
      sha256: await sha256File(absolute),
      bytes: info.size,
      role,
    });
  }
  return files;
}

async function exportTableCopies(backupDir, dataSql) {
  await mkdir(path.join(backupDir, "tables"), { recursive: true, mode: 0o700 });
  /** @type {import("./local-backup-lib.mjs").BackupFileEntry[]} */
  const files = [];
  /** @type {Record<string, { rowCount: number, sha256: string, exportPath: string }>} */
  const tableExports = {};

  for (const table of BUSINESS_TABLES) {
    const parsed = parseCopyRows(dataSql, table);
    const relativePath = `tables/${table}.copy`;
    const destination = path.join(backupDir, relativePath);
    await writeFile(destination, parsed.body);
    const info = await stat(destination);
    const sha256 = hashCopyBody(parsed.body);
    files.push({
      relativePath,
      sha256,
      bytes: info.size,
      role: "table-export",
    });
    tableExports[`public.${table}`] = {
      rowCount: parsed.rows.length,
      sha256,
      exportPath: relativePath,
    };
  }

  return { files, tableExports };
}

async function main() {
  const supabaseUrl = resolveLocalSupabaseUrl();
  const serviceRoleKey = requireServiceRoleKey();
  const createdAt = new Date().toISOString();
  const backupDir = path.join(BACKUPS_ROOT, utcTimestamp(new Date(createdAt)));

  await mkdir(BACKUPS_ROOT, { recursive: true, mode: 0o700 });
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  await chmod(backupDir, 0o700).catch(() => undefined);

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const versions = await resolveVersions();
    await dumpDatabase(backupDir);

    /** @type {Record<string, number>} */
    const tableRowCounts = {
      "auth.users": await countAuthUsers(client),
    };
    for (const table of BUSINESS_TABLES) {
      tableRowCounts[`public.${table}`] = await countTable(client, table);
    }

    const dataSql = await readFile(path.join(backupDir, "data.sql"), "utf8");
    const sqlFiles = await hashedSqlFiles(backupDir);
    const tableCopy = await exportTableCopies(backupDir, dataSql);
    for (const [table, exported] of Object.entries(tableCopy.tableExports)) {
      if (tableRowCounts[table] !== exported.rowCount) {
        throw new Error(
          `${table} live count ${tableRowCounts[table]} does not match dump COPY rows ${exported.rowCount}`,
        );
      }
    }
    const storageFiles = await downloadStorageObjects(client, backupDir);
    const manifest = buildBackupManifest({
      createdAt,
      cliVersion: versions.cliVersion,
      appVersion: versions.appVersion,
      tableRowCounts,
      tableExports: tableCopy.tableExports,
      files: [...sqlFiles, ...tableCopy.files, ...storageFiles],
    });

    await writeFile(path.join(backupDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Backup written to ${path.relative(REPO_ROOT, backupDir)}`);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

await main();
