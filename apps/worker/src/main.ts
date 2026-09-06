import { loadWorkerConfig } from "./config";
import {
  installWorkerShutdown,
  runWorkerLoop,
  type ProcessingQueue,
} from "./worker-loop";

const idleQueue: ProcessingQueue = {
  async claim() {
    return [];
  },
  async complete() {
    return undefined;
  },
  async fail() {
    return undefined;
  },
};

async function main() {
  const config = loadWorkerConfig(process.env);
  const abort = new AbortController();
  const restore = installWorkerShutdown(abort);

  try {
    await runWorkerLoop({
      queue: idleQueue,
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
