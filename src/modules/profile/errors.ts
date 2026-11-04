export class ProfileError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}
