import { describe, expect, it } from "vitest";

import { loadWorkerConfig, WorkerConfigError } from "./config";

function validEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    SUPABASE_URL: "http://127.0.0.1:55321",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
    DEEPSEEK_API_KEY: "test-deepseek-key",
    ...overrides,
  };
}

describe("loadWorkerConfig", () => {
  it("accepts HTTP(S) Supabase URLs and required server secrets", () => {
    const config = loadWorkerConfig(validEnv());

    expect(config.supabaseUrl).toBe("http://127.0.0.1:55321");
    expect(config.supabaseServiceRoleKey).toBe("test-service-role");
    expect(config.deepseekApiKey).toBe("test-deepseek-key");
  });

  it("uses DeepSeek defaults when optional values are omitted", () => {
    const config = loadWorkerConfig(validEnv());

    expect(config.deepseekBaseUrl).toBe("https://api.deepseek.com");
    expect(config.deepseekModel).toBe("deepseek-v4-flash");
    expect(config.workerId).toBe("recall-worker");
    expect(config.pollIntervalMs).toBe(2000);
    expect(config.leaseSeconds).toBe(60);
    expect(config.batchSize).toBe(5);
    expect(config.shutdownTimeoutMs).toBe(10_000);
  });

  it("allows deepseek-v4-pro through configuration", () => {
    const config = loadWorkerConfig(validEnv({ DEEPSEEK_MODEL: "deepseek-v4-pro" }));
    expect(config.deepseekModel).toBe("deepseek-v4-pro");
  });

  it("rejects a non-HTTP Supabase URL", () => {
    expect(() => loadWorkerConfig(validEnv({ SUPABASE_URL: "ftp://127.0.0.1" }))).toThrow(
      WorkerConfigError,
    );
  });

  it("rejects empty server secrets", () => {
    expect(() =>
      loadWorkerConfig(validEnv({ SUPABASE_SERVICE_ROLE_KEY: "   " })),
    ).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(() => loadWorkerConfig(validEnv({ DEEPSEEK_API_KEY: "" }))).toThrow(
      /DEEPSEEK_API_KEY/,
    );
  });

  it("rejects public browser env names", () => {
    expect(() =>
      loadWorkerConfig(
        validEnv({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321" }),
      ),
    ).toThrow(/NEXT_PUBLIC_/);
    expect(() =>
      loadWorkerConfig(validEnv({ WXT_PUBLIC_API_ORIGIN: "http://localhost:3000" })),
    ).toThrow(/WXT_PUBLIC_/);
  });

  it("rejects out-of-range worker bounds", () => {
    expect(() => loadWorkerConfig(validEnv({ WORKER_BATCH_SIZE: "0" }))).toThrow(
      /WORKER_BATCH_SIZE/,
    );
    expect(() => loadWorkerConfig(validEnv({ WORKER_LEASE_SECONDS: "5" }))).toThrow(
      /WORKER_LEASE_SECONDS/,
    );
    expect(() =>
      loadWorkerConfig(validEnv({ WORKER_POLL_INTERVAL_MS: "50" })),
    ).toThrow(/WORKER_POLL_INTERVAL_MS/);
    expect(() =>
      loadWorkerConfig(validEnv({ WORKER_SHUTDOWN_TIMEOUT_MS: "100" })),
    ).toThrow(/WORKER_SHUTDOWN_TIMEOUT_MS/);
  });
});
