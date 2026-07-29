import {
  CaptureReceiptSchema,
  type CaptureReceipt,
  type FinalizableCompleteness
} from "@recall/contracts";

export interface ReceiptInput {
  committed: true;
  captureId: string;
  sourceItemId: string;
  captureStatus: FinalizableCompleteness;
  missingElements: readonly string[];
  committedMessageCount: number;
  committedAttachmentCount: number;
}

export function toCaptureReceipt(input: ReceiptInput): CaptureReceipt {
  if (input.committed !== true) {
    throw new Error("a capture receipt requires a committed finalization");
  }

  return CaptureReceiptSchema.parse({
    captureId: input.captureId,
    sourceItemId: input.sourceItemId,
    captureStatus: input.captureStatus,
    processingStatus: "queued",
    savedMessageCount: input.committedMessageCount,
    savedAttachmentCount: input.committedAttachmentCount,
    missingElements: [...input.missingElements]
  });
}
