import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSupabaseStorageAdapter } from "../../src/integration/supabase-storage.ts";

describe("D-11: Supabase Storage 어댑터", () => {
  it("비공개 버킷의 서명 업로드/다운로드 URL을 만든다", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes("/object/upload/sign/")) {
        return new Response(JSON.stringify({ url: "/object/upload/sign/bucket/a%20b.txt?token=upload" }), { status: 200 });
      }
      return new Response(JSON.stringify({ signedURL: "/object/sign/bucket/a%20b.txt?token=download" }), { status: 200 });
    };
    const adapter = createSupabaseStorageAdapter({
      url: "https://project.supabase.co/",
      serviceRoleKey: "service-role",
      fetchImpl: fetcher,
    });

    const upload = await adapter.createUploadUrl("bucket", "folder/a b.txt", 300);
    assert.equal(upload.uploadUrl, "https://project.supabase.co/storage/v1/object/upload/sign/bucket/a%20b.txt?token=upload");
    assert.equal(upload.expiresInSec, 7_200);
    assert.equal(calls[0]?.url, "https://project.supabase.co/storage/v1/object/upload/sign/bucket/folder/a%20b.txt");
    assert.equal((calls[0]?.init?.headers as Record<string, string>).authorization, "Bearer service-role");

    const download = await adapter.createDownloadUrl("bucket", "folder/a b.txt", 180);
    assert.equal(download.downloadUrl, "https://project.supabase.co/storage/v1/object/sign/bucket/a%20b.txt?token=download");
    assert.equal(download.expiresInSec, 180);
    assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)), { expiresIn: 180 });
  });

  it("스토리지 실패는 503 오류로 드러낸다", async () => {
    const adapter = createSupabaseStorageAdapter({
      url: "https://project.supabase.co",
      serviceRoleKey: "service-role",
      fetchImpl: async () => new Response("{}", { status: 400 }),
    });
    await assert.rejects(
      () => adapter.createDownloadUrl("bucket", "key", 180),
      (error: unknown) => (error as { status?: number }).status === 503,
    );
  });
});
