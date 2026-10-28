import { createClient } from "@supabase/supabase-js";
import { createSupabaseContractStorage } from "../trade/supabase-contract-storage.ts";
import type { ContractStorage } from "../trade/contract-workflow.ts";
import { TradeError } from "../trade/errors.ts";

export function createContractStorage(env: NodeJS.ProcessEnv = process.env): ContractStorage {
  const url = env.SUPABASE_URL?.trim();
  const secretKey = env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !secretKey) {
    return {
      uploadPrivateObject: async () => {
        throw new TradeError("CONTRACT_PDF_UPLOAD_FAILED");
      },
      createSignedUrl: async () => {
        throw new TradeError("CONTRACT_PDF_URL_FAILED");
      },
    };
  }

  const client = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  return createSupabaseContractStorage(client);
}
