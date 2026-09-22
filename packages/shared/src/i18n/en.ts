import type { Duration, Plan } from "../constants.js";
import { formatInt } from "../format/number.js";
import { E } from "./emoji.js";
import { enWebapp } from "./en-webapp.js";

/**
 * Every text of the bot, by domain. Each ticket adds the section of its screens
 * (`home`, `access`, `wallets`, `token`…).
 *
 * - English, word for word from the context. A text the context does not give is marked
 *   `// proposed text (D19)`.
 * - This file is trusted HTML: it is sent as is with `parse_mode: HTML`. User values
 *   (token, wallet, username, link) are escaped by the caller with `escapeHtml`, `b`,
 *   `code` or `a` before they reach a function of this file.
 * - Dates and amounts arrive already formatted, so that the formatters can use these texts:
 *   this file imports emojis, types, the texts of the Mini App and `format/number.ts`, which
 *   imports nothing. A count arrives as a number: its plural and its grouping are text.
 * - A blocked click (§4.5) is a pair `{ alert, flag }`: the alert of `answerCallbackQuery`
 *   (200 characters max, checked by a test on every pair) and the line written on the screen.
 */
export const en = {
  btn: {
    back: `${E.back} Back`,
    menu: `${E.menu} Menu`,
    cancel: `${E.cancel} Cancel`,
    continue: `${E.continue} Continue`,
    confirm: `${E.confirm} Confirm`,
    refresh: `${E.refresh} Refresh`,
    // Both open a page of the Mini App: on the Terms screen and in the main menu.
    terms: `${E.terms} Terms of Service`,
    privacy: `${E.privacy} Privacy Policy`,
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

  // First access (§4.2): the Terms, then the channel of the bot.
  access: {
    terms: {
      title: `${E.launchBot} Welcome to Launch Bot`,
      intro: "Create and simulate Solana memecoin launches, right from Telegram.",
      network: `${E.info} This bot runs on Solana.`,
      prompt: "Before you start, please read and accept our Terms of Service and Privacy Policy.",
      btnAccept: `${E.confirm} I accept`,
    },
    channel: {
      title: `${E.joinChannel} ONE LAST STEP`,
      description: "Join our channel to follow updates and new features.",
      launchNote: `${E.launchCoin} Join the channel to launch a coin.`,
      notJoined: {
        alert: "You haven't joined the channel yet.",
        flag: `${E.info} Not joined yet. Join the channel, then tap I've joined.`,
      },
      // proposed text (D19)
      checkFailed: {
        alert: "We couldn't check your membership. Please try again in a moment.",
        flag: `${E.warning} We couldn't check your membership. Please try again in a moment.`,
      },
      btnJoin: `${E.joinChannel} Join channel`,
      btnJoined: `${E.confirm} I've joined`,
    },
  },

  // Home screen (§4.3). Amounts, links and the id arrive formatted and escaped.
  home: {
    title: `${E.launchBot} LAUNCH BOT`,
    /** Description of /start in the command list of Telegram. */
    command: "Open the menu",
    account: `${E.account} ACCOUNT`,
    /** `id` is already wrapped in <code> by the caller. */
    id: (id: string) => `${E.id} ${id}`,
    noSubscription: `${E.plan} No subscription`,
    /** `remaining` comes from `formatRemaining`: `1d 4h left`, `until 12 Oct`. */
    subscription: (plan: string, remaining: string) => `${E.plan} ${plan} · ${remaining}`,
    subscriptionExpired: (plan: string) => `${E.plan} ${plan} ${E.warning} expired`,
    noWallet: `${E.wallets} No wallet yet`,
    // proposed text (D19): the singular
    wallets: (count: number, balance: string) =>
      `${E.wallets} ${formatInt(count)} ${count === 1 ? "wallet" : "wallets"} · ${balance}`,
    // proposed text (D19)
    balanceUnavailable: "balance unavailable",
    community: `${E.community} COMMUNITY`,
    announcementsLabel: "Announcements",
    successLabel: "Success",
    botChannelLabel: "Bot channel",
    /** `link` is the label above, already wrapped in <a> by the caller. */
    announcements: (link: string) => `${E.announcements} ${link}`,
    success: (link: string) => `${E.success} ${link}`,
    // proposed text (D19): "— members" when the count is unknown, and the singular
    botChannel: (link: string, members: number | null) =>
      `${E.botChannel} ${link} · ${members === null ? "—" : formatInt(members)} ${members === 1 ? "member" : "members"}`,
    subscribers: (count: number) =>
      `${E.plan} ${formatInt(count)} active ${count === 1 ? "subscriber" : "subscribers"}`,
    /** `price` comes from `formatSolPrice`: `SOL $103.36`, or `SOL —`. */
    solPrice: (price: string) => `${E.solPrice} ${price}`,
    nextStep: {
      create_wallet: `${E.nextStep} Create a wallet to get started.`,
      subscribe: `${E.nextStep} Subscribe to unlock Launch Coin.`,
      fund_wallet: `${E.nextStep} Fund a wallet to launch a coin.`,
      all_set: `${E.allSet} You're all set.`,
    },
  },

  // Main menu (§4.4): no Stats, no Referrals (§2).
  menu: {
    launchCoin: `${E.launchCoin} Launch Coin`,
    simulate: `${E.simulate} Simulate a Launch`,
    subscribe: `${E.subscribe} Subscribe`,
    wallets: `${E.wallets} Wallets`,
    support: `${E.support} Support`,
  },

  // Provisional screens of the sections that are not delivered yet (V1-08).
  comingSoon: {
    // proposed text (D19)
    flag: `${E.construction} Coming soon: this section isn't available yet.`,
    sections: {
      launch: {
        title: `${E.launchCoin} LAUNCH COIN`,
        // proposed text (D19)
        description: "Create your memecoin on pump.fun: wallet, dev buy, token, recap.",
      },
      simulate: {
        title: `${E.simulate} SIMULATE A LAUNCH`,
        // proposed text (D19)
        description: "Simulate a live launch of your token. Free, no subscription needed.",
      },
      subscribe: {
        title: `${E.subscribe} SUBSCRIBE`,
        // proposed text (D19)
        description: "Choose a plan to unlock Launch Coin.",
      },
      wallets: {
        title: `${E.wallets} WALLETS`,
        // proposed text (D19): the description of §9.1 makes no sense without a list
        description: "Create, import and manage your Solana wallets.",
      },
      support: {
        title: `${E.support} SUPPORT`,
        description: "Need help? Contact our support team.",
      },
    },
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

  // The texts of the Mini App live in their own module: see en-webapp.ts.
  webapp: enWebapp,
} as const;
