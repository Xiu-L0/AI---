import type { Sensitivity } from "@recall/contracts";

import type {
  CaptureDraft,
  ChatGptCaptureScope,
  PendingRemoteImage,
} from "../outbox-types";
import { assessChatGptCompleteness } from "./completeness";
import {
  selectChatGptScope,
  type ChatGptExtraction,
  type ChatGptImage,
} from "./extract";

type ToCaptureDraftInput = {
  extraction: ChatGptExtraction;
  originTabId: number;
  originUrl: string;
  originWindowId: number;
  scope: ChatGptCaptureScope;
  selectedText: string;
  sensitivity: Sensitivity;
};

function imageSourceIsReadable(source: string | null): source is string {
  return (
    source !== null &&
    source.length <= 10_000 &&
    /^(https?:|data:image\/)/i.test(source)
  );
}

function missingImages(images: readonly ChatGptImage[]): string[] {
  const counts = new Map<number, number>();
  for (const image of images) {
    if (!imageSourceIsReadable(image.src)) {
      counts.set(image.messageOrdinal, (counts.get(image.messageOrdinal) ?? 0) + 1);
    }
  }
  return [...counts]
    .sort((left, right) => left[0] - right[0])
    .map(
      ([ordinal, count]) =>
        `第 ${ordinal + 1} 条消息中的 ${count} 张图片无法读取`,
    );
}

function scopedMissingElements(
  extraction: ChatGptExtraction,
  scope: ChatGptCaptureScope,
  scopedMessageOrdinals: ReadonlySet<number>,
  images: readonly ChatGptImage[],
): string[] {
  if (scope === "full_conversation") {
    return assessChatGptCompleteness(extraction).missingElements;
  }

  const missing: string[] = [];
  for (const ordinal of extraction.derivedMessageOrdinals) {
    if (scopedMessageOrdinals.has(ordinal)) {
      missing.push(
        `第 ${ordinal + 1} 条消息缺少稳定标识，后续增量采集可能不准确`,
      );
    }
  }
  for (const ordinal of extraction.emptyMessageOrdinals) {
    if (scopedMessageOrdinals.has(ordinal)) {
      missing.push(`第 ${ordinal + 1} 条消息没有可保存的文字或附件`);
    }
  }
  missing.push(...missingImages(images));

  if (
    scope === "qa_pair" &&
    extraction.generatingResponse &&
    scopedMessageOrdinals.has(extraction.messages.at(-1)?.ordinal ?? -1)
  ) {
    missing.push("页面仍在生成回答");
  }
  return [...new Set(missing)];
}

function pendingImages(images: readonly ChatGptImage[]): PendingRemoteImage[] {
  let imageIndex = 0;
  return images.flatMap((item) => {
    if (!imageSourceIsReadable(item.src)) return [];
    imageIndex += 1;
    return [
      {
        alt: item.alt,
        clientId: `chatgpt-image-${item.messageOrdinal + 1}-${imageIndex}`,
        fileName: `chatgpt-image-${item.messageOrdinal + 1}-${imageIndex}.png`,
        missingLabel: `第 ${item.messageOrdinal + 1} 条消息中的图片无法读取`,
        ordinal: item.messageOrdinal,
        sourceUrl: item.src,
      },
    ];
  });
}

export function toChatGptCaptureDraft(input: ToCaptureDraftInput): CaptureDraft {
  const scoped = selectChatGptScope(
    input.extraction,
    input.scope,
    input.selectedText,
  );
  const ordinals = new Set(scoped.messages.map((message) => message.ordinal));
  const missingElements = scopedMissingElements(
    input.extraction,
    input.scope,
    ordinals,
    scoped.images,
  );
  const originConversationRef = input.extraction.externalRef;
  if (originConversationRef === null) {
    throw new Error("ChatGPT conversation id is unavailable");
  }

  return {
    attachments: [],
    completeness: missingElements.length === 0 ? "complete" : "partial",
    externalRef: scoped.externalRef,
    messages: scoped.messages,
    missingElements,
    originConversationRef,
    originTabId: input.originTabId,
    originUrl: input.originUrl,
    originWindowId: input.originWindowId,
    pendingImages: pendingImages(scoped.images),
    rawText: scoped.rawText,
    scope: input.scope,
    sensitivity: input.sensitivity,
    source: "chatgpt_web",
    sourceKind: "ai_conversation",
    sourcePlatform: "chatgpt",
    title: scoped.title,
  };
}
