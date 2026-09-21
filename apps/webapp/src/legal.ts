import { enWebapp, formatDate, LEGAL_UPDATED_AT } from "@launchbot/shared";

/**
 * "Version 1 · Updated 15 Sep 2026" (§11.2). The build already refuses a version without a
 * date (vite.config.ts), so the error below only guards a bundle built another way.
 */
export function legalVersionLine(version: number): string {
  const updatedAt = LEGAL_UPDATED_AT[version];
  if (updatedAt === undefined) throw new Error(`No publication date for version ${version}`);
  // A date-only ISO string is parsed as UTC.
  return enWebapp.legal.version(version, formatDate(new Date(updatedAt)));
}
