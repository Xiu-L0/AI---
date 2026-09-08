import { testFixtureOrigin } from "../chatgpt/origins";

const XIAOHONGSHU_ORIGIN = "https://www.xiaohongshu.com";
const NOTE_PATH = /^\/(?:explore|discovery\/item)\/([^/?#]+)$/;

function parsedUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function decodeNoteId(raw: string): string | null {
  try {
    const decoded = decodeURIComponent(raw).trim();
    return decoded.length > 0 && decoded.length <= 500 ? decoded : null;
  } catch {
    return null;
  }
}

export function xiaohongshuMatchPatterns(
  configured = import.meta.env.WXT_TEST_FIXTURE_ORIGIN,
  testBuild = import.meta.env.WXT_TEST_BUILD === "1",
): string[] {
  const fixtureOrigin = testFixtureOrigin(configured, testBuild);
  return [
    `${XIAOHONGSHU_ORIGIN}/*`,
    ...(fixtureOrigin === null ? [] : [`${fixtureOrigin}/*`]),
  ];
}

export function isSupportedXiaohongshuUrl(
  value: string,
  configured = import.meta.env.WXT_TEST_FIXTURE_ORIGIN,
  testBuild = import.meta.env.WXT_TEST_BUILD === "1",
): boolean {
  const url = parsedUrl(value);
  if (url === null) return false;
  const fixtureOrigin = testFixtureOrigin(configured, testBuild);
  return (
    url.origin === XIAOHONGSHU_ORIGIN ||
    (fixtureOrigin !== null && url.origin === fixtureOrigin)
  );
}

export function xiaohongshuNoteId(
  value: string,
  configured = import.meta.env.WXT_TEST_FIXTURE_ORIGIN,
  testBuild = import.meta.env.WXT_TEST_BUILD === "1",
): string | null {
  const url = parsedUrl(value);
  if (url === null || !isSupportedXiaohongshuUrl(value, configured, testBuild)) {
    return null;
  }
  if (url.origin === XIAOHONGSHU_ORIGIN && url.protocol !== "https:") {
    return null;
  }
  const match = url.pathname.match(NOTE_PATH);
  if (!match?.[1]) return null;
  return decodeNoteId(match[1]);
}

export function xiaohongshuCanonicalUrl(
  value: string,
  configured = import.meta.env.WXT_TEST_FIXTURE_ORIGIN,
  testBuild = import.meta.env.WXT_TEST_BUILD === "1",
): string | null {
  const noteId = xiaohongshuNoteId(value, configured, testBuild);
  const url = parsedUrl(value);
  if (noteId === null || url === null) return null;
  if (url.origin === XIAOHONGSHU_ORIGIN) {
    const path = url.pathname.startsWith("/discovery/item/")
      ? `/discovery/item/${noteId}`
      : `/explore/${noteId}`;
    return `${XIAOHONGSHU_ORIGIN}${path}`;
  }
  return `${url.origin}${url.pathname}`;
}
