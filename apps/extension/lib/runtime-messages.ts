import type { CaptureScope, Sensitivity } from "@recall/contracts";

import type { OutboxItem } from "./outbox-types";

export const CAPTURE_CURRENT_PAGE = "recall:capture-current-page";
export const LIST_OUTBOX = "recall:list-outbox";
export const RETRY_OUTBOX_ITEM = "recall:retry-outbox-item";
export const ADD_SCREENSHOT_RECOVERY = "recall:add-screenshot-recovery";
export const REFRESH_OUTBOX_ITEM = "recall:refresh-outbox-item";
export const PAIRING_UPDATED = "recall:pairing-updated";

export type CaptureCurrentPageMessage = {
  recoveryOfItemId?: string;
  scope: Extract<CaptureScope, "full_conversation" | "qa_pair" | "selection">;
  sensitivity: Sensitivity;
  type: typeof CAPTURE_CURRENT_PAGE;
};

export type ListOutboxMessage = {
  type: typeof LIST_OUTBOX;
};

export type RetryOutboxItemMessage = {
  itemId: string;
  type: typeof RETRY_OUTBOX_ITEM;
};

export type AddScreenshotRecoveryMessage = {
  itemId: string;
  type: typeof ADD_SCREENSHOT_RECOVERY;
};

export type RefreshOutboxItemMessage = {
  itemId: string;
  type: typeof REFRESH_OUTBOX_ITEM;
};

export type PairingUpdatedMessage = {
  type: typeof PAIRING_UPDATED;
};

export type RecallRuntimeMessage =
  | CaptureCurrentPageMessage
  | ListOutboxMessage
  | RetryOutboxItemMessage
  | AddScreenshotRecoveryMessage
  | RefreshOutboxItemMessage
  | PairingUpdatedMessage;

export type RecallRuntimeResponse = OutboxItem | OutboxItem[];

export function isRecallRuntimeMessage(
  value: unknown,
): value is RecallRuntimeMessage {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }
  const message = value as Record<string, unknown>;
  const validItemId = (itemId: unknown) =>
    typeof itemId === "string" &&
    itemId.trim().length > 0 &&
    itemId === itemId.trim() &&
    itemId.length <= 200;
  switch (message.type) {
    case CAPTURE_CURRENT_PAGE:
      return (
        typeof message.scope === "string" &&
        ["full_conversation", "qa_pair", "selection"].includes(
          message.scope,
        ) &&
        typeof message.sensitivity === "string" &&
        ["normal", "sensitive", "strictly_sensitive"].includes(
          message.sensitivity,
        ) &&
        (message.recoveryOfItemId === undefined ||
          validItemId(message.recoveryOfItemId))
      );
    case RETRY_OUTBOX_ITEM:
    case ADD_SCREENSHOT_RECOVERY:
    case REFRESH_OUTBOX_ITEM:
      return validItemId(message.itemId);
    case LIST_OUTBOX:
    case PAIRING_UPDATED:
      return true;
    default:
      return false;
  }
}
