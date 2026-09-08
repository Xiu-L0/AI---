import type { CaptureScope } from "@recall/contracts";

import type { ExtractChatGptResponse } from "../chatgpt/content-message";
import { chatGptConversationRef } from "../chatgpt/origins";
import { toChatGptCaptureDraft } from "../chatgpt/to-capture-draft";
import type { ChatGptCaptureScope } from "../outbox-types";
import type {
  AdapterDraftInput,
  AdapterPageContext,
  SourceAdapter,
} from "./types";

const CHATGPT_SCOPES: ChatGptCaptureScope[] = [
  "full_conversation",
  "qa_pair",
  "selection",
];

function isChatGptScope(scope: CaptureScope): scope is ChatGptCaptureScope {
  return (CHATGPT_SCOPES as readonly string[]).includes(scope);
}

export type ChatGptAdapterDependencies = {
  extractChatGpt(tabId: number): Promise<ExtractChatGptResponse>;
};

export function createChatGptAdapter(
  dependencies: ChatGptAdapterDependencies,
): SourceAdapter<ExtractChatGptResponse> {
  return {
    id: "chatgpt",
    extract(tabId) {
      return dependencies.extractChatGpt(tabId);
    },
    match(url): AdapterPageContext | null {
      const originRef = chatGptConversationRef(url.href);
      if (originRef === null) return null;
      return {
        adapterId: "chatgpt",
        label: "ChatGPT 网页版",
        originRef,
        scopes: [...CHATGPT_SCOPES],
        sourceKind: "ai_conversation",
        sourcePlatform: "chatgpt",
      };
    },
    toDraft(input: AdapterDraftInput<ExtractChatGptResponse>) {
      if (!input.extraction.ok) {
        throw new Error(input.extraction.error.message);
      }
      if (!isChatGptScope(input.scope)) {
        throw new Error("当前来源不支持该保存范围");
      }
      return toChatGptCaptureDraft({
        extraction: input.extraction.extraction,
        originTabId: input.originTabId,
        originUrl: input.originUrl,
        originWindowId: input.originWindowId,
        scope: input.scope,
        selectedText: input.extraction.selectedText,
        sensitivity: input.sensitivity,
      });
    },
  };
}
