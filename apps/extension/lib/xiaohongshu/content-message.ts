import { extractCurrentXiaohongshuPage, type XiaohongshuExtraction } from "./extract";

export const EXTRACT_XIAOHONGSHU = "EXTRACT_XIAOHONGSHU";

export type ExtractXiaohongshuResponse =
  | {
      ok: true;
      extraction: XiaohongshuExtraction;
    }
  | {
      ok: false;
      error: {
        code: "unsupported_page" | "extraction_failed" | "ignored";
        message: string;
      };
    };

export function parseXiaohongshuContentMessage(
  value: unknown,
):
  | { ok: true; type: typeof EXTRACT_XIAOHONGSHU }
  | ExtractXiaohongshuResponse & { ok: false } {
  if (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === EXTRACT_XIAOHONGSHU
  ) {
    return { ok: true, type: EXTRACT_XIAOHONGSHU };
  }
  return {
    ok: false,
    error: {
      code: "ignored",
      message: "unrelated message",
    },
  };
}

function safeMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : fallback;
  return raw.replace(/\s+/g, " ").trim().slice(0, 500);
}

export function extractOpenedXiaohongshuPage(
  document: Document,
  url: URL,
): ExtractXiaohongshuResponse {
  try {
    const extraction = extractCurrentXiaohongshuPage(document, url);
    if (
      extraction.externalRef.trim().length === 0 ||
      extraction.body.trim().length === 0
    ) {
      return {
        ok: false,
        error: {
          code: "unsupported_page",
          message: "当前页面不是可采集的小红书笔记",
        },
      };
    }
    return { ok: true, extraction };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "extraction_failed",
        message: safeMessage(error, "小红书页面提取失败"),
      },
    };
  }
}
