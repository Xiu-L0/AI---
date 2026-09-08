import type { CaptureMetadata, Sensitivity } from "@recall/contracts";

import type { XiaohongshuExtraction, XiaohongshuImage } from "./extract";

export const XIAOHONGSHU_ADAPTER_VERSION = "1";

export type XiaohongshuPendingImage = {
  alt: string;
  clientId: string;
  fileName: string;
  missingLabel: string;
  ordinal: number;
  sourceUrl: string;
};

export type XiaohongshuCaptureDraft = {
  attachments: [];
  completeness: "complete" | "partial";
  externalRef: string;
  messages: [];
  metadata: CaptureMetadata;
  missingElements: string[];
  originConversationRef: string;
  originTabId: number;
  originUrl: string;
  originWindowId: number;
  pendingImages: XiaohongshuPendingImage[];
  rawText: string;
  scope: "web_page";
  sensitivity: Sensitivity;
  sourceKind: "social_post";
  sourcePlatform: "xiaohongshu";
  title: string;
};

export type ToXiaohongshuCaptureDraftInput = {
  capturedAt: string;
  extraction: XiaohongshuExtraction;
  originTabId: number;
  originUrl: string;
  originWindowId: number;
  sensitivity: Sensitivity;
};

function imageSourceIsReadable(source: string | null): source is string {
  return (
    source !== null &&
    source.length <= 10_000 &&
    /^(https:|data:image\/)/i.test(source)
  );
}

function missingElements(extraction: XiaohongshuExtraction): string[] {
  const missing: string[] = [];
  if (extraction.author === null || extraction.author.trim().length === 0) {
    missing.push("缺少作者信息");
  }
  extraction.images.forEach((image, index) => {
    if (!imageSourceIsReadable(image.src)) {
      missing.push(`第 ${index + 1} 张图片无法读取`);
    }
  });
  const readableCount = extraction.images.filter((image) =>
    imageSourceIsReadable(image.src),
  ).length;
  if (extraction.declaredImageCount > readableCount) {
    missing.push("声明的图片数量多于可读原图");
  }
  if (extraction.hasVideo) {
    missing.push("当前是视频笔记，首版只保存可见文字和封面");
  }
  return [...new Set(missing)];
}

function pendingImages(
  images: readonly XiaohongshuImage[],
): XiaohongshuPendingImage[] {
  return images.flatMap((image, index) => {
    if (!imageSourceIsReadable(image.src)) return [];
    const ordinal = index;
    return [
      {
        alt: image.alt,
        clientId: `xhs-image-${ordinal + 1}`,
        fileName: `xhs-image-${ordinal + 1}.png`,
        missingLabel: `第 ${ordinal + 1} 张图片无法读取`,
        ordinal,
        sourceUrl: image.src,
      },
    ];
  });
}

function assets(images: readonly XiaohongshuPendingImage[]) {
  return images.map((image) => ({
    alt: image.alt,
    clientId: image.clientId,
    ordinal: image.ordinal,
  }));
}

export function toXiaohongshuCaptureDraft(
  input: ToXiaohongshuCaptureDraftInput,
): XiaohongshuCaptureDraft {
  const noteId = input.extraction.externalRef.trim();
  const body = input.extraction.body.trim();
  if (noteId.length === 0) {
    throw new Error("无法采集：缺少小红书笔记标识");
  }
  if (body.length === 0) {
    throw new Error("无法采集：当前笔记没有可保存的正文");
  }

  const missing = missingElements(input.extraction);
  const pending = pendingImages(input.extraction.images);

  return {
    attachments: [],
    completeness: missing.length === 0 ? "complete" : "partial",
    externalRef: noteId,
    messages: [],
    metadata: {
      adapterName: "xiaohongshu",
      adapterVersion: XIAOHONGSHU_ADAPTER_VERSION,
      assets: assets(pending),
      author: input.extraction.author,
      capturedAt: input.capturedAt,
      canonicalUrl: input.extraction.canonicalUrl,
    },
    missingElements: missing,
    originConversationRef: noteId,
    originTabId: input.originTabId,
    originUrl: input.originUrl,
    originWindowId: input.originWindowId,
    pendingImages: pending,
    rawText: input.extraction.body,
    scope: "web_page",
    sensitivity: input.sensitivity,
    sourceKind: "social_post",
    sourcePlatform: "xiaohongshu",
    title: input.extraction.title.slice(0, 500),
  };
}
