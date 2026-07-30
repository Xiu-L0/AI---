import { assessChatGptCompleteness } from "./completeness";
import { extractChatGptConversation } from "./extract";

export const EXTRACT_CHATGPT = "EXTRACT_CHATGPT";

export type ExtractChatGptResponse =
  | {
      ok: true;
      extraction: ReturnType<typeof extractChatGptConversation>;
      completeness: ReturnType<typeof assessChatGptCompleteness>;
      selectedText: string;
    }
  | {
      ok: false;
      error: {
        code: "unsupported_page" | "extraction_failed";
        message: string;
      };
    };

export function extractCurrentChatGptPage(
  document: Document,
  url: URL,
): ExtractChatGptResponse {
  try {
    const extraction = extractChatGptConversation(document, url);
    const hasSavableText = extraction.messages.some(
      (message) => message.text.trim().length > 0,
    );
    const hasSavableImage = extraction.images.some(
      (image) => image.src !== null && /^(https?:|data:image\/)/i.test(image.src),
    );
    if (
      extraction.externalRef === null ||
      extraction.messages.length === 0 ||
      (!hasSavableText && !hasSavableImage)
    ) {
      return {
        error: {
          code: "unsupported_page",
          message: "当前页面不是可采集的 ChatGPT 会话",
        },
        ok: false,
      };
    }
    return {
      completeness: assessChatGptCompleteness(extraction),
      extraction,
      ok: true,
      selectedText: extraction.selectionText ?? "",
    };
  } catch (error) {
    return {
      error: {
        code: "extraction_failed",
        message: error instanceof Error ? error.message : "ChatGPT 页面提取失败",
      },
      ok: false,
    };
  }
}
