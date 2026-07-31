import {
  chromium,
  expect,
  test as base,
  type BrowserContext,
  type Page,
  type Worker,
} from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const FIXTURE_HOST = "127.0.0.1";
const FIXTURE_PORT = 41_739;
const API_PROXY_PORT = 41_740;
const WEB_ORIGIN = "http://127.0.0.1:3000";

export const fixtureOrigin = `http://${FIXTURE_HOST}:${FIXTURE_PORT}`;
export const extensionApiOrigin = `http://${FIXTURE_HOST}:${API_PROXY_PORT}`;

type FinalizeMode = "normal" | "delayed" | "offline";

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, FIXTURE_HOST, () => {
      server.off("error", reject);
      resolveListen();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
}

function requestBody(request: import("node:http").IncomingMessage): Promise<Buffer> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.once("end", () => resolveBody(Buffer.concat(chunks)));
    request.once("error", reject);
  });
}

function proxyHeaders(headers: IncomingHttpHeaders): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (
      value === undefined ||
      ["connection", "content-length", "host", "transfer-encoding"].includes(
        name.toLowerCase(),
      )
    ) {
      continue;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => result.append(name, item));
    } else {
      result.set(name, value);
    }
  }
  return result;
}

export class RecallExtensionTestServer {
  private finalizeMode: FinalizeMode = "normal";
  private releaseGate: (() => void) | null = null;
  private finalizeGate: Promise<void> | null = null;
  private finalizeArrived: Promise<void> | null = null;
  private markFinalizeArrived: (() => void) | null = null;
  private readonly signedStoragePaths = new Set<string>();
  private readonly fixtureServer: Server;
  private readonly proxyServer: Server;

  constructor() {
    const complete = readFileSync(
      resolve("tests/fixtures/chatgpt/complete-conversation.html"),
    );
    const partial = readFileSync(
      resolve("tests/fixtures/chatgpt/conversation-with-missing-image.html"),
    );
    const generatedPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );

    this.fixtureServer = createServer((request, response) => {
      const url = new URL(request.url ?? "/", fixtureOrigin);
      if (url.pathname === "/generated-fixture.png") {
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-length": generatedPng.byteLength,
          "content-type": "image/png",
        });
        response.end(generatedPng);
        return;
      }
      if (/^\/c\/missing-[A-Za-z0-9_-]+$/.test(url.pathname)) {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(partial);
        return;
      }
      if (/^\/c\/[A-Za-z0-9_-]+$/.test(url.pathname)) {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(complete);
        return;
      }
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Synthetic fixture not found");
    });

    this.proxyServer = createServer(async (request, response) => {
      try {
        const url = new URL(request.url ?? "/", extensionApiOrigin);
        const isFinalize = /^\/api\/captures\/[^/]+\/finalize$/.test(url.pathname);
        if (isFinalize && this.finalizeMode === "offline") {
          request.socket.destroy();
          return;
        }
        if (isFinalize && this.finalizeMode === "delayed" && this.finalizeGate) {
          this.markFinalizeArrived?.();
          await this.finalizeGate;
        }

        const body = ["GET", "HEAD"].includes(request.method ?? "GET")
          ? undefined
          : await requestBody(request);
        const upstream = await fetch(`${WEB_ORIGIN}${url.pathname}${url.search}`, {
          body,
          headers: proxyHeaders(request.headers),
          method: request.method,
        });
        const headers = new Headers(upstream.headers);
        headers.delete("content-encoding");
        headers.delete("content-length");
        headers.delete("transfer-encoding");
        const responseBytes = Buffer.from(await upstream.arrayBuffer());
        if (url.pathname === "/api/captures/start" && upstream.ok) {
          try {
            const payload = JSON.parse(responseBytes.toString("utf8")) as {
              uploadTargets?: Array<{ storagePath?: unknown }>;
            };
            for (const target of payload.uploadTargets ?? []) {
              if (typeof target.storagePath === "string") {
                this.signedStoragePaths.add(target.storagePath);
              }
            }
          } catch {
            // The Web contract test will reject malformed JSON; cleanup stays best-effort.
          }
        }
        response.writeHead(upstream.status, Object.fromEntries(headers.entries()));
        response.end(responseBytes);
      } catch (error) {
        if (!response.headersSent) {
          response.writeHead(502, { "content-type": "application/json" });
        }
        response.end(
          JSON.stringify({
            code: "fixture_proxy_failed",
            error: error instanceof Error ? error.name : "UnknownError",
          }),
        );
      }
    });
  }

  async start() {
    await Promise.all([
      listen(this.fixtureServer, FIXTURE_PORT),
      listen(this.proxyServer, API_PROXY_PORT),
    ]);
  }

  delayFinalization() {
    this.finalizeMode = "delayed";
    this.finalizeArrived = new Promise((resolveArrival) => {
      this.markFinalizeArrived = resolveArrival;
    });
    this.finalizeGate = new Promise((resolveGate) => {
      this.releaseGate = resolveGate;
    });
  }

  async waitForDelayedFinalization() {
    if (this.finalizeArrived === null) {
      throw new Error("Finalization delay was not configured");
    }
    await this.finalizeArrived;
  }

  releaseFinalization() {
    this.finalizeMode = "normal";
    this.releaseGate?.();
    this.releaseGate = null;
    this.finalizeGate = null;
    this.finalizeArrived = null;
    this.markFinalizeArrived = null;
  }

  setFinalizeOffline(offline: boolean) {
    this.releaseFinalization();
    this.finalizeMode = offline ? "offline" : "normal";
  }

  storagePaths() {
    return [...this.signedStoragePaths];
  }

  async stop() {
    this.releaseFinalization();
    await Promise.all([close(this.fixtureServer), close(this.proxyServer)]);
  }
}

