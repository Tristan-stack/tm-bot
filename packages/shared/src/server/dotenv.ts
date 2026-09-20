import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "dotenv";

const WORKSPACE_MARKER = "pnpm-workspace.yaml";

/** Walks up from this file to the monorepo root, whatever the current working directory is. */
function findWorkspaceRoot(): string | undefined {
  let dir = import.meta.dirname;
  for (;;) {
    if (existsSync(join(dir, WORKSPACE_MARKER))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

let loaded = false;

/**
 * Loads the root `.env` into process.env once. pnpm runs scripts from each package folder,
 * so the path is resolved from the workspace root. Variables already set in the real
 * environment win over the file; a missing file is not an error.
 */
export function loadDotenvOnce(): void {
  if (loaded) return;
  loaded = true;
  const root = findWorkspaceRoot();
  if (root !== undefined) config({ path: join(root, ".env"), quiet: true });
}
