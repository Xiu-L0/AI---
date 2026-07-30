import type { ChatGptExtraction } from "./extract";

export type ChatGptCompleteness = {
  completeness: "complete" | "partial";
  missingElements: string[];
};

export function assessChatGptCompleteness(
  extraction: ChatGptExtraction,
): ChatGptCompleteness {
  const missingElements: string[] = [];
  if (extraction.externalRef === null) {
    missingElements.push("无法识别 ChatGPT 会话标识");
  }
  if (extraction.messages.length === 0) {
    missingElements.push("未找到可采集的 ChatGPT 消息");
  }

  for (const ordinal of extraction.derivedMessageOrdinals) {
    missingElements.push(`第 ${ordinal + 1} 条消息缺少稳定标识，后续增量采集可能不准确`);
  }
  for (const duplicateId of extraction.duplicateMessageIds) {
    missingElements.push(`页面包含重复消息标识 ${duplicateId}，已降级为安全的临时标识`);
  }
  for (const role of extraction.unsupportedRoles) {
    missingElements.push(`发现暂不支持的消息角色 ${role}`);
  }

  const missingImages = new Map<number, number>();
  for (const image of extraction.images) {
    const usableSource =
      image.src !== null &&
      /^(https?:|data:image\/)/i.test(image.src);
    if (!usableSource) {
      missingImages.set(
        image.messageOrdinal,
        (missingImages.get(image.messageOrdinal) ?? 0) + 1,
      );
    }
  }
  for (const [ordinal, count] of [...missingImages].sort((a, b) => a[0] - b[0])) {
    missingElements.push(`第 ${ordinal + 1} 条消息中的 ${count} 张图片无法读取`);
  }
  for (const ordinal of extraction.emptyMessageOrdinals) {
    missingElements.push(`第 ${ordinal + 1} 条消息没有可保存的文字或附件`);
  }
  if (extraction.generatingResponse) {
    missingElements.push("页面仍在生成回答");
  }

  const uniqueMissingElements = [...new Set(missingElements)];
  return {
    completeness: uniqueMissingElements.length === 0 ? "complete" : "partial",
    missingElements: uniqueMissingElements,
  };
}
