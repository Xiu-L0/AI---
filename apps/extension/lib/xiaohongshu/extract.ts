import {
  xiaohongshuCanonicalUrl,
  xiaohongshuNoteId,
} from "./origins";

export type XiaohongshuImage = {
  alt: string;
  src: string | null;
};

export type XiaohongshuExtraction = {
  author: string | null;
  body: string;
  canonicalUrl: string;
  declaredImageCount: number;
  externalRef: string;
  hasVideo: boolean;
  images: XiaohongshuImage[];
  title: string;
};

const COMMENT_SELECTOR = "[data-testid*='comment' i], [aria-label*='评论']";
const EXCLUDED_CONTENT_SELECTOR =
  "script, style, button, nav, noscript, [hidden], [aria-hidden='true']";

function normalizeText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function metaContent(document: Document, selector: string): string | null {
  const value = document.querySelector(selector)?.getAttribute("content");
  const normalized = value ? normalizeText(value) : "";
  return normalized.length > 0 ? normalized : null;
}

function parseJsonLd(document: Document): Record<string, unknown>[] {
  return [...document.querySelectorAll("script[type='application/ld+json']")]
    .flatMap((script) => {
      try {
        const parsed: unknown = JSON.parse(script.textContent ?? "");
        if (Array.isArray(parsed)) return parsed;
        if (parsed && typeof parsed === "object" && "@graph" in parsed) {
          const graph = (parsed as { "@graph": unknown })["@graph"];
          return Array.isArray(graph) ? graph : [parsed];
        }
        return parsed && typeof parsed === "object" ? [parsed] : [];
      } catch {
        return [];
      }
    })
    .filter(
      (value): value is Record<string, unknown> =>
        typeof value === "object" && value !== null,
    );
}

function jsonLdText(
  records: readonly Record<string, unknown>[],
  key: string,
): string | null {
  for (const record of records) {
    const value = record[key];
    if (typeof value === "string" && normalizeText(value).length > 0) {
      return normalizeText(value);
    }
  }
  return null;
}

function jsonLdAuthor(records: readonly Record<string, unknown>[]): string | null {
  for (const record of records) {
    const author = record.author;
    if (typeof author === "string" && normalizeText(author).length > 0) {
      return normalizeText(author);
    }
    if (author && typeof author === "object" && "name" in author) {
      const name = (author as { name?: unknown }).name;
      if (typeof name === "string" && normalizeText(name).length > 0) {
        return normalizeText(name);
      }
    }
  }
  return null;
}

function jsonLdImages(records: readonly Record<string, unknown>[]): string[] {
  const images: string[] = [];
  for (const record of records) {
    const value = record.image;
    const entries = Array.isArray(value) ? value : [value];
    for (const entry of entries) {
      if (typeof entry === "string") {
        images.push(entry);
      } else if (entry && typeof entry === "object" && "url" in entry) {
        const url = (entry as { url?: unknown }).url;
        if (typeof url === "string") images.push(url);
      }
    }
  }
  return images;
}

function headingIsComments(element: Element): boolean {
  const heading = element.matches("h1, h2, h3, h4, h5, h6")
    ? element
    : element.querySelector("h1, h2, h3, h4, h5, h6");
  return heading !== null && normalizeText(heading.textContent ?? "") === "评论";
}

function isCommentContainer(element: Element): boolean {
  return element.matches(COMMENT_SELECTOR) || headingIsComments(element);
}

function hasCommentAncestor(element: Element): boolean {
  let current: Element | null = element;
  while (current) {
    if (isCommentContainer(current)) return true;
    current = current.parentElement;
  }
  return false;
}

function isExcludedImage(image: HTMLImageElement): boolean {
  if (hasCommentAncestor(image)) return true;
  if (image.closest("button, nav, header, script")) return true;
  const alt = normalizeText(image.getAttribute("alt") ?? "").toLowerCase();
  const src = (image.getAttribute("src") ?? "").toLowerCase();
  if (
    alt.includes("avatar") ||
    alt.includes("头像") ||
    src.includes("avatar") ||
    alt.includes("emoji") ||
    alt.includes("qr") ||
    alt.includes("二维码")
  ) {
    return true;
  }
  const width = Number(image.getAttribute("width") ?? image.width);
  const height = Number(image.getAttribute("height") ?? image.height);
  if (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0 &&
    width <= 24 &&
    height <= 24
  ) {
    return true;
  }
  return false;
}

