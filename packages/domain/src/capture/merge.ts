import type { CapturedMessage } from "@recall/contracts";

export interface MergeResult {
  messages: CapturedMessage[];
  appendedIds: string[];
  changedIds: string[];
}

export class DuplicateMessageIdError extends Error {
  readonly externalMessageId: string;
  readonly collection: "previous" | "incoming";

  constructor(
    externalMessageId: string,
    collection: "previous" | "incoming"
  ) {
    super(`duplicate message id "${externalMessageId}" in ${collection}`);
    this.name = "DuplicateMessageIdError";
    this.externalMessageId = externalMessageId;
    this.collection = collection;
  }
}

function assertUniqueMessageIds(
  messages: readonly CapturedMessage[],
  collection: "previous" | "incoming"
): void {
  const seen = new Set<string>();
  for (const message of messages) {
    if (seen.has(message.externalMessageId)) {
      throw new DuplicateMessageIdError(message.externalMessageId, collection);
    }
    seen.add(message.externalMessageId);
  }
}

function compareMessages(
  left: CapturedMessage,
  right: CapturedMessage
): number {
  const ordinalDifference = left.ordinal - right.ordinal;
  if (ordinalDifference !== 0) {
    return ordinalDifference;
  }
  if (left.externalMessageId < right.externalMessageId) {
    return -1;
  }
  if (left.externalMessageId > right.externalMessageId) {
    return 1;
  }
  return 0;
}

export function mergeMessages(
  previous: readonly CapturedMessage[],
  incoming: readonly CapturedMessage[]
): MergeResult {
  assertUniqueMessageIds(previous, "previous");
  assertUniqueMessageIds(incoming, "incoming");

  const mergedById = new Map(
    previous.map((message) => [message.externalMessageId, message])
  );
  const appendedIds: string[] = [];
  const changedIds: string[] = [];

  for (const incomingMessage of incoming) {
    const existing = mergedById.get(incomingMessage.externalMessageId);
    if (existing === undefined) {
      mergedById.set(incomingMessage.externalMessageId, incomingMessage);
      appendedIds.push(incomingMessage.externalMessageId);
      continue;
    }

    if (
      existing.text !== incomingMessage.text ||
      existing.role !== incomingMessage.role
    ) {
      mergedById.set(incomingMessage.externalMessageId, incomingMessage);
      changedIds.push(incomingMessage.externalMessageId);
    }
  }

  return {
    messages: [...mergedById.values()].sort(compareMessages),
    appendedIds,
    changedIds
  };
}
