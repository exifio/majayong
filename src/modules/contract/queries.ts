/**
 * B-08: 읽기 전용 내 계약 목록·상세 조회 서비스.
 *
 * 표시 상태(서명 대기·예치 대기 등)는 C의 결제/검수 상태가 필요하므로
 * B는 저장 계약 record와 당사자 접근 권한까지만 제공한다.
 */
import {
  ContractError,
  type ContractActor,
  type ContractRecord,
} from './lifecycle.js';

export interface ContractReadPort {
  listForUser(input: {
    readonly userId: string;
    readonly role: 'CLIENT' | 'SUPPLIER';
  }): Promise<readonly ContractRecord[]>;
  findById(contractId: string): Promise<ContractRecord | null>;
}

function isParty(contract: ContractRecord, actor: ContractActor): boolean {
  return actor.userId === contract.clientUserId || actor.userId === contract.supplierId;
}

function contractNotFound(): ContractError {
  return new ContractError(404, 'CONTRACT_NOT_FOUND', '계약을 찾을 수 없습니다.');
}

/** `GET /me/contracts`: 내가 당사자인 계약을 서명 기한 최신 순으로. */
export async function listMyContracts(
  port: ContractReadPort,
  input: { readonly actor: ContractActor },
): Promise<readonly ContractRecord[]> {
  if (input.actor.role === 'ADMIN') return [];

  const rows = await port.listForUser({
    userId: input.actor.userId,
    role: input.actor.role,
  });
  return rows
    .filter((contract) => isParty(contract, input.actor))
    .sort(
      (a, b) =>
        b.consentDeadline.getTime() - a.consentDeadline.getTime() ||
        a.id.localeCompare(b.id),
    );
}

/** `GET /contracts/{id}`: 비당사자에게는 존재 여부를 숨긴다. */
export async function getContractDetail(
  port: ContractReadPort,
  input: { readonly actor: ContractActor; readonly contractId: string },
): Promise<ContractRecord> {
  const contract = await port.findById(input.contractId);
  if (contract === null || !isParty(contract, input.actor)) throw contractNotFound();
  return contract;
}
