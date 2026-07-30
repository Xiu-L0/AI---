import { browser } from "wxt/browser";

export default defineBackground(() => {
  void browser.action.setBadgeText({ text: "" });
});
