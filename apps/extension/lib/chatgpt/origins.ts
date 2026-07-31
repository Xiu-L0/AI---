const CHATGPT_ORIGIN = "https://chatgpt.com";

function exactLoopbackOrigin(value: string | undefined): string | null {
  if (value === undefined || value.trim().length === 0) return null;
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      (url.pathname !== "" && url.pathname !== "/") ||
      url.search.length > 0 ||
      url.hash.length > 0 ||
      url.username.length > 0 ||
      url.password.length > 0
    ) {
      return null;
    }
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function testFixtureOrigin(
  configured = import.meta.env.WXT_TEST_FIXTURE_ORIGIN,
  testBuild = import.meta.env.WXT_TEST_BUILD === "1",
): string | null {
  return testBuild ? exactLoopbackOrigin(configured) : null;
}

export function chatGptMatchPatterns(
  configured = import.meta.env.WXT_TEST_FIXTURE_ORIGIN,
  testBuild = import.meta.env.WXT_TEST_BUILD === "1",
): string[] {
  const fixtureOrigin = testFixtureOrigin(configured, testBuild);
  return [
    `${CHATGPT_ORIGIN}/*`,
    ...(fixtureOrigin === null ? [] : [`${fixtureOrigin}/*`]),
  ];
}

export function isSupportedChatGptUrl(
  value: string,
  configured = import.meta.env.WXT_TEST_FIXTURE_ORIGIN,
  testBuild = import.meta.env.WXT_TEST_BUILD === "1",
): boolean {
  try {
    const origin = new URL(value).origin;
    return origin === CHATGPT_ORIGIN || origin === testFixtureOrigin(configured, testBuild);
  } catch {
    return false;
  }
}

export function chatGptConversationRef(
  value: string,
  configured = import.meta.env.WXT_TEST_FIXTURE_ORIGIN,
  testBuild = import.meta.env.WXT_TEST_BUILD === "1",
): string | null {
  if (!isSupportedChatGptUrl(value, configured, testBuild)) return null;
  try {
    const match = new URL(value).pathname.match(/^\/c\/([^/?#]+)/);
    if (!match?.[1]) return null;
    const decoded = decodeURIComponent(match[1]).trim();
    return decoded.length > 0 && decoded.length <= 500 ? decoded : null;
  } catch {
    return null;
  }
}