type ExtensionFixtures = {
  extensionContext: BrowserContext;
  extensionId: string;
  openPopup(): Promise<Page>;
  serviceWorker: Worker;
};

type WorkerFixtures = {
  extensionBuild: string;
  recallTestServer: RecallExtensionTestServer;
};

function runExtensionBuild(environment: NodeJS.ProcessEnv) {
  const command = ["pnpm", "--filter", "@recall/extension", "build"];
  const executable = process.platform === "win32"
    ? (process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe")
    : command.shift()!;
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", command.join(" ")]
    : command;
  execFileSync(executable, args, {
    cwd: resolve("."),
    env: environment,
    stdio: "inherit",
  });
}

function buildTestExtension(): string {
  const output = resolve("apps/extension/.output/chrome-mv3");
  const testBuildCopy = mkdtempSync(resolve(tmpdir(), "recall-extension-build-"));
  const productionEnvironment = {
    ...process.env,
    WXT_PUBLIC_API_ORIGIN:
      process.env.WXT_PUBLIC_API_ORIGIN ?? "http://localhost:3000",
    WXT_PUBLIC_SUPABASE_URL:
      process.env.WXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321",
  };
  delete productionEnvironment.WXT_TEST_BUILD;
  delete productionEnvironment.WXT_TEST_FIXTURE_ORIGIN;
  let testBuildError: unknown = null;
  try {
    runExtensionBuild({
      ...process.env,
      WXT_PUBLIC_API_ORIGIN: extensionApiOrigin,
      WXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      WXT_TEST_BUILD: "1",
      WXT_TEST_FIXTURE_ORIGIN: fixtureOrigin,
    });
    cpSync(output, testBuildCopy, { recursive: true });
  } catch (error) {
    testBuildError = error;
  }
  try {
    runExtensionBuild(productionEnvironment);
  } catch (error) {
    rmSync(testBuildCopy, { force: true, recursive: true });
    throw error;
  }

  if (testBuildError !== null) {
    rmSync(testBuildCopy, { force: true, recursive: true });
    throw testBuildError;
  }

  const productionManifest = JSON.parse(
    readFileSync(resolve(output, "manifest.json"), "utf8"),
  ) as { host_permissions?: string[] };
  const productionHosts = productionManifest.host_permissions ?? [];
  if (
    productionHosts.some(
      (host) => host.includes(":41739/") || host.includes(":41740/"),
    )
  ) {
    rmSync(testBuildCopy, { force: true, recursive: true });
    throw new Error("The production extension build retained a test-only host");
  }
  return testBuildCopy;
}

export const test = base.extend<ExtensionFixtures, WorkerFixtures>({
  extensionBuild: [
    async ({}, use) => {
      const buildCopy = buildTestExtension();
      try {
        await use(buildCopy);
      } finally {
        rmSync(buildCopy, { force: true, recursive: true });
      }
    },
    { scope: "worker" },
  ],
  recallTestServer: [
    async ({}, use) => {
      const server = new RecallExtensionTestServer();
      await server.start();
      try {
        await use(server);
      } finally {
        await server.stop();
      }
    },
    { scope: "worker" },
  ],
  extensionContext: async ({ extensionBuild, recallTestServer: _server }, use) => {
    const userDataDir = mkdtempSync(resolve(tmpdir(), "recall-extension-e2e-"));
    const context = await chromium.launchPersistentContext(userDataDir, {
      args: [
        `--disable-extensions-except=${extensionBuild}`,
        `--load-extension=${extensionBuild}`,
      ],
      baseURL: WEB_ORIGIN,
      channel: "chromium",
      headless: true,
      serviceWorkers: "allow",
    });
    try {
      await use(context);
    } finally {
      await context.close();
      rmSync(userDataDir, { force: true, recursive: true });
    }
  },
  serviceWorker: async ({ extensionContext }, use) => {
    const worker =
      extensionContext.serviceWorkers()[0] ??
      (await extensionContext.waitForEvent("serviceworker"));
    await use(worker);
  },
  extensionId: async ({ serviceWorker }, use) => {
    const extensionId = new URL(serviceWorker.url()).hostname;
    await use(extensionId);
  },
  openPopup: async ({ extensionContext, extensionId }, use) => {
    await use(async () => {
      const popup = await extensionContext.newPage();
      await popup.goto(`chrome-extension://${extensionId}/popup.html`);
      return popup;
    });
  },
});

export { expect };
