import { describe, expect, it } from "vitest";
import { isUniqueViolation } from "./errors.js";
import { Prisma } from "./generated/prisma/client.js";

const knownError = (code: string, meta: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError("failed", { code, clientVersion: "test", meta });

// Shape reported by @prisma/adapter-pg, captured on a real PostgreSQL 16.
const adapterViolation = (modelName: string, index: string) =>
  knownError("P2002", {
    modelName,
    driverAdapterError: {
      name: "DriverAdapterError",
      cause: { originalCode: "23505", kind: "UniqueConstraintViolation", constraint: { index } },
    },
  });

describe("isUniqueViolation", () => {
  it("recognises P2002 only", () => {
    expect(isUniqueViolation(adapterViolation("User", "User_telegramId_key"))).toBe(true);
    expect(isUniqueViolation(knownError("P2025", {}))).toBe(false);
    expect(isUniqueViolation(new Error("P2002"))).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });

  it("matches the fields from the index name of the driver adapter, in any order", () => {
    const error = adapterViolation("Wallet", "Wallet_userId_name_key");

    expect(isUniqueViolation(error, ["userId", "name"])).toBe(true);
    expect(isUniqueViolation(error, ["name", "userId"])).toBe(true);
    expect(isUniqueViolation(error, ["userId", "publicKey"])).toBe(false);
    expect(isUniqueViolation(error, ["userId"])).toBe(false);
  });

  it("matches the fields from meta.target of the query engine", () => {
    const error = knownError("P2002", { modelName: "Wallet", target: ["userId", "publicKey"] });

    expect(isUniqueViolation(error, ["userId", "publicKey"])).toBe(true);
    expect(isUniqueViolation(error, ["userId", "name"])).toBe(false);
  });

  it("does not guess when the fields are asked for but not reported", () => {
    expect(isUniqueViolation(knownError("P2002", {}), ["telegramId"])).toBe(false);
    expect(isUniqueViolation(adapterViolation("User", "custom_index"), ["telegramId"])).toBe(false);
  });
});
