import { createRequire } from "node:module";
import type * as PumpSdk from "@pump-fun/pump-sdk";

/**
 * `@pump-fun/pump-sdk` 2.0.0 through its CommonJS build. Its ESM build does not load under
 * Node: `@pump-fun/agent-payments-sdk`, which it imports, takes `BN` as a named export of
 * `@coral-xyz/anchor`, and anchor ships it in CommonJS only ("does not provide an export
 * named 'BN'"). Vitest papers over it, `tsx`, which runs the processes, does not. Types
 * still come from the package: only the value goes through `require`.
 */
const requireCjs = createRequire(import.meta.url);

export const pumpSdk = requireCjs("@pump-fun/pump-sdk") as typeof PumpSdk;
