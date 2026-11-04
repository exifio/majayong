import { describe, expect, it } from "@jest/globals";
import { hashPassword, verifyPassword } from "../../src/modules/identity/auth.ts";

describe("identity password hashing", () => {
  it("stores salted hashes and verifies only the matching password", async () => {
    const firstHash = await hashPassword("LongPass123");
    const secondHash = await hashPassword("LongPass123");

    expect(firstHash).not.toBe("LongPass123");
    expect(firstHash).not.toBe(secondHash);
    await expect(verifyPassword("LongPass123", firstHash)).resolves.toBe(true);
    await expect(verifyPassword("WrongPass123", firstHash)).resolves.toBe(false);
    await expect(verifyPassword("LongPass123", "malformed")).resolves.toBe(false);
  });

  it("requires at least eight characters with an ASCII letter and digit", async () => {
    await expect(hashPassword("short1A")).rejects.toThrow("WEAK_PASSWORD");
    await expect(hashPassword("lettersOnly")).rejects.toThrow("WEAK_PASSWORD");
    await expect(hashPassword("12345678")).rejects.toThrow("WEAK_PASSWORD");
  });
});
