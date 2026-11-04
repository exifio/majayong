import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ProfileError } from "./errors.js";

function keyFromBase64(encoded?: string): Buffer {
  if (!encoded) throw new ProfileError("PROFILE_DATA_UNAVAILABLE", 503);
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) throw new ProfileError("PROFILE_DATA_UNAVAILABLE", 503);
  return key;
}

export function encryptProfileValue(value: string, encodedKey?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromBase64(encodedKey), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `enc:v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${ciphertext.toString("base64url")}`;
}

export function decryptProfileValue(value: string, encodedKey?: string): string {
  try {
    const [prefix, version, ivText, tagText, ciphertextText, extra] = value.split(":");
    if (prefix !== "enc" || version !== "v1" || !ivText || !tagText || !ciphertextText || extra !== undefined)
      throw new Error("INVALID_CIPHERTEXT");
    const decipher = createDecipheriv("aes-256-gcm", keyFromBase64(encodedKey), Buffer.from(ivText, "base64url"));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextText, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new ProfileError("PROFILE_DATA_UNAVAILABLE", 503);
  }
}

export function maskProfileValue(value: string | null, encodedKey?: string): string | null {
  if (value === null) return null;
  const digits = decryptProfileValue(value, encodedKey).replace(/\D/g, "");
  return digits.length < 4 ? null : `******${digits.slice(-4)}`;
}
