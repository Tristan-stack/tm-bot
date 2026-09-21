/**
 * This file imports nothing, and ESLint enforces it: the Vite configuration of the Mini App
 * loads it by a relative path, where a workspace package in TypeScript source cannot be.
 */

/**
 * Date each version of the Terms and the Privacy Policy was published (§11.2): one
 * `TERMS_VERSION` covers both texts. Proposal for version 1: the date given by the context.
 */
export const LEGAL_UPDATED_AT: Readonly<Record<number, string>> = {
  1: "2026-09-15",
};

export const DEFAULT_TERMS_VERSION = 1;

/**
 * The version a build of the Mini App shows. Throws when the version has no publication date,
 * which fails the build: a page must never show "Version 2" without its date.
 */
export function resolveTermsVersion(raw: string | undefined): number {
  const text = raw?.trim() ?? "";
  const version = text === "" ? DEFAULT_TERMS_VERSION : /^\d+$/.test(text) ? Number(text) : NaN;
  if (LEGAL_UPDATED_AT[version] === undefined) {
    throw new Error(
      `TERMS_VERSION=${text} has no date in LEGAL_UPDATED_AT (packages/shared/src/legal.ts)`,
    );
  }
  return version;
}
