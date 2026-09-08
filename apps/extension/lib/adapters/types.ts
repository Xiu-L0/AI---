import type {
  CaptureScope,
  Sensitivity,
  SourceKind,
  SourcePlatform,
} from "@recall/contracts";

import type { CaptureDraft } from "../outbox-types";

export type AdapterId = "chatgpt" | "xiaohongshu";

export type AdapterPageContext = {
  adapterId: AdapterId;
  label: string;
  originRef: string;
  scopes: CaptureScope[];
  sourceKind: SourceKind;
  sourcePlatform: SourcePlatform;
};

export type AdapterDraftInput<TExtraction> = {
  capturedAt?: string;
  extraction: TExtraction;
  originTabId: number;
  originUrl: string;
  originWindowId: number;
  scope: CaptureScope;
  selectedText?: string;
  sensitivity: Sensitivity;
};

export interface SourceAdapter<TExtraction = unknown> {
  readonly id: AdapterId;
  extract(tabId: number): Promise<TExtraction>;
  match(url: URL): AdapterPageContext | null;
  toDraft(input: AdapterDraftInput<TExtraction>): CaptureDraft;
}
