import type { Duration, Plan } from "../constants.js";
import { E } from "./emoji.js";

/**
 * Every text of the bot, by domain. Each ticket adds the section of its screens
 * (`home`, `access`, `wallets`, `token`…).
 *
 * - English, word for word from the context. A text the context does not give is marked
 *   `// proposed text (D19)`.
 * - This file is trusted HTML: it is sent as is with `parse_mode: HTML`. User values
 *   (token, wallet, username, link) are escaped by the caller with `escapeHtml`, `b`,
 *   `code` or `a` before they reach a function of this file.
 * - This file imports emojis and types only: dates and amounts arrive already formatted, so
 *   that formatters can use these texts.
 * - `alerts` holds the texts of `answerCallbackQuery` (200 characters max).
 */
export const en = {
  btn: {
    back: `${E.back} Back`,
    menu: `${E.menu} Menu`,
    cancel: `${E.cancel} Cancel`,
    continue: `${E.continue} Continue`,
    confirm: `${E.confirm} Confirm`,
    refresh: `${E.refresh} Refresh`,
  },

  common: {
    alreadyUpToDate: "Already up to date",
    /** `time` is already formatted: `formatTimeUtc(date)`. */
    updated: (time: string) => `${E.updated} Updated ${time}`,
    // proposed text (D19)
    rateLimited: `${E.waiting} Too many actions. Please wait a few seconds and try again.`,
    // proposed text (D19)
    genericError: `${E.fail} Something went wrong. Please try again.`,
    // proposed text (D19)
    staleButton: "This button has expired. Please use the menu.",
    // proposed text (D19)
    current: (value: string) => `Current: ${value}`,
    none: "—",
    step: (step: number, total: number) => `STEP ${step}/${total}`,
    // proposed text (D19)
    tryAgainIn: (seconds: number) => `${E.waiting} Too many actions. Try again in ${seconds} s.`,
  },

  alerts: {},

  // Provisional /start screen, replaced by V1-06 then V1-08.
  start: {
    title: `${E.launchBot} LAUNCH BOT`,
    // proposed text (D19)
    description: "Launch Bot is being set up. The menu is coming soon.",
    /** `id` is already wrapped in <code> by the caller. */
    id: (id: string) => `${E.id} ${id}`,
    command: "Open the menu",
  },

  plans: {
    CLASSIC: "Classic",
    PREMIUM: "Premium",
  } satisfies Record<Plan, string>,

  durations: {
    TWO_DAYS: "2 days",
    ONE_MONTH: "1 month",
  } satisfies Record<Duration, string>,

  remaining: {
    until: (dayMonth: string) => `until ${dayMonth}`,
    daysHours: (days: number, hours: number) => `${days}d ${hours}h left`,
    // proposed text (D19)
    hours: (hours: number) => `${hours}h left`,
    // proposed text (D19)
    minutes: (minutes: number) => `${minutes}m left`,
  },

  flows: {
    SIMULATION: {
      title: `${E.simulate} SIMULATION`,
      steps: ["Token", "Dev buy", "Recap"],
    },
    LAUNCH: {
      title: `${E.launchCoin} LAUNCH`,
      steps: ["Wallet", "Dev buy", "Token", "Recap"],
    },
  },
} as const;
