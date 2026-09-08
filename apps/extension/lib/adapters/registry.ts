import type { ExtractChatGptResponse } from "../chatgpt/content-message";
import type { ExtractXiaohongshuResponse } from "../xiaohongshu/content-message";
import { createChatGptAdapter } from "./chatgpt";
import type { SourceAdapter } from "./types";
import { createXiaohongshuAdapter } from "./xiaohongshu";

export type AdapterRegistryDependencies = {
  extractChatGpt(tabId: number): Promise<ExtractChatGptResponse>;
  extractXiaohongshu(tabId: number): Promise<ExtractXiaohongshuResponse>;
};

export function createAdapterRegistry(
  dependencies: AdapterRegistryDependencies,
): {
  adapterForUrl(urlValue: string): SourceAdapter | null;
} {
  const adapters: SourceAdapter[] = [
    createChatGptAdapter({ extractChatGpt: dependencies.extractChatGpt }),
    createXiaohongshuAdapter({
      extractXiaohongshu: dependencies.extractXiaohongshu,
    }),
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
  async extractXiaohongshu() {
    throw new Error("Xiaohongshu extractor is not bound");
  },
});

export function adapterForUrl(urlValue: string): SourceAdapter | null {
  return MATCH_ONLY_REGISTRY.adapterForUrl(urlValue);
}