function readableImageUrl(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 10_000) return null;
  if (!/^https:/i.test(trimmed) && !/^data:image\//i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    url.hash = "";
    return url.toString();
  } catch {
    return /^data:image\//i.test(trimmed) ? trimmed : null;
  }
}

function articleBody(article: Element): string {
  const clone = article.cloneNode(true) as Element;
  for (const node of clone.querySelectorAll(
    `${EXCLUDED_CONTENT_SELECTOR}, ${COMMENT_SELECTOR}, video`,
  )) {
    node.remove();
  }
  for (const node of [...clone.querySelectorAll("h1, h2, h3, h4, h5, h6")]) {
    if (headingIsComments(node) && node.parentElement) {
      node.parentElement.remove();
    }
  }
  return normalizeText(clone.textContent ?? "");
}

function visibleArticleImages(article: Element | null): XiaohongshuImage[] {
  if (article === null) return [];
  return [...article.querySelectorAll("img")].flatMap((image) => {
    if (image.tagName !== "IMG" || isExcludedImage(image as HTMLImageElement)) {
      return [];
    }
    const img = image as HTMLImageElement;
    return [
      {
        alt: normalizeText(image.getAttribute("alt") ?? "").slice(0, 2_000),
        src: readableImageUrl(image.getAttribute("src")),
      },
    ];
  });
}

function mergeImages(
  declaredUrls: readonly string[],
  visible: readonly XiaohongshuImage[],
): XiaohongshuImage[] {
  const merged: XiaohongshuImage[] = [];
  const seen = new Set<string>();

  function remember(image: XiaohongshuImage) {
    if (image.src !== null) {
      if (seen.has(image.src)) return;
      seen.add(image.src);
    }
    merged.push(image);
  }

  for (const url of declaredUrls) {
    const normalized = readableImageUrl(url);
    if (normalized === null) {
      remember({ alt: "", src: null });
      continue;
    }
    const visibleMatch = visible.find((image) => image.src === normalized);
    remember({
      alt: visibleMatch?.alt ?? "",
      src: normalized,
    });
  }

  for (const image of visible) {
    remember(image);
  }

  return merged;
}

export function extractCurrentXiaohongshuPage(
  document: Document,
  url: URL,
): XiaohongshuExtraction {
  const externalRef = xiaohongshuNoteId(url.href);
  if (externalRef === null) {
    throw new Error("当前页面不是可采集的小红书笔记");
  }

  const jsonLd = parseJsonLd(document);
  const canonicalHref = document
    .querySelector("link[rel='canonical']")
    ?.getAttribute("href");
  const canonicalFromLink = canonicalHref
    ? xiaohongshuCanonicalUrl(canonicalHref)
    : null;
  const canonicalUrl =
    canonicalFromLink !== null &&
    xiaohongshuNoteId(canonicalFromLink) === externalRef
      ? canonicalFromLink
      : xiaohongshuCanonicalUrl(url.href) ??
        `https://www.xiaohongshu.com/explore/${externalRef}`;

  const title =
    metaContent(document, "meta[property='og:title']") ??
    (() => {
      const heading = normalizeText(
        document.querySelector("h1")?.textContent ?? "",
      );
      return heading.length > 0 ? heading : null;
    })();
  const author =
    jsonLdAuthor(jsonLd) ?? metaContent(document, "meta[name='author']");
  const article = document.querySelector("article");
  const body =
    jsonLdText(jsonLd, "description") ??
    metaContent(document, "meta[property='og:description']") ??
    (article ? articleBody(article) : "");

  const declaredUrls = [
    ...jsonLdImages(jsonLd),
    ...[...document.querySelectorAll("meta[property='og:image']")].map(
      (meta) => meta.getAttribute("content") ?? "",
    ),
  ];
  const uniqueDeclared = [
    ...new Set(
      declaredUrls
        .map((value) => readableImageUrl(value))
        .filter((value): value is string => value !== null),
    ),
  ];
  const images = mergeImages(uniqueDeclared, visibleArticleImages(article));
  const hasVideo =
    article?.querySelector("video, [aria-label*='视频']") !== null ||
    document.querySelector("article video, article [aria-label*='视频']") !==
      null;

  return {
    author,
    body,
    canonicalUrl,
    declaredImageCount: uniqueDeclared.length,
    externalRef,
    hasVideo,
    images,
    title: (title ?? "小红书笔记").slice(0, 500),
  };
}
