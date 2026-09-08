import { browser } from "wxt/browser";

import {
  EXTRACT_XIAOHONGSHU,
  extractOpenedXiaohongshuPage,
  parseXiaohongshuContentMessage,
} from "../lib/xiaohongshu/content-message";
import { xiaohongshuMatchPatterns } from "../lib/xiaohongshu/origins";

export default defineContentScript({
  matches: xiaohongshuMatchPatterns(),
  main() {
    browser.runtime.onMessage.addListener((message) => {
      const parsed = parseXiaohongshuContentMessage(message);
      if (!parsed.ok || parsed.type !== EXTRACT_XIAOHONGSHU) {
        return undefined;
      }
      return Promise.resolve(
        extractOpenedXiaohongshuPage(document, new URL(window.location.href)),
      );
    });
  },
});
