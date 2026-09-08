import type { ExtractXiaohongshuResponse } from "../xiaohongshu/content-message";
import { xiaohongshuNoteId } from "../xiaohongshu/origins";
import { toXiaohongshuCaptureDraft } from "../xiaohongshu/to-capture-draft";
import type {
  AdapterDraftInput,
  AdapterPageContext,
  SourceAdapter,
} from "./types";

export type XiaohongshuAdapterDependencies = {
  extractXiaohongshu(tabId: number): Promise<ExtractXiaohongshuResponse>;
};

export function createXiaohongshuAdapter(
  dependencies: XiaohongshuAdapterDependencies,
): SourceAdapter<ExtractXiaohongshuResponse> {
  return {
    id: "xiaohongshu",
    extract(tabId) {
      return dependencies.extractXiaohongshu(tabId);
    },
    match(url): AdapterPageContext | null {
      const originRef = xiaohongshuNoteId(url.href);
      if (originRef === null) return null;
      return {
        adapterId: "xiaohongshu",
        label: "小红书网页版",
        originRef,
        scopes: ["web_page"],
        sourceKind: "social_post",
        sourcePlatform: "xiaohongshu",
      };
    },
    toDraft(input: AdapterDraftInput<ExtractXiaohongshuResponse>) {
      if (!input.extraction.ok) {
        throw new Error(input.extraction.error.message);
      }
      if (input.scope !== "web_page") {
        throw new Error("当前来源不支持该保存范围");
      }
      return toXiaohongshuCaptureDraft({
        capturedAt: input.capturedAt ?? new Date().toISOString(),
        extraction: input.extraction.extraction,
        originTabId: input.originTabId,
        originUrl: input.originUrl,
        originWindowId: input.originWindowId,
        sensitivity: input.sensitivity,
      });
    },
  };
}
