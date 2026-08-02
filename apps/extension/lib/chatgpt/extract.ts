import type { CapturedMessage } from "@recall/contracts";

export const CHATGPT_SELECTORS = {
  conversationRoot: "main",
  messageContainers: "[data-message-author-role]",
  images: "img",
  excludedImages:
    "[aria-hidden='true'], [hidden], [data-testid*='avatar'], [data-testid*='feedback'], [data-testid*='icon'], .avatar, [style*='display: none'], [style*='visibility: hidden']",
  presentationImages: "[role='presentation']",
  excludedContent:
    "button, [aria-hidden='true'], [hidden], [data-testid*='copy'], [data-testid*='feedback'], [style*='display: none'], [style*='visibility: hidden']",
  generatingResponse:
    "[data-testid='stop-button'], [data-testid*='stop-generating'], [data-testid*='streaming'], [data-is-streaming='true'], [aria-busy='true'], [aria-label*='Stop generating'], [aria-label*='停止生成']",
} as const;

const SUPPORTED_ROLES = new Set<CapturedMessage["role"]>([
  "user",
  "assistant",
  "system",
  "tool",
]);
const PRESERVED_NEWLINE = "\uE000";
const PRESERVED_SPACE = "\uE001";
const PRESERVED_TAB = "\uE002";

export type ChatGptImage = {
  alt: string;
  height: number | null;
  messageExternalId: string;
  messageOrdinal: number;
  src: string | null;
  width: number | null;
};

export type ChatGptExtraction = {
  externalRef: string | null;
  title: string;
  messages: CapturedMessage[];
  images: ChatGptImage[];
  derivedMessageOrdinals: number[];
  duplicateMessageIds: string[];
  emptyMessageOrdinals: number[];
  generatingResponse: boolean;
  selectionMessageId: string | null;
  selectionText: string | null;
  unsupportedRoles: string[];
};

export type ScopedChatGptCapture = {
  externalRef: string;
  title: string;
  messages: CapturedMessage[];
  images: ChatGptImage[];
  rawText: string;
};

export class UnsupportedChatGptScopeStateError extends Error {
  readonly code = "unsupported_scope_state";

  constructor(message: string) {
    super(message);
    this.name = "UnsupportedChatGptScopeStateError";
  }
}

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/[\t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeForContainment(value: string): string {
  return normalizeText(value).replace(/\s+/g, " ");
}

function normalizeRenderedText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .replaceAll(PRESERVED_NEWLINE, "\n")
    .replaceAll(PRESERVED_SPACE, " ")
    .replaceAll(PRESERVED_TAB, "\t");
}

function textHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of normalizeText(value)) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function renderVisibleNode(
  node: Node,
  preserveWhitespace = false,
  rootMessage?: Element,
): string {
  if (node.nodeType === 3) {
    const value = node.nodeValue ?? "";
    return preserveWhitespace
      ? value
          .replace(/\r\n?/g, "\n")
          .replaceAll("\n", PRESERVED_NEWLINE)
          .replaceAll(" ", PRESERVED_SPACE)
          .replaceAll("\t", PRESERVED_TAB)
      : value.replace(/\s+/g, " ");
  }
  if (node.nodeType !== 1) return "";

  const element = node as Element;
  if (
    (rootMessage !== undefined &&
      element !== rootMessage &&
      element.matches(CHATGPT_SELECTORS.messageContainers)) ||
    isExcludedContent(element)
  ) {
    return "";
  }
  if (element.tagName === "BR") return "\n";
  if (element.tagName === "IMG") return "";

  const preserveChildren = preserveWhitespace || element.tagName === "PRE";
  const content = [...element.childNodes]
    .map((child) => renderVisibleNode(child, preserveChildren, rootMessage))
    .join("");

  if (element.tagName === "LI") return `\n- ${content.trim()}\n`;
  if (element.tagName === "TD" || element.tagName === "TH") {
    return `${content.trim()}\t`;
  }
  if (element.tagName === "TR") return `\n${content.trimEnd()}\n`;

  const blockTags = [
    "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DIV", "DL", "DT", "DD",
    "FIGCAPTION", "FIGURE", "FOOTER", "H1", "H2", "H3", "H4", "H5", "H6",
    "HEADER", "HR", "MAIN", "NAV", "OL", "P", "PRE", "SECTION", "TABLE",
    "TBODY", "TFOOT", "THEAD", "UL",
  ];
  return blockTags.includes(element.tagName) ? `\n${content}\n` : content;
}

function visibleText(container: Element): string {
  return normalizeRenderedText(renderVisibleNode(container, false, container));
}

function isHiddenOrNestedMessage(container: Element): boolean {
  if (isHidden(container)) return true;
  const parentMessage = container.parentElement?.closest(
    CHATGPT_SELECTORS.messageContainers,
  );
  return parentMessage !== null && parentMessage !== undefined;
}

function roleFor(container: Element): CapturedMessage["role"] | null {
  const role = container.getAttribute("data-message-author-role");
  return role !== null && SUPPORTED_ROLES.has(role as CapturedMessage["role"])
    ? (role as CapturedMessage["role"])
    : null;
}

