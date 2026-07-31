import { browser } from "wxt/browser";

import {
  EXTRACT_CHATGPT,
  extractCurrentChatGptPage,
} from "../lib/chatgpt/content-message";
import { chatGptMatchPatterns } from "../lib/chatgpt/origins";

export default defineContentScript({
  matches: chatGptMatchPatterns(),
  main() {
    browser.runtime.onMessage.addListener((message) => {
      if (
        typeof message !== "object" ||
        message === null ||
        !("type" in message) ||
        message.type !== EXTRACT_CHATGPT
      ) {
        return undefined;
      }
      return Promise.resolve(
        extractCurrentChatGptPage(document, new URL(window.location.href)),
      );
    });
  },
});
