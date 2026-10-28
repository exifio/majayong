import type { ContractStorage } from './contract-workflow.ts';
import { TradeError } from './errors.ts';

export interface SupabaseStorageClient {
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        bytes: Uint8Array,
        options: { contentType: 'application/pdf'; upsert: true },
      ): Promise<{ error: Error | null }>;
      createSignedUrl(
        path: string,
        expiresInSeconds: number,
        options: { download: true },
      ): Promise<{ data: { signedUrl: string } | null; error: Error | null }>;
    };
  };
}

export function createSupabaseContractStorage(client: SupabaseStorageClient): ContractStorage {
  return {
    uploadPrivateObject: async ({ bucket, path, bytes, contentType, upsert }) => {
      const { error } = await client.storage.from(bucket).upload(path, bytes, { contentType, upsert });
      if (error) throw new TradeError('CONTRACT_PDF_UPLOAD_FAILED');
    },
    createSignedUrl: async ({ bucket, path, expiresInSeconds, download }) => {
      const { data, error } = await client.storage.from(bucket).createSignedUrl(
        path,
        expiresInSeconds,
        { download },
      );
      if (error) throw new TradeError('CONTRACT_PDF_URL_FAILED');
      if (!data?.signedUrl) throw new TradeError('CONTRACT_PDF_URL_FAILED');
      return data.signedUrl;
    },
  };
}
