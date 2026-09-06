const PUBLIC_ENV_PREFIXES = ["NEXT_PUBLIC_", "WXT_PUBLIC_"] as const;
const ALLOWED_MODELS = ["deepseek-v4-flash", "deepseek-v4-pro"] as const;

export type DeepseekModel = (typeof ALLOWED_MODELS)[number];

export type WorkerConfig = {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  deepseekApiKey: string;
  deepseekBaseUrl: string;
  deepseekModel: DeepseekModel;
  workerId: string;
  pollIntervalMs: number;
  leaseSeconds: number;
  batchSize: number;
  shutdownTimeoutMs: number;
};

export class WorkerConfigError extends Error {
  readonly code = "worker_config_invalid";

  constructor(message: string) {
    super(message);
    this.name = "WorkerConfigError";
  }
}

function readRequiredSecret(env: Record<string, string | undefined>, name: string) {
  const value = env[name]?.trim() ?? "";
  if (value === "") {
    throw new WorkerConfigError(`${name} must be a non-empty server secret`);
  }
  return value;
}

function readBoundedInteger(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
  min: number,
  max: number,
) {
  const raw = env[name]?.trim();
  const value = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new WorkerConfigError(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function readHttpUrl(env: Record<string, string | undefined>, name: string, fallback?: string) {
  const raw = env[name]?.trim() || fallback;
  if (!raw) {
    throw new WorkerConfigError(`${name} must be an HTTP(S) URL`);
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new WorkerConfigError(`${name} must be an HTTP(S) URL`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new WorkerConfigError(`${name} must be an HTTP(S) URL`);
  }

  return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/$/, "")}`;
}

export function loadWorkerConfig(
  env: Record<string, string | undefined>,
): WorkerConfig {
  const publicName = Object.keys(env).find((name) =>
    PUBLIC_ENV_PREFIXES.some((prefix) => name.startsWith(prefix)),
  );
  if (publicName) {
    throw new WorkerConfigError(
      "Worker config cannot include NEXT_PUBLIC_ or WXT_PUBLIC_ variables",
    );
  }

  const deepseekModel = (env.DEEPSEEK_MODEL?.trim() || "deepseek-v4-flash") as string;
  if (!ALLOWED_MODELS.includes(deepseekModel as DeepseekModel)) {
    throw new WorkerConfigError(
      "DEEPSEEK_MODEL must be deepseek-v4-flash or deepseek-v4-pro",
    );
  }

  const workerId = env.WORKER_ID?.trim() || "recall-worker";
  if (workerId.length < 1 || workerId.length > 200) {
    throw new WorkerConfigError("WORKER_ID must be between 1 and 200 characters");
  }

  return {
    supabaseUrl: readHttpUrl(env, "SUPABASE_URL"),
    supabaseServiceRoleKey: readRequiredSecret(env, "SUPABASE_SERVICE_ROLE_KEY"),
    deepseekApiKey: readRequiredSecret(env, "DEEPSEEK_API_KEY"),
    deepseekBaseUrl: readHttpUrl(
      env,
      "DEEPSEEK_BASE_URL",
      "https://api.deepseek.com",
    ),
    deepseekModel: deepseekModel as DeepseekModel,
    workerId,
    pollIntervalMs: readBoundedInteger(env, "WORKER_POLL_INTERVAL_MS", 2000, 200, 60_000),
    leaseSeconds: readBoundedInteger(env, "WORKER_LEASE_SECONDS", 60, 10, 3600),
    batchSize: readBoundedInteger(env, "WORKER_BATCH_SIZE", 5, 1, 50),
    shutdownTimeoutMs: readBoundedInteger(
      env,
      "WORKER_SHUTDOWN_TIMEOUT_MS",
      10_000,
      1_000,
      60_000,
    ),
  };
}
