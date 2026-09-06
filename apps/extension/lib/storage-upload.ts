import {
  UploadTargetSchema,
  type UploadedAttachment,
  type UploadTarget,
} from "@recall/contracts";

export type StorageUploadDependencies = {
  fetch?: typeof globalThis.fetch;
  supabaseUrl?: string;
};

export class StorageUploadError extends Error {
  readonly status: number;

  constructor(status: number, message?: string) {
    super(message ?? `Signed upload failed with HTTP ${status}`);
    this.name = "StorageUploadError";
    this.status = status;
  }
}

function usesSecureTransport(url: URL): boolean {
  return (
    url.protocol === "https:" ||
    (url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  );
}

function supabaseOrigin(override?: string): string {
  const configured =
    override ??
    import.meta.env.WXT_PUBLIC_SUPABASE_URL ??
    "http://127.0.0.1:55321";

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("Supabase URL must be an HTTP(S) base origin");
  }

  if (
    !usesSecureTransport(url) ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.search.length > 0 ||
    url.hash.length > 0 ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    throw new Error(
      "Supabase URL must use HTTPS, except for local development",
    );
  }

  return url.origin;
}

function encodeStoragePath(storagePath: string): string {
  return storagePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function signedUploadUrl(origin: string, target: UploadTarget): URL {
  const encodedPath = encodeStoragePath(target.storagePath);
  const url = new URL(
    `/storage/v1/object/upload/sign/raw-captures/${encodedPath}`,
    `${origin}/`,
  );
  url.searchParams.set("token", target.token);
  return url;
}

export async function uploadToSignedTarget(
  target: UploadTarget,
  blob: Blob,
  dependencies: StorageUploadDependencies = {},
): Promise<UploadedAttachment> {
  const parsedTarget = UploadTargetSchema.safeParse(target);
  if (!parsedTarget.success) {
    throw new StorageUploadError(0, "Signed upload target is invalid");
  }
  if (!(blob instanceof Blob)) {
    throw new StorageUploadError(0, "Signed upload body is invalid");
  }

  const form = new FormData();
  form.append("cacheControl", "3600");
  form.append("", blob);
  const url = signedUploadUrl(
    supabaseOrigin(dependencies.supabaseUrl),
    parsedTarget.data,
  );

  let response: Response;
  try {
    response = await (dependencies.fetch ?? globalThis.fetch)(
      url,
      {
        body: form,
        headers: new Headers({ "x-upsert": "false" }),
        method: "PUT",
      },
    );
  } catch {
    throw new StorageUploadError(0, "Signed upload network request failed");
  }

  if (!response.ok) {
    throw new StorageUploadError(response.status);
  }

  const etag = response.headers.get("etag")?.trim();
  return {
    clientId: parsedTarget.data.clientId,
    storagePath: parsedTarget.data.storagePath,
    ...(etag ? { etag } : {}),
  };
}
