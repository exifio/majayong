import type { ContractStatus } from './contract.js';
import { TradeError } from './errors.js';
import { assertWon } from './money.js';
import {
  decideCallback,
  planDeposit,
  type DepositStatus,
  type PaymentEventDraft,
  type PgCallback,
} from './payment.js';
import type { PaymentStatus } from './settlement.js';
import type { TossConfirmationRequest } from './toss-payments.js';

export type PaymentActor = {
  userId: string;
  role: 'CLIENT' | 'SUPPLIER' | 'ADMIN';
  sessionId?: string;
};

export type PaymentContract = {
  id: string;
  applicationId: string;
  status: ContractStatus;
  paymentStatus: PaymentStatus;
  agreedAmount: number;
  clientFee: number;
  totalDeposited: number;
  clientId: string;
  projectId: string | null;
};

export type DepositRecord = {
  id: string;
  contractId: string;
  principal: number;
  clientFee: number;
  amount: number;
  status: DepositStatus;
  idempotencyKey: string;
  pgKey: string | null;
  depositedAt: Date | null;
};

type StartContext = { contract: PaymentContract; deposits: DepositRecord[] };
type ConfirmationContext = { contract: PaymentContract; clientId: string; deposit: DepositRecord };

export interface PaymentWorkflowPorts<Tx> {
  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T>;
  findDepositStartContextForUpdate(tx: Tx, contractId: string): Promise<StartContext | null>;
  createDeposit(
    tx: Tx,
    input: Pick<DepositRecord, 'contractId' | 'principal' | 'clientFee' | 'amount' | 'idempotencyKey'>,
  ): Promise<DepositRecord>;
  recordPaymentEvents(tx: Tx, depositId: string, events: PaymentEventDraft[]): Promise<void>;
  findDepositConfirmationContext(
    tx: Tx,
    contractId: string,
    depositId: string,
  ): Promise<ConfirmationContext | null>;
  findDepositConfirmationContextForUpdate(
    tx: Tx,
    contractId: string,
    depositId: string,
  ): Promise<ConfirmationContext | null>;
  listPaymentEventDedupKeys(tx: Tx, depositId: string): Promise<string[]>;
  updateDeposit(
    tx: Tx,
    depositId: string,
    patch: Pick<DepositRecord, 'status' | 'pgKey' | 'depositedAt'>,
  ): Promise<DepositRecord>;
  updateContractPayment(
    tx: Tx,
    contractId: string,
    patch: { paymentStatus: 'DEPOSITED'; totalDeposited: number },
  ): Promise<void>;
  recordDepositEvent(
    tx: Tx,
    event: {
      type: 'PAYMENT_DEPOSITED';
      userId: string;
      sessionId: string | null;
      projectId: string | null;
      payload: { contractId: string; depositId: string; amount: number };
    },
  ): Promise<void>;
}

