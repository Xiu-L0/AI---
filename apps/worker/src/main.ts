import { createClient } from "@supabase/supabase-js";

import { loadWorkerConfig } from "./config";
import { createBuildSourceBlocksProcessor } from "./processors/build-source-blocks";
import { createExtractKnowledgeProcessor } from "./processors/extract-knowledge";
import { createNormalizeSourceProcessor } from "./processors/normalize-source";
import { DeepSeekTextModel } from "./providers/deepseek-text-model";
import { PostgresProcessingQueue } from "./queue/processing-queue";
import {
  PostgresKnowledgeRepository,
  type KnowledgeQueryClient,
} from "./repositories/knowledge-repository";
import {
  PostgresSourceRepository,
  type SourceQueryClient,
} from "./repositories/source-repository";
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
  const sources = new PostgresSourceRepository(
    supabase as unknown as SourceQueryClient,
    config.workerId,
  );
  const knowledge = new PostgresKnowledgeRepository(
    supabase as unknown as KnowledgeQueryClient,
    config.workerId,
  );
  const model = new DeepSeekTextModel({
    apiKey: config.deepseekApiKey,
    baseUrl: config.deepseekBaseUrl,
    model: config.deepseekModel,
  });

  try {
    await runWorkerLoop({
      queue,
      processors: {
        normalize_source: createNormalizeSourceProcessor(sources),
        build_source_blocks: createBuildSourceBlocksProcessor(sources),
        extract_knowledge: createExtractKnowledgeProcessor({
          sources,
          knowledge,
          model,
          modelName: config.deepseekModel,
        }),
      },
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
