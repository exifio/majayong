export class CatalogError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = "CatalogError";
    this.code = code;
    this.status = status;
  }
}
