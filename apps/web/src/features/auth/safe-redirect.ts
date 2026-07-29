export function toSafeLocalPath(value: string | null) {
  if (!value) {
    return "/";
  }

  let decodedValue: string;
  try {
    decodedValue = decodeURIComponent(value);
  } catch {
    return "/";
  }

  if (
    !decodedValue.startsWith("/") ||
    decodedValue.startsWith("//") ||
    decodedValue.includes("\\")
  ) {
    return "/";
  }

  const baseUrl = new URL("https://recall.local");
  const targetUrl = new URL(value, baseUrl);

  if (targetUrl.origin !== baseUrl.origin) {
    return "/";
  }

  return `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
}
