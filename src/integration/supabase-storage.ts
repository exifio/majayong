/**
 * D-11: Supabase Storage 서명 URL 어댑터.
 *
 * 비공개 버킷에서 단일 객체 업로드/다운로드 URL만 발급한다. 서비스 롤 키는 서버에만 둔다.
 * Supabase의 signed upload URL은 공급자 고정 2시간 만료라 요청값(300초)과 다를 수 있다.
 */
import type { FileStorageAdapter } from "../modules/files/index.js";

export interface SupabaseStorageOptions {
  readonly url: string;
  readonly serviceRoleKey: string;
  readonly fetchImpl?: typeof fetch;
}

function storageError(message: string): Error {
  return Object.assign(new Error(message), { status: 503 });
}

export function createSupabaseStorageAdapter(options: SupabaseStorageOptions): FileStorageAdapter {
  const base = options.url.replace(/\/+$/, "");
  const fetcher = options.fetchImpl ?? fetch;
  const auth = {
    authorization: `Bearer ${options.serviceRoleKey}`,
    apikey: options.serviceRoleKey,
  };
  const encodeKey = (key: string): string => key.split("/").map(encodeURIComponent).join("/");

  return {
    async createUploadUrl(bucket, objectKey, _expiresInSec) {
      const response = await fetcher(
        `${base}/storage/v1/object/upload/sign/${encodeURIComponent(bucket)}/${encodeKey(objectKey)}`,
        {
          method: "POST",
          headers: { ...auth, "content-type": "application/json" },
          body: "{}",
        },
      );
      if (!response.ok) throw storageError(`STORAGE_UPLOAD_SIGN_FAILED:${response.status}`);
      const body = (await response.json()) as { url?: unknown };
      if (typeof body.url !== "string" || !body.url.startsWith("/")) {
        throw storageError("STORAGE_UPLOAD_SIGN_INVALID");
      }
      return { uploadUrl: `${base}/storage/v1${body.url}`, expiresInSec: 7_200 };
    },

    async createDownloadUrl(bucket, objectKey, expiresInSec) {
      const response = await fetcher(
        `${base}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${encodeKey(objectKey)}`,
        {
          method: "POST",
          headers: { ...auth, "content-type": "application/json" },
          body: JSON.stringify({ expiresIn: expiresInSec }),
        },
      );
      if (!response.ok) throw storageError(`STORAGE_DOWNLOAD_SIGN_FAILED:${response.status}`);
      const body = (await response.json()) as { signedURL?: unknown };
      if (typeof body.signedURL !== "string" || !body.signedURL.startsWith("/")) {
        throw storageError("STORAGE_DOWNLOAD_SIGN_INVALID");
      }
      return { downloadUrl: `${base}/storage/v1${body.signedURL}`, expiresInSec };
    },
  };
}
