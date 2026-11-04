import type { Prisma } from "@prisma/client";
import { sanitizeUserText } from "../../core/privacy.js";

const wireframeTypes = ["CALENDAR", "FORM", "LIST", "BUTTON", "TEXT", "PREVIEW"] as const;

export type GeneratedCatalogBlock = {
  name: string;
  functionSummary: string;
  description: string;
  techTags: string[];
  wireframe: Prisma.InputJsonObject;
  conditions: Prisma.InputJsonArray;
  unitPrice: number;
  priceBasis: string;
};

export class CatalogOutputError extends Error {
  constructor() {
    super("INVALID_GENERATED_CATALOG_BLOCK");
    this.name = "CatalogOutputError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new CatalogOutputError();
  return value.trim();
}

function hasPrivateText(text: string, privateValues: string[]): boolean {
  return text !== sanitizeUserText(text, privateValues);
}

function assertNoPrivateText(value: unknown, privateValues: string[], seen = new Set<object>()): void {
  if (typeof value === "string") {
    if (hasPrivateText(value, privateValues)) throw new CatalogOutputError();
    return;
  }
  if (typeof value !== "object" || value === null) return;
  if (seen.has(value)) throw new CatalogOutputError();
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) assertNoPrivateText(item, privateValues, seen);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (hasPrivateText(key, privateValues)) throw new CatalogOutputError();
    assertNoPrivateText(item, privateValues, seen);
  }
}

function readConditions(value: unknown): Prisma.InputJsonArray {
  if (!Array.isArray(value) || value.length !== 2) throw new CatalogOutputError();
  return value.map(item => {
    if (!isRecord(item)) throw new CatalogOutputError();
    return { key: requiredString(item.key), text: requiredString(item.text) };
  });
}

function readJsonValue(value: unknown): Prisma.InputJsonValue | null {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(readJsonValue);
  if (!isRecord(value)) throw new CatalogOutputError();
  const result: Record<string, Prisma.InputJsonValue | null> = {};
  for (const [key, item] of Object.entries(value)) result[key] = readJsonValue(item);
  return result;
}

function readJsonObject(value: unknown): Prisma.InputJsonObject {
  if (!isRecord(value)) throw new CatalogOutputError();
  const result: Record<string, Prisma.InputJsonValue | null> = {};
  for (const [key, item] of Object.entries(value)) result[key] = readJsonValue(item);
  return result;
}

function readWireframe(value: unknown): Prisma.InputJsonObject {
  if (!isRecord(value) || !Array.isArray(value.parts) || value.parts.length === 0) throw new CatalogOutputError();
  const parts = value.parts.map(part => {
    if (!isRecord(part)) throw new CatalogOutputError();
    const type = wireframeTypes.find(candidate => candidate === part.type);
    if (type === undefined) throw new CatalogOutputError();
    const label = part.label === undefined ? undefined : requiredString(part.label);
    const props = part.props === undefined ? undefined : readJsonObject(part.props);
    return { type, ...(label === undefined ? {} : { label }), ...(props === undefined ? {} : { props }) };
  });
  return { parts };
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) throw new CatalogOutputError();
  return value.map(requiredString);
}

export function parseGeneratedBlock(value: unknown, privateValues: string[]): GeneratedCatalogBlock {
  assertNoPrivateText(value, privateValues);
  if (!isRecord(value)) throw new CatalogOutputError();
  const unitPrice = value.unitPrice;
  if (typeof unitPrice !== "number" || !Number.isSafeInteger(unitPrice) || unitPrice < 0 || unitPrice > 2_147_483_647) {
    throw new CatalogOutputError();
  }
  const priceBasis = requiredString(value.priceBasis);
  const basisLines = priceBasis.split(/\r?\n/);
  if (basisLines.length !== 3 || basisLines.some(line => !line.trim())) throw new CatalogOutputError();

  return {
    name: requiredString(value.name),
    functionSummary: requiredString(value.functionSummary),
    description: requiredString(value.description),
    techTags: readStringArray(value.techTags),
    wireframe: readWireframe(value.wireframe),
    conditions: readConditions(value.conditions),
    unitPrice,
    priceBasis,
  };
}

export function normalizeFunctionSummary(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");
}
