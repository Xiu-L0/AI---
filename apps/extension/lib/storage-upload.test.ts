import { describe, expect, it, vi } from "vitest";

import {
  StorageUploadError,
  uploadToSignedTarget,
} from "./storage-upload";

const target = {
  clientId: "image-1",
  storagePath: "owner id/capture-1/folder/截图 #1.png",
  token: "signed+token/with?reserved=characters",
};

describe("uploadToSignedTarget", () => {
  it("uploads a Blob to the exact signed Supabase Storage target", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ Key: "raw-captures/path" }), {
        headers: { ETag: '"etag-1"' },
        status: 200,
      }),
    );
    const blob = new Blob(["synthetic image"], { type: "image/png" });

    await expect(
      uploadToSignedTarget(target, blob, {
        fetch: fetchImplementation,
        supabaseUrl: "https://project-ref.supabase.co",
      }),
    ).resolves.toEqual({
      clientId: "image-1",
      etag: '"etag-1"',
      storagePath: target.storagePath,
    });

    const [requestUrl, requestInit] = fetchImplementation.mock.calls[0] ?? [];
    const url = new URL(String(requestUrl));
    expect(url.origin).toBe("https://project-ref.supabase.co");
    expect(url.pathname).toBe(
      "/storage/v1/object/upload/sign/raw-captures/owner%20id/capture-1/folder/%E6%88%AA%E5%9B%BE%20%231.png",
    );
    expect(url.searchParams.get("token")).toBe(target.token);
    expect(requestInit?.method).toBe("PUT");

    const headers = new Headers(requestInit?.headers);
    expect(headers.get("x-upsert")).toBe("false");
    expect(headers.has("content-type")).toBe(false);

    const body = requestInit?.body;
    expect(body).toBeInstanceOf(FormData);
    const form = body as FormData;
    expect(form.get("cacheControl")).toBe("3600");
    const uploadedBlob = form.get("");
    expect(uploadedBlob).toBeInstanceOf(Blob);
    expect((uploadedBlob as Blob).size).toBe(blob.size);
    expect((uploadedBlob as Blob).type).toBe("image/png");
  });

  it("omits an ETag when the response does not expose one", async () => {
    await expect(
      uploadToSignedTarget(
        { ...target, storagePath: "owner/capture/file.png" },
        new Blob(["image"], { type: "image/png" }),
        {
          fetch: vi.fn<typeof fetch>().mockResolvedValue(
            new Response(null, { status: 200 }),
          ),
          supabaseUrl: "http://127.0.0.1:54321/",
        },
      ),
    ).resolves.toEqual({
      clientId: "image-1",
      storagePath: "owner/capture/file.png",
    });
  });

  it("never includes the signed token in HTTP or network errors", async () => {
    const responseFailure = uploadToSignedTarget(
      target,
      new Blob(["image"], { type: "image/png" }),
      {
        fetch: vi.fn<typeof fetch>().mockResolvedValue(
          new Response(`failed for ${target.token}`, { status: 503 }),
        ),
        supabaseUrl: "https://project-ref.supabase.co",
      },
    );

    await expect(responseFailure).rejects.toEqual(
      expect.objectContaining<Partial<StorageUploadError>>({ status: 503 }),
    );
    await expect(responseFailure).rejects.not.toThrow(target.token);

    const networkFailure = uploadToSignedTarget(
      target,
      new Blob(["image"], { type: "image/png" }),
      {
        fetch: vi.fn<typeof fetch>().mockRejectedValue(
          new Error(`request leaked ${target.token}`),
        ),
        supabaseUrl: "https://project-ref.supabase.co",
      },
    );

    await expect(networkFailure).rejects.toEqual(
      expect.objectContaining<Partial<StorageUploadError>>({ status: 0 }),
    );
    await expect(networkFailure).rejects.not.toThrow(target.token);
  });

  it("rejects a Supabase URL that is not a base HTTP origin", async () => {
    await expect(
      uploadToSignedTarget(
        target,
        new Blob(["image"], { type: "image/png" }),
        { supabaseUrl: "https://project-ref.supabase.co/storage/v1" },
      ),
    ).rejects.toThrow("Supabase URL must use HTTPS");
  });

  it("rejects plaintext remote Supabase origins", async () => {
    await expect(
      uploadToSignedTarget(
        target,
        new Blob(["image"], { type: "image/png" }),
        { supabaseUrl: "http://project-ref.supabase.co" },
      ),
    ).rejects.toThrow("Supabase URL must use HTTPS");
  });
});
