import { testFixtureOrigin } from "../chatgpt/origins";
import type { AdapterPageContext, SourceAdapter } from "./types";

const XIAOHONGSHU_ORIGIN = "https://www.xiaohongshu.com";
const NOTE_PATH = /^\/(?:explore|discovery\/item)\/([^/?#]+)$/;

function xiaohongshuNoteId(
  url: URL,
  configured = import.meta.env.WXT_TEST_FIXTURE_ORIGIN,
  testBuild = import.meta.env.WXT_TEST_BUILD === "1",
): string | null {
  const fixtureOrigin = testFixtureOrigin(configured, testBuild);
  const allowedOrigin =
    url.origin === XIAOHONGSHU_ORIGIN ||
    (fixtureOrigin !== null && url.origin === fixtureOrigin);
  if (!allowedOrigin) return null;
  if (url.origin === XIAOHONGSHU_ORIGIN && url.protocol !== "https:") {
    return null;
  }
  const match = url.pathname.match(NOTE_PATH);
  if (!match?.[1]) return null;
  try {
    const decoded = decodeURIComponent(match[1]).trim();
    return decoded.length > 0 && decoded.length <= 500 ? decoded : null;
  } catch {
    return null;
  }
}

export function createXiaohongshuAdapter(): SourceAdapter<never> {
  return {
    id: "xiaohongshu",
    async extract() {
      throw new Error("小红书笔记提取尚未启用");
    },
    match(url): AdapterPageContext | null {
      const originRef = xiaohongshuNoteId(url);
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
