import type { AdapterPageContext, SourceAdapter } from "./types";
import { xiaohongshuNoteId } from "../xiaohongshu/origins";

export function createXiaohongshuAdapter(): SourceAdapter<never> {
  return {
    id: "xiaohongshu",
    async extract() {
      throw new Error("小红书笔记提取尚未启用");
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
    toDraft() {
      throw new Error("小红书采集草稿尚未启用");
    },
  };
}