export function createPaymentWorkflow<Tx>(
  ports: PaymentWorkflowPorts<Tx>,
  confirmPayment: (input: TossConfirmationRequest) => Promise<PgCallback>,
  now: () => Date = () => new Date(),
) {
  return {
    startDeposit(input: {
      contractId: string;
      actor: PaymentActor;
      idempotencyKey: string;
    }): Promise<{
      depositId: string;
      orderId: string;
      amount: number;
      status: DepositStatus;
      paymentStatus: PaymentStatus;
      replayed: boolean;
    }> {
      return ports.transaction(async (tx) => {
        const context = await ports.findDepositStartContextForUpdate(tx, input.contractId);
        if (!context) throw new TradeError('CONTRACT_NOT_FOUND');
        assertClient(input.actor, context.contract.clientId);

        const plan = planDeposit(context.contract, context.deposits, input.idempotencyKey);
        if (plan.kind === 'EXISTING') {
          return {
            depositId: plan.deposit.id,
            orderId: plan.deposit.id,
            amount: plan.deposit.amount,
            status: plan.deposit.status,
            paymentStatus: context.contract.paymentStatus,
            replayed: true,
          };
        }
        if (context.contract.paymentStatus !== 'PENDING') throw new TradeError('DEPOSIT_ALREADY_OPEN');

        const deposit = await ports.createDeposit(tx, {
          contractId: context.contract.id,
          principal: plan.principal,
          clientFee: plan.clientFee,
          amount: plan.amount,
          idempotencyKey: plan.idempotencyKey,
        });
        await ports.recordPaymentEvents(tx, deposit.id, [{
          eventType: 'REQUESTED',
          dedupKey: null,
          resultNote: 'deposit requested',
        }]);
        return {
          depositId: deposit.id,
          orderId: deposit.id,
          amount: deposit.amount,
          status: deposit.status,
          paymentStatus: context.contract.paymentStatus,
          replayed: false,
        };
      });
    },

    async confirmDeposit(input: {
      contractId: string;
      depositId: string;
      actor: PaymentActor;
      paymentKey: string;
      orderId: string;
      returnedAmount: number;
    }): Promise<{
      depositStatus: DepositStatus;
      paymentStatus: PaymentStatus;
      creditedAmount: number;
      replayed: boolean;
    }> {
      const initial = await ports.transaction((tx) =>
        ports.findDepositConfirmationContext(tx, input.contractId, input.depositId),
      );
      if (!initial) throw new TradeError('DEPOSIT_NOT_FOUND');
      assertClient(input.actor, initial.clientId);
      if (input.orderId !== initial.deposit.id) throw new TradeError('PAYMENT_ORDER_ID_MISMATCH');
      if (initial.deposit.status !== 'PENDING') {
        return {
          depositStatus: initial.deposit.status,
          paymentStatus: initial.contract.paymentStatus,
          creditedAmount: 0,
          replayed: true,
        };
      }
      if (initial.contract.status !== 'ACTIVE') throw new TradeError('CONTRACT_NOT_ACTIVE');
      if (initial.contract.paymentStatus !== 'PENDING') throw new TradeError('DEPOSIT_ALREADY_OPEN');
      if (!input.paymentKey.trim()) throw new TradeError('TOSS_PAYMENT_KEY_INVALID');
      if (!Number.isInteger(input.returnedAmount) || input.returnedAmount !== initial.deposit.amount) {
        throw new TradeError('TOSS_AMOUNT_MISMATCH');
      }

      const callback = await confirmPayment({
        paymentKey: input.paymentKey,
        orderId: initial.deposit.id,
        amount: initial.deposit.amount,
        returnedAmount: input.returnedAmount,
        idempotencyKey: initial.deposit.idempotencyKey,
      });

      return ports.transaction(async (tx) => {
        // The adapter locks both contract and deposit rows before loading dedup keys and applying credit.
        const current = await ports.findDepositConfirmationContextForUpdate(tx, input.contractId, input.depositId);
        if (!current) throw new TradeError('DEPOSIT_NOT_FOUND');
        assertClient(input.actor, current.clientId);

        const canCredit = current.contract.status === 'ACTIVE' && current.contract.paymentStatus === 'PENDING';
        const decision = decideCallback(
          {
            status: canCredit || current.deposit.status !== 'PENDING'
              ? current.deposit.status
              : 'HELD',
            amount: current.deposit.amount,
          },
          new Set(await ports.listPaymentEventDedupKeys(tx, current.deposit.id)),
          callback,
        );
        const depositedAt = decision.credit > 0 ? new Date(callback.occurredAt) : current.deposit.depositedAt;
        if (decision.credit > 0) assertWon(current.contract.totalDeposited + decision.credit);

        await ports.updateDeposit(tx, current.deposit.id, {
          status: decision.depositStatus,
          pgKey: current.deposit.pgKey ?? callback.pgKey,
          depositedAt,
        });
        await ports.recordPaymentEvents(tx, current.deposit.id, decision.events);
        if (decision.credit > 0) {
          await ports.updateContractPayment(tx, current.contract.id, {
            paymentStatus: 'DEPOSITED',
            totalDeposited: current.contract.totalDeposited + decision.credit,
          });
          await ports.recordDepositEvent(tx, {
            type: 'PAYMENT_DEPOSITED',
            userId: input.actor.userId,
            sessionId: input.actor.sessionId ?? null,
            projectId: current.contract.projectId,
            payload: {
              contractId: current.contract.id,
              depositId: current.deposit.id,
              amount: decision.credit,
            },
          });
        }

        return {
          depositStatus: decision.depositStatus,
          paymentStatus: decision.credit > 0 ? 'DEPOSITED' : current.contract.paymentStatus,
          creditedAmount: decision.credit,
          replayed: decision.events.some((event) => event.eventType === 'DUPLICATE_BLOCKED'),
        };
      });
    },
  };
}

function assertClient(actor: PaymentActor, clientId: string): void {
  if (actor.role !== 'CLIENT' || actor.userId !== clientId) throw new TradeError('DEPOSIT_FORBIDDEN');
}
