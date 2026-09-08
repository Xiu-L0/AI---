import { createClient } from "@supabase/supabase-js";

import { loadWorkerConfig } from "./config";
import { createBuildSourceBlocksProcessor } from "./processors/build-source-blocks";
import { createExtractKnowledgeProcessor } from "./processors/extract-knowledge";
import { createNormalizeSourceProcessor } from "./processors/normalize-source";
import { createOcrAssetsProcessor } from "./processors/ocr-assets";
import { DeepSeekTextModel } from "./providers/deepseek-text-model";
import { GlmOcrProvider } from "./providers/glm-ocr";
import { PostgresProcessingQueue } from "./queue/processing-queue";
import {
  PostgresKnowledgeRepository,
  type KnowledgeQueryClient,
} from "./repositories/knowledge-repository";
import {
  PostgresOcrRepository,
  type OcrQueryClient,
} from "./repositories/ocr-repository";
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
  const ocr = new PostgresOcrRepository(
    supabase as unknown as OcrQueryClient,
    config.workerId,
  );
  const model = new DeepSeekTextModel({
    apiKey: config.deepseekApiKey,
    baseUrl: config.deepseekBaseUrl,
    model: config.deepseekModel,
  });
  const glmOcr = new GlmOcrProvider({
    apiKey: config.zhipuApiKey,
    baseUrl: config.glmOcrBaseUrl,
    model: config.glmOcrModel,
    timeoutMs: config.glmOcrTimeoutMs,
  });

  try {
    await runWorkerLoop({
      queue,
      processors: {
        normalize_source: createNormalizeSourceProcessor(sources),
        ocr_assets: createOcrAssetsProcessor({
          sources,
          ocr,
          provider: glmOcr,
          allowSensitiveExternalAi: config.allowSensitiveExternalAi,
        }),
        build_source_blocks: createBuildSourceBlocksProcessor(sources, ocr),
        extract_knowledge: createExtractKnowledgeProcessor({
          sources,
          knowledge,
          model,
          modelName: config.deepseekModel,
        }),
      },
      batchSize: config.batchSize,
      pollIntervalMs: config.pollIntervalMs,
      heartbeatIntervalMs: Math.max(5_000, Math.floor((config.leaseSeconds * 1_000) / 3)),
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
