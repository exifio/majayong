import type { ContractConsent } from './contract.js';
import { recordContractSignature } from './contract.js';
import { TradeError } from './errors.js';

export type ContractActor = {
  userId: string;
  role: 'CLIENT' | 'SUPPLIER' | 'ADMIN';
  sessionId?: string;
};

export type ContractParticipants = { clientId: string; supplierId: string };
export type ContractRecord = ContractConsent & {
  id: string;
  applicationId: string;
  pdfUrl: string | null;
};
export type ContractSignatureFields = Pick<
  ContractConsent,
  'status' | 'contentHash' | 'clientSignedAt' | 'supplierSignedAt'
>;
export type ContractSignedAction = {
  type: 'CONTRACT_SIGNED';
  actorUserId: string;
  sessionId: string | null;
};

export interface ContractStorage {
  uploadPrivateObject(input: {
    bucket: string;
    path: string;
    bytes: Uint8Array;
    contentType: 'application/pdf';
    upsert: true;
  }): Promise<void>;
  createSignedUrl(input: {
    bucket: string;
    path: string;
    expiresInSeconds: number;
    download: true;
  }): Promise<string>;
}

export interface ContractWorkflowPorts<Tx> {
  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T>;
  getAcceptedApplicationContext(tx: Tx, applicationId: string): Promise<ContractParticipants>;
  getContractParticipants(tx: Tx, applicationId: string): Promise<ContractParticipants | null>;
  findContractForUpdate(tx: Tx, applicationId: string): Promise<ContractRecord | null>;
  findContract(tx: Tx, applicationId: string): Promise<ContractRecord | null>;
  updateContractSignature(
    tx: Tx,
    contractId: string,
    fields: ContractSignatureFields,
  ): Promise<ContractRecord>;
  transitionProjectForContract(
    tx: Tx,
    applicationId: string,
    action: ContractSignedAction,
  ): Promise<unknown>;
}

export function createContractWorkflow<Tx>(
  ports: ContractWorkflowPorts<Tx>,
  storage: ContractStorage,
  now: () => Date = () => new Date(),
) {
  return {
    async sign(input: {
      applicationId: string;
      actor: ContractActor;
      contentHash: string;
    }): Promise<ContractRecord> {
      return ports.transaction(async (tx) => {
        const participants = await ports.getAcceptedApplicationContext(tx, input.applicationId);
        const party = authorizedParty(input.actor, participants);
        // The adapter must lock this contract row before returning it; the signature and A transition share this transaction.
        const contract = await ports.findContractForUpdate(tx, input.applicationId);
        if (!contract) throw new TradeError('CONTRACT_NOT_FOUND');
        if (!hasStoredPdf(contract)) throw new TradeError('CONTRACT_PDF_NOT_READY');

        const next = recordContractSignature(contract, {
          party,
          contentHash: input.contentHash,
          signedAt: now(),
        });
        const updated = await ports.updateContractSignature(tx, contract.id, next);
        if (next.status === 'ACTIVE') {
          await ports.transitionProjectForContract(tx, input.applicationId, {
            type: 'CONTRACT_SIGNED',
            actorUserId: input.actor.userId,
            sessionId: input.actor.sessionId ?? null,
          });
        }
        return updated;
      });
    },
    async getPdfDownloadUrl(actor: ContractActor, applicationId: string, bucket: string): Promise<string> {
      const path = await ports.transaction(async (tx) => {
        const participants = await ports.getContractParticipants(tx, applicationId);
        if (!participants) throw new TradeError('CONTRACT_NOT_FOUND');
        authorizedParty(actor, participants);

        const contract = await ports.findContract(tx, applicationId);
        if (!contract) throw new TradeError('CONTRACT_NOT_FOUND');
        if (
          contract.status === 'PENDING_CONSENT' ||
          contract.clientSignedAt === null ||
          contract.supplierSignedAt === null ||
          !hasStoredPdf(contract)
        ) {
          throw new TradeError('CONTRACT_NOT_SIGNED');
        }
        return contract.pdfUrl;
      });
      return storage.createSignedUrl({ bucket, path, expiresInSeconds: 300, download: true });
    },
  };
}

function authorizedParty(actor: ContractActor, participants: ContractParticipants): 'CLIENT' | 'SUPPLIER' {
  if (actor.role === 'CLIENT' && actor.userId === participants.clientId) return 'CLIENT';
  if (actor.role === 'SUPPLIER' && actor.userId === participants.supplierId) return 'SUPPLIER';
  throw new TradeError('CONTRACT_SIGNING_FORBIDDEN');
}

function hasStoredPdf(
  contract: ContractRecord,
): contract is ContractRecord & { contentHash: string; pdfUrl: string } {
  const path = contract.pdfUrl;
  const hash = contract.contentHash;
  return hash !== null && /^sha256:[0-9a-f]{64}$/.test(hash) &&
    path === `contracts/${contract.id}/${hash.slice(7)}.pdf`;
}
