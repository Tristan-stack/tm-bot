import { WALLET_LIMITS, WALLET_READY_MIN_LAMPORTS } from "./constants.js";
import type { Plan } from "./constants.js";

/** 3 wallets without a subscription, 5 in Classic, 10 in Premium (§8.1, §9.1, D1). */
export const getWalletLimit = (plan: Plan | null): number => WALLET_LIMITS[plan ?? "NONE"];

/** A wallet can launch from 1.050 SOL: the smallest dev buy plus the fee margin (D13). */
export const isWalletReady = (lamports: bigint): boolean => lamports >= WALLET_READY_MIN_LAMPORTS;
