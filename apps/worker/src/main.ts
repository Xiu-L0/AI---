import { createClient } from "@supabase/supabase-js";

import { loadWorkerConfig } from "./config";
import { PostgresProcessingQueue } from "./queue/processing-queue";
import { installWorkerShutdown, runWorkerLoop } from "./worker-loop";

async function main() {
  const config = loadWorkerConfig(process.env);
  const abort = new AbortController();
  const restore = installWorkerShutdown(abort);
  const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  const queue = new PostgresProcessingQueue(
    supabase,
    config.workerId,
    config.leaseSeconds,
  );

  try {
    await runWorkerLoop({
      queue,
      processors: {},
      batchSize: config.batchSize,
      pollIntervalMs: config.pollIntervalMs,
      clock: { now: () => new Date() },
      sleep: (ms) =>
        new Promise((resolve) => {
          const timer = setTimeout(resolve, ms);
          const onAbort = () => {
            clearTimeout(timer);
            resolve();
          };
          if (abort.signal.aborted) {
            onAbort();
            return;
          }
          abort.signal.addEventListener("abort", onAbort, { once: true });
        }),
      signal: abort.signal,
    });
  } finally {
    restore();
  }
}

void main();
