import type { Duration, ImportFormat, Plan } from "../constants.js";
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

  // Wallets (§9.1, §9.2, §9.3). Names arrive escaped, amounts and dates formatted.
  wallets: {
    title: `${E.wallets} WALLETS`,
    /** The counter of the header: `2/5`, or `5/5 · limit reached` (placement proposed). */
    counter: (count: number, limit: number) =>
      count >= limit ? `${count}/${limit} · limit reached` : `${count}/${limit}`,
    description: "Your wallets on the bot. Tap one to see its address, withdraw or rename it.",
    empty: "No wallet yet. Create or import one to get started.",
    /** `line` is `7xKX…gAsU · 2.500 SOL ($258.40)`. */
    entry: (index: number, name: string, line: string) => `${index}. ${name}\n   └ ${line}`,
    total: (balance: string) => `Total: ${balance}`,
    /** In place of an amount the RPC could not give. */
    unavailableSol: "— SOL",
    // proposed text (D19)
    balancesUnavailable: `${E.warning} Balances unavailable right now. Tap Refresh to try again.`,
    // proposed text (D19)
    balanceUnavailable: `${E.warning} Balance unavailable right now. Tap Refresh to try again.`,
    limitReached: {
      alert: "Wallet limit reached. Upgrade to get more.",
      flag: `${E.warning} Wallet limit reached. Upgrade to get more.`,
    },
    // proposed text (D19)
    notFound: {
      alert: "This wallet no longer exists.",
      flag: `${E.warning} This wallet no longer exists.`,
    },
    detail: {
      title: (name: string) => `${E.wallets} ${name}`,
      // proposed text (D19): §4.5 wants a description, the mockup of §9.2 has none
      description: "Tap the address to copy it.",
      balance: (balance: string) => `${E.balance} ${balance}`,
      /** `date` comes from `formatDate`: `12 Sep 2026`. */
      created: (date: string) => `${E.created} Created ${date}`,
    },
    created: `${E.confirm} Wallet created. Send SOL to this address to fund it.`,
    /** The wallet line of the provisional screens: `👛 Main · 2.500 SOL ($258.40)`. */
    walletLine: (name: string, balance: string) => `${E.wallets} ${name} · ${balance}`,
    btnWallet: (name: string) => `${E.wallets} ${name}`,
    btnCreate: `${E.create} Create`,
    btnImport: `${E.import} Import`,
    btnWithdraw: `${E.withdraw} Withdraw`,
    btnRename: `${E.rename} Rename`,
    btnDelete: `${E.delete} Delete`,
    btnExplorer: `${E.explorer} Explorer`,
    // Rename (§9.3). The header, "Current" and the rule line are proposed texts (D19).
    rename: {
      title: `${E.rename} RENAME WALLET`,
      prompt: "Send the new name.",
      rules: (max: number) => `1 to ${max} characters, different from your other wallets.`,
      // proposed texts (D19): shown on the input screen, which stays open
      errors: {
        empty: `${E.warning} The name can't be empty.`,
        tooLong: (length: number, max: number) =>
          `${E.warning} Too long: ${formatInt(length)} characters (${max} max).`,
        /** `name` arrives escaped. */
        duplicate: (name: string) => `${E.warning} You already have a wallet named "${name}".`,
        notText: `${E.warning} Send the name as a text message.`,
        oneLine: `${E.warning} Send the name on one line.`,
      },
      done: `${E.confirm} Wallet renamed.`,
    },
    // Delete (§9.3): the confirmation and the blocking texts are the ones of the context.
    delete: {
      title: `${E.delete} DELETE WALLET`,
      /** `name` arrives escaped, `address` shortened. */
      confirm: (name: string, address: string) =>
        `Delete wallet "${name}" (${address})?\nIts encrypted key will be erased. This cannot be undone.`,
      /** `balance` is `2.500 SOL ($258.40)`, `2.500 SOL`, or `&lt; 0.001 SOL`. */
      blocked: (name: string, balance: string) =>
        `${E.warning} ${name} still holds ${balance}. Withdraw it before deleting: a deleted wallet can't be recovered.`,
      // proposed text (D19): a balance that rounds to 0.000. Escaped by the caller, like a name.
      dust: "< 0.001 SOL",
      // proposed text (D19): alert of "Yes, delete" when SOL arrived since the confirmation
      receivedSol: "This wallet received SOL. Withdraw it first.",
      // proposed text (D19)
      checkFailed: {
        alert: "Couldn't check the balance. Try again in a moment.",
        flag: `${E.warning} Couldn't check the balance. Try again in a moment.`,
      },
      // proposed text (D19): shown on the detail of that wallet, whose name is the header.
      pendingWithdrawal: {
        alert: "A withdrawal from this wallet is still pending. Try again in a moment.",
        flag: `${E.warning} A withdrawal from this wallet is still pending. Try again in a moment.`,
      },
      done: `${E.confirm} Wallet deleted.`,
      btnYes: `${E.confirm} Yes, delete`,
      btnWithdrawAll: `${E.withdraw} Withdraw all`,
    },
    // Import (§9.4). The two formats, their inputs, and what a failed attempt says.
    import: {
      title: `${E.import} IMPORT WALLET`,
      warning: `${E.warning} Never import a wallet that holds real funds. The same key also works on mainnet.`,
      description: "Choose the format of the key you want to import.",
      // proposed text (D19): the counter of the plan, on the screen that adds a wallet
      counter: (count: number, limit: number) => `${E.wallets} Wallets: ${count}/${limit}`,
      btnKey: `${E.privateKey} Private key`,
      btnSeed: `${E.seedPhrase} Seed phrase`,
      // The two inputs (§4.5): what to send, then the format that is accepted.
      key: {
        title: `${E.privateKey} IMPORT PRIVATE KEY`,
        prompt:
          "Send your private key in one message. It is deleted from the chat right after reading.",
        rules: "Format: base58 private key (64 bytes), as exported from Phantom or Solflare.",
      },
      seed: {
        title: `${E.seedPhrase} IMPORT SEED PHRASE`,
        prompt:
          "Send your seed phrase in one message. It is deleted from the chat right after reading.",
        /** `path` is the derivation path of the wallet package: never written twice. */
        rules: (path: string) =>
          `Format: 12 or 24 words separated by spaces. The first account (${path}) is imported: same address as Phantom or Solflare. Your seed phrase is stored encrypted. Only support can recover it for you.`,
      },
      /** What the input screen says when the secret does not parse, by format. */
      invalid: {
        KEY: `${E.fail} Invalid private key.`,
        SEED: `${E.fail} Invalid seed phrase.`,
      } satisfies Record<ImportFormat, string>,
      /** `time` comes from `formatTimeUtc`: two minutes after the input opened (D18). */
      expiresAt: (time: string) => `${E.expired} Expires at ${time}`,
      expired: `${E.expired} Import expired. Please start again.`,
      duplicate: `${E.warning} This wallet is already in your list.`,
      // proposed text (D19): the limit of RATE_LIMITS.walletImport (D17)
      tooManyAttempts: `${E.warning} Too many import attempts. Try again in a few minutes.`,
      done: `${E.confirm} Wallet imported.`,
    },
    // A message that looks like a secret, wherever it arrives (§9.4). proposed texts (D19)
    sensitive: {
      deleted: `${E.warning} Your message looked like a private key or seed phrase, so it was deleted.`,
      /** Telegram refused the deletion: also the flag of the import screens. */
      notDeleted: `${E.warning} Couldn't delete your message. Delete it yourself now.`,
      advice: `Never share it with anyone. To add a wallet, use ${E.wallets} Wallets › ${E.import} Import.`,
    },
    // Provisional screen, replaced by V1-14. proposed text (D19)
    comingSoon: {
      withdraw: { title: `${E.withdraw} WITHDRAW`, description: "Withdrawals are coming soon." },
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
