import type { ExtractChatGptResponse } from "../chatgpt/content-message";
import { createChatGptAdapter } from "./chatgpt";
import type { SourceAdapter } from "./types";
import { createXiaohongshuAdapter } from "./xiaohongshu";

export type AdapterRegistryDependencies = {
  extractChatGpt(tabId: number): Promise<ExtractChatGptResponse>;
};

export function createAdapterRegistry(
  dependencies: AdapterRegistryDependencies,
): {
  adapterForUrl(urlValue: string): SourceAdapter | null;
} {
  const adapters: SourceAdapter[] = [
    createChatGptAdapter({ extractChatGpt: dependencies.extractChatGpt }),
    createXiaohongshuAdapter(),
  ];

  return {
    adapterForUrl(urlValue: string) {
      let url: URL;
      try {
        url = new URL(urlValue);
      } catch {
        return null;
      }
      return adapters.find((adapter) => adapter.match(url) !== null) ?? null;
    },
  };
}

const MATCH_ONLY_REGISTRY = createAdapterRegistry({
  async extractChatGpt() {
    throw new Error("ChatGPT extractor is not bound");
  },
});

export function adapterForUrl(urlValue: string): SourceAdapter | null {
  return MATCH_ONLY_REGISTRY.adapterForUrl(urlValue);
}