function stableMessageId(
  container: Element,
  role: CapturedMessage["role"],
  ordinal: number,
  text: string,
): { id: string; derived: boolean } {
  const messageId = container.getAttribute("data-message-id")?.trim();
  if (messageId && messageId.length <= 500) return { id: messageId, derived: false };

  const testId = container.getAttribute("data-testid")?.trim();
  if (testId && /^conversation-turn-\d+$/.test(testId)) {
    return { id: testId, derived: false };
  }

  const elementId = container.getAttribute("id")?.trim();
  if (
    elementId &&
    elementId.length <= 500 &&
    /^(?:conversation-turn-|message-)/.test(elementId)
  ) {
    return { id: elementId, derived: false };
  }
  return { id: `derived-${role}-${ordinal}-${textHash(text)}`, derived: true };
}

function numericAttribute(element: Element, name: "width" | "height"): number | null {
  const parsed = Number.parseInt(element.getAttribute(name) ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function elementForNode(node: Node): Element | null {
  return node.nodeType === 1 ? (node as Element) : node.parentElement;
}

function selectionContext(
  document: Document,
): { container: Element; text: string } | null {
  const selection = document.getSelection?.();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const start = elementForNode(range.startContainer);
  const end = elementForNode(range.endContainer);
  if (
    start === null ||
    end === null ||
    isInsideExcludedContent(start) ||
    isInsideExcludedContent(end)
  ) {
    return null;
  }
  const startContainer = start.closest(CHATGPT_SELECTORS.messageContainers);
  const endContainer = end.closest(CHATGPT_SELECTORS.messageContainers);
  const text = normalizeText(selection.toString());
  if (startContainer === null || startContainer !== endContainer || text.length === 0) {
    return null;
  }
  return { container: startContainer, text };
}

function isHidden(element: Element): boolean {
  for (let current: Element | null = element; current !== null; current = current.parentElement) {
    if (current.hasAttribute("hidden") || current.getAttribute("aria-hidden") === "true") {
      return true;
    }

    const inlineStyle = (current as HTMLElement).style;
    if (inlineStyle !== undefined) {
      if (inlineStyle.display === "none" || inlineStyle.visibility === "hidden") {
        return true;
      }
      if (current.isConnected) {
        const style = current.ownerDocument.defaultView?.getComputedStyle(current);
        if (style?.display === "none" || style?.visibility === "hidden") {
          return true;
        }
      }
    }
  }
  return false;
}

function isExcludedContent(element: Element): boolean {
  return element.matches(CHATGPT_SELECTORS.excludedContent) || isHidden(element);
}

function isInsideExcludedContent(element: Element): boolean {
  return (
    element.closest("button, [data-testid*='copy'], [data-testid*='feedback']") !== null ||
    isHidden(element)
  );
}

function imageSource(image: Element): string | null {
  const htmlImage = image as HTMLImageElement;
  const declaredSource = image.getAttribute("src")?.trim() ?? "";
  const declaredSourceSet = image.getAttribute("srcset")?.trim() ?? "";
  if (declaredSource.length === 0 && declaredSourceSet.length === 0) return null;

  const selectedSource = htmlImage.currentSrc.trim();
  if (selectedSource.length > 0) return selectedSource;
  if (declaredSource.length > 0) return htmlImage.src || declaredSource;

  const firstSourceSetCandidate = declaredSourceSet
    .split(",", 1)[0]
    ?.trim()
    .split(/\s+/, 1)[0];
  if (!firstSourceSetCandidate) return null;
  try {
    return new URL(firstSourceSetCandidate, image.ownerDocument.baseURI).href;
  } catch {
    return firstSourceSetCandidate;
  }
}

function conversationId(url: URL): string | null {
  const match = url.pathname.match(/^\/c\/([^/?#]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function extractChatGptConversation(
  document: Document,
  url: URL,
): ChatGptExtraction {
  const root = document.querySelector(CHATGPT_SELECTORS.conversationRoot);
  const containers = root
    ? [...root.querySelectorAll(CHATGPT_SELECTORS.messageContainers)]
    : [];
  const selectedContext = selectionContext(document);
  const messages: CapturedMessage[] = [];
  const images: ChatGptImage[] = [];
  const derivedMessageOrdinals: number[] = [];
  const duplicateMessageIds: string[] = [];
  const emptyMessageOrdinals: number[] = [];
  const unsupportedRoles: string[] = [];
  const usedMessageIds = new Set<string>();
  let selectionMessageId: string | null = null;

  for (const container of containers) {
    if (isHiddenOrNestedMessage(container)) continue;
    const role = roleFor(container);
    if (role === null) {
      unsupportedRoles.push(
        container.getAttribute("data-message-author-role")?.trim() || "unknown",
      );
      continue;
    }
    const ordinal = messages.length;
    const text = visibleText(container);
    const stableId = stableMessageId(container, role, ordinal, text);
    const duplicatePageId = usedMessageIds.has(stableId.id);
    if (duplicatePageId) duplicateMessageIds.push(stableId.id);
    const externalMessageId = duplicatePageId
      ? `derived-${role}-${ordinal}-${textHash(text)}`
      : stableId.id;
    usedMessageIds.add(externalMessageId);
    if (stableId.derived || duplicatePageId) derivedMessageOrdinals.push(ordinal);
    const messageImages = [
      ...container.querySelectorAll(CHATGPT_SELECTORS.images),
    ].filter(
      (image) =>
        !isHidden(image) &&
        !image.matches(CHATGPT_SELECTORS.presentationImages) &&
        image.closest(CHATGPT_SELECTORS.excludedImages) === null &&
        image.closest(CHATGPT_SELECTORS.messageContainers) === container,
    );
    if (text.length === 0 && messageImages.length === 0) {
      emptyMessageOrdinals.push(ordinal);
    }
    messages.push({ externalMessageId, ordinal, role, text });
    if (container === selectedContext?.container) selectionMessageId = externalMessageId;

    for (const image of messageImages) {
      images.push({
        alt: normalizeText(image.getAttribute("alt") ?? ""),
        height: numericAttribute(image, "height"),
        messageExternalId: externalMessageId,
        messageOrdinal: ordinal,
        src: imageSource(image),
        width: numericAttribute(image, "width"),
      });
    }
  }

  const pageTitle = normalizeText(document.title);
  const generatingRoot = root ?? document.documentElement;
  return {
    duplicateMessageIds,
    emptyMessageOrdinals,
    derivedMessageOrdinals,
    externalRef: conversationId(url),
    generatingResponse: [
      ...generatingRoot.querySelectorAll(CHATGPT_SELECTORS.generatingResponse),
    ].some((element) => !isHidden(element)),
    images,
    messages,
    selectionMessageId,
    selectionText: selectedContext?.text ?? null,
    title: (pageTitle || "ChatGPT conversation").slice(0, 500),
    unsupportedRoles,
  };
}

function requireExternalRef(extraction: ChatGptExtraction): string {
  if (extraction.externalRef === null) {
    throw new UnsupportedChatGptScopeStateError("ChatGPT conversation id is unavailable");
  }
  return extraction.externalRef;
}

function imagesForMessages(extraction: ChatGptExtraction, messages: CapturedMessage[]) {
  const ids = new Set(messages.map((message) => message.externalMessageId));
  return extraction.images.filter((image) => ids.has(image.messageExternalId));
}

function scopedExternalRef(
  conversationRef: string,
  scope: "full_conversation" | "qa_pair" | "selection",
  messages: CapturedMessage[],
  rawText: string,
): string {
  if (scope === "full_conversation") return conversationRef;
  const identity = messages.map((message) => message.externalMessageId).join(":");
  return `${conversationRef}:${scope}:${textHash(`${identity}\n${rawText}`)}`;
}

export function selectChatGptScope(
  extraction: ChatGptExtraction,
  scope: "full_conversation" | "qa_pair" | "selection",
  selectedText: string,
): ScopedChatGptCapture {
  const externalRef = requireExternalRef(extraction);
  let messages: CapturedMessage[];
  let rawText = "";

  if (scope === "full_conversation") {
    if (extraction.messages.length === 0) {
      throw new UnsupportedChatGptScopeStateError("No ChatGPT messages are available");
    }
    messages = [...extraction.messages];
  } else if (scope === "qa_pair") {
    const assistantIndex = extraction.messages.findLastIndex(
      (message) => message.role === "assistant",
    );
    const userIndex = extraction.messages
      .slice(0, assistantIndex)
      .findLastIndex((message) => message.role === "user");
    if (assistantIndex < 0 || userIndex < 0) {
      throw new UnsupportedChatGptScopeStateError("No complete question and answer pair is available");
    }
    messages = [extraction.messages[userIndex]!, extraction.messages[assistantIndex]!];
  } else {
    rawText = normalizeText(selectedText);
    if (rawText.length === 0) {
      throw new UnsupportedChatGptScopeStateError("Selected text is empty");
    }
    const containing = extraction.selectionMessageId
      ? extraction.messages.find(
          (message) => message.externalMessageId === extraction.selectionMessageId,
        )
      : undefined;
    if (!containing) {
      throw new UnsupportedChatGptScopeStateError("Selected text is not inside an extracted message");
    }
    if (
      extraction.selectionText === null ||
      rawText !== extraction.selectionText ||
      !normalizeForContainment(containing.text).includes(
        normalizeForContainment(rawText),
      )
    ) {
      throw new UnsupportedChatGptScopeStateError(
        "Selected text does not match the active DOM selection",
      );
    }
    messages = [{ ...containing, text: rawText }];
  }

  const scopedRawText =
    scope === "selection"
      ? rawText
      : messages.map((message) => message.text).join("\n\n");

  return {
    externalRef: scopedExternalRef(externalRef, scope, messages, scopedRawText),
    images:
      scope === "selection" ? [] : imagesForMessages(extraction, messages),
    messages,
    rawText: scopedRawText,
    title: extraction.title,
  };
}
