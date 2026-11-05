export interface TransactionContext<Tx = unknown> {
  readonly correlationId: string;
  readonly tx: Tx;
}

export interface TransactionHost<Tx = unknown> {
  $transaction<Result>(run: (tx: Tx) => Promise<Result>): Promise<Result>;
}

export function withTransaction<Tx, Result>(
  host: TransactionHost<Tx>,
  correlationId: string,
  run: (context: TransactionContext<Tx>) => Promise<Result>,
): Promise<Result> {
  return host.$transaction(tx => run({ correlationId, tx }));
}
