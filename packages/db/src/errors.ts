import { Prisma } from "./generated/prisma/client.js";

type UniqueViolationMeta = {
  modelName?: unknown;
  // Query engine format
  target?: unknown;
  // Driver adapter format (@prisma/adapter-pg): only the index name is reported,
  // e.g. "Wallet_userId_name_key".
  driverAdapterError?: { cause?: { constraint?: { index?: unknown; fields?: unknown } } };
};

const sameFields = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

function violatedFields(meta: UniqueViolationMeta): string[] | undefined {
  const constraint = meta.driverAdapterError?.cause?.constraint;
  for (const candidate of [meta.target, constraint?.fields]) {
    if (Array.isArray(candidate)) return candidate.map(String);
  }
  const index = constraint?.index;
  if (typeof index !== "string" || typeof meta.modelName !== "string") return undefined;
  // Prisma names unique indexes <Model>_<field>_<field>_key.
  const prefix = `${meta.modelName}_`;
  if (!index.startsWith(prefix) || !index.endsWith("_key")) return undefined;
  return index.slice(prefix.length, -"_key".length).split("_");
}

/**
 * True for a unique constraint violation (P2002). With `fields`, only when the violated
 * constraint covers exactly these fields, in any order: `isUniqueViolation(e, ["userId", "name"])`.
 */
export function isUniqueViolation(error: unknown, fields?: readonly string[]): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  if (fields === undefined) return true;
  const meta: UniqueViolationMeta = error.meta ?? {};
  const violated = violatedFields(meta);
  return violated !== undefined && sameFields(violated, fields);
}
