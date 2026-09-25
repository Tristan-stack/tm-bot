import type { Duration, ImportFormat, Plan, TxFailureCode } from "../constants.js";
import {
  BUNDLE_MAX_DECIMALS,
  BUNDLE_MAX_SOL,
  BUNDLE_MIN_SOL,
  DEV_BUY_SOL,
  TOKEN_DESCRIPTION_MAX_CHARS,
  TOKEN_DESCRIPTION_MAX_SENTENCES,
  TOKEN_IMAGE_MAX_MB,
  TOKEN_NAME_MAX_BYTES,
  TOKEN_TICKER_MAX_BYTES,
} from "../constants.js";
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
 *   this file imports emojis, types, the texts of the Mini App, `format/number.ts` and the
 *   limits of `constants.ts`, which import nothing. A count arrives as a number: its plural
 *   and its grouping are text.
 * - A blocked click (§4.5) is a pair `{ alert, flag }`: the alert of `answerCallbackQuery`
 *   (200 characters max, checked by a test on every pair) and the line written on the screen.
 */
/** The two halves of a blocked click (§4.5) from one sentence: the alert bare, the flag marked. */
export const warn = (text: string): { alert: string; flag: string } => ({
  alert: text,
  flag: `${E.warning} ${text}`,
});

/** §6: the exact mention, with its emoji on Telegram, without it on the pictures (V1-25). */
const DEMO_MENTION = "DEMO — Bullish scenario. Not a prediction or a real result.";

/** `1 wallet`, `2 wallets`, `1,248 simulations`: a count grouped, then its noun. */
const counted = (count: number, one: string, many = `${one}s`): string =>
  `${formatInt(count)} ${count === 1 ? one : many}`;

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
    // proposed text (D19): a message too long for one Telegram message (V1-43)
    part: (index: number, total: number) => `Part ${index}/${total}`,
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
    /** `plan` comes from `planLabel`: `Premium · 1d 4h left`, `Classic ⚠️ expired`. */
    subscription: (plan: string) => `${E.plan} ${plan}`,
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

  // Support (§11.1, V1-40): the texts of the context, emojis rebuilt (D7). The code arrives in
  // <code>: one tap copies it without its label.
  support: {
    title: `${E.support} SUPPORT`,
    description: [
      "Need help? Contact our support team.",
      "Tell us what happened, on which screen, and add a screenshot if you can.",
    ],
    code: (code: string) => `Your support code: ${code}`,
    pasteHint: "Paste it at the start of your first message.",
    premium: `${E.plan} You're Premium: your requests are handled first.`,
    standard: `${E.plan} Premium members are handled first.`,
    btnContact: `${E.contact} Contact support`,
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
    // Withdraw (§9.5, V1-14). The prompt of step 1 and the button labels come from the context;
    // every other text is proposed (D19). Amounts arrive formatted, exact where §9.5 asks.
    withdraw: {
      title: `${E.withdraw} WITHDRAW`,
      /** The balance does not even cover the fees of a transfer: the rule of V1-11. */
      nothingToWithdraw: warn("Nothing to withdraw: the balance doesn't cover the fees."),
      /** `name` arrives escaped, `address` shortened. */
      from: (name: string, address: string) => `${E.wallets} From: ${name} · ${address}`,
      /** `address` shortened on the steps, `code(address)` on the confirmation and the result. */
      to: (address: string) => `${E.destination} To: ${address}`,
      address: {
        prompt: "Send the destination address.",
        balance: (balance: string) => `${E.balance} Balance: ${balance}`,
        amountMax: `${E.balance} Amount: Max (balance − fees)`,
        rules: "Format: a Solana address, different from this wallet.",
        invalid: `${E.warning} Invalid address. Send a Solana address.`,
        /** `name` arrives escaped. */
        sameWallet: (name: string) =>
          `${E.warning} This is the address of ${name}. Send a different address.`,
        notText: `${E.warning} Send the address as a text message.`,
      },
      offCurve: {
        warning: `${E.warning} This address is not on the ed25519 curve. It is often a program account: SOL sent there may be lost.`,
        btnContinue: `${E.warning} Continue anyway`,
      },
      amount: {
        prompt: "Choose how much SOL to send.",
        available: (balance: string) => `${E.balance} Available: ${balance}`,
        /** `fee` and `max` are exact: `0.000005 SOL`, `2.499995 SOL`. */
        feesAndMax: (fee: string, max: string) => `${E.fees} Fees: ≈ ${fee} · Max: ${max}`,
        btnPct: (pct: number) => `${pct}%`,
        btnMax: "Max",
        btnCustom: `${E.edit} Custom`,
        custom: {
          prompt: "Send the amount in SOL.",
          rules: (max: string, rentMin: string) =>
            `Rules: a number like 0.5 (up to 9 decimals), at most ${max}. The balance left must be 0 or at least ${rentMin}.`,
          invalid: `${E.warning} Invalid amount. Send a number like 0.5.`,
          notText: `${E.warning} Send the amount as a text message.`,
        },
        // Two rules of §9.5 said shorter on the amount step; every other code reads `tx.errors`.
        refused: {
          /** `missing` is exact, or absent when the simulation refused without a number. */
          INSUFFICIENT_FUNDS: (missing?: string) =>
            warn(
              missing === undefined
                ? "Insufficient funds"
                : `Insufficient funds (${missing} missing)`,
            ),
          REMAINING_BELOW_RENT: (rentMin?: string) =>
            warn(
              rentMin === undefined
                ? "The balance left would be below the rent-exempt minimum. Choose Max or a smaller amount."
                : `The balance left would be below the rent-exempt minimum (${rentMin}). Choose Max or a smaller amount.`,
            ),
        } satisfies Partial<
          Record<TxFailureCode, (amount?: string) => { alert: string; flag: string }>
        >,
      },
      confirm: {
        prompt: "Check the withdrawal. A sent transaction can't be reversed.",
        amount: (amount: string) => `${E.balance} Amount: ${amount}`,
        amountMax: (amount: string) => `${E.balance} Amount: ${amount} (Max)`,
        fees: (fee: string) => `${E.fees} Fees: ≈ ${fee}`,
        /** `name` is `ui.config.networkName`: `Solana Devnet`. */
        network: (name: string) => `${E.devnet} Network: Solana ${name}`,
        inProgress: warn("A withdrawal is already in progress."),
        tooMany: warn("Too many withdrawals. Try again in a few minutes."),
        previousMayLand: `${E.warning} A previous attempt may still go through. Check the explorer first.`,
        /** The screen without a button while the transaction is sent and confirmed. */
        sending: (amount: string) => `${E.waiting} Sending ${amount}…`,
      },
      result: {
        sent: `${E.confirm} Withdrawal sent.`,
        failed: `${E.fail} Withdrawal failed.`,
        /** `text` is one of `tx.errors`. */
        reason: (text: string) => `Reason: ${text}`,
        amount: (amount: string) => `${E.balance} Amount: ${amount}`,
        fees: (fee: string) => `${E.fees} Fees: ${fee}`,
        /** `link` is `a(shortSignature, explorerTxUrl)`. */
        signature: (link: string) => `${E.explorer} Signature: ${link}`,
        btnTryAgain: `${E.retry} Try again`,
        btnBackToWallet: `${E.back} Back to wallet`,
      },
    },
  },

  // The Token step (§5, V1-16): step 1 of a simulation, step 3 of a launch. The mockup gives
  // the description, the block, the buttons and the Continue alert; the rest is proposed (D19).
  // Values arrive escaped, the ticker with its `$`, the links shortened.
  token: {
    description: "Generate a token or edit it. Image and links are optional.",
    block: `${E.token} TOKEN`,
    name: (value: string) => `Name: ${value}`,
    ticker: (value: string) => `Ticker: ${value}`,
    descriptionLine: (value: string) => `Description: ${value}`,
    image: (value: string) => `${E.image} Image: ${value}`,
    website: (value: string) => `${E.website} Website: ${value}`,
    x: (value: string) => `${E.x} X: ${value}`,
    telegram: (value: string) => `${E.telegram} Telegram: ${value}`,
    imageAdded: `${E.confirm} Added`,
    /**
     * The choices already made (§10.1, §15), before the block: `👛 Wallet: Main · 4.200 SOL`,
     * `💰 Dev buy: 1 SOL`, `📦 Bundle: 3 SOL`. The steps of a simulation show the last two.
     */
    summaryWallet: (line: string) => `${E.wallets} Wallet: ${line}`,
    /** The dev buy is fixed (decision of 25/09/2026). */
    summaryDevBuy: `${E.devBuy} Dev buy: ${DEV_BUY_SOL} SOL`,
    summaryBundle: (amount: string) => `${E.bundle} Bundle: ${amount}`,
    /** `fields` are the labels below, in the order of the block: `⚠️ Missing: name, ticker`. */
    missing: (fields: string[]) => `${E.warning} Missing: ${fields.join(", ")}`,
    missingAlert: "Add a name and ticker first.",
    fieldLabels: { name: "name", ticker: "ticker" },
    // proposed text (D19)
    inputExpired: `${E.expired} This input expired. Tap the field again.`,
    btnGenerate: `${E.generate} Generate`,
    btnAi: `${E.ai} AI Generate`,
    btnAiLocked: `${E.locked} AI Generate`,
    btnEdit: `${E.edit} Edit`,
    btnImage: `${E.image} Image`,
    btnWebsite: `${E.website} Website`,
    btnX: `${E.x} X`,
    btnTelegram: `${E.telegram} Telegram`,
    btnRemove: `${E.remove} Remove`,
    // The choice of the field to edit (§5). proposed texts (D19)
    edit: {
      description: "Choose the field to edit.",
      btnName: "Name",
      btnTicker: "Ticker",
      btnDescription: "Description",
    },
    // The inputs (§4.5): what to send, then the rule. proposed texts (D19), limits of V1-15.
    inputs: {
      name: {
        prompt: `${E.edit} Send the new name.`,
        rules: `Rules: 1 to ${TOKEN_NAME_MAX_BYTES} bytes. Emojis count as several bytes.`,
      },
      ticker: {
        prompt: `${E.edit} Send the new ticker.`,
        rules: `Rules: 1 to ${TOKEN_TICKER_MAX_BYTES} bytes, no spaces. Converted to uppercase. The $ is added for you.`,
      },
      description: {
        prompt: `${E.edit} Send the new description.`,
        rules: `Rules: 1 to ${TOKEN_DESCRIPTION_MAX_SENTENCES} short sentences, ${TOKEN_DESCRIPTION_MAX_CHARS} characters max.`,
      },
      image: {
        prompt: `${E.image} Send the token image as a photo or an image file.`,
        rules: `Rules: JPG, PNG or WEBP, ${TOKEN_IMAGE_MAX_MB} MB max. Optional.`,
      },
      website: {
        prompt: `${E.website} Send the website link.`,
        rules: "Rules: full link starting with https://. Optional.",
      },
      x: {
        prompt: `${E.x} Send the X account.`,
        rules: "Rules: @handle or x.com link. Optional.",
      },
      telegram: {
        prompt: `${E.telegram} Send the Telegram link.`,
        rules: "Rules: t.me link or @username. Optional.",
      },
    },
    // What was wrong with an input, written on the input screen (§4.5). proposed texts (D19)
    errors: {
      nameEmpty: `${E.warning} Name can't be empty.`,
      nameTooLong: (bytes: number) =>
        `${E.warning} Name too long: ${formatInt(bytes)} bytes (max ${TOKEN_NAME_MAX_BYTES}).`,
      tickerEmpty: `${E.warning} Ticker can't be empty.`,
      tickerTooLong: (bytes: number) =>
        `${E.warning} Ticker too long: ${formatInt(bytes)} bytes (max ${TOKEN_TICKER_MAX_BYTES}).`,
      tickerSpaces: `${E.warning} Ticker can't contain spaces.`,
      descriptionEmpty: `${E.warning} Description can't be empty.`,
      tooManySentences: `${E.warning} Use 1 to ${TOKEN_DESCRIPTION_MAX_SENTENCES} short sentences.`,
      descriptionTooLong: (chars: number) =>
        `${E.warning} Description too long: ${formatInt(chars)} characters (max ${TOKEN_DESCRIPTION_MAX_CHARS}).`,
      invalidChars: `${E.warning} This text contains unsupported characters.`,
      invalidUrl: `${E.warning} Invalid link. It must start with https://`,
      invalidX: `${E.warning} Invalid X account. Send @handle or an x.com link.`,
      invalidTelegram: `${E.warning} Invalid Telegram link. Send a t.me link or @username.`,
      notImage: `${E.warning} Send a photo or an image file (JPG, PNG or WEBP, ${TOKEN_IMAGE_MAX_MB} MB max).`,
      notText: `${E.warning} Send the value as a text message.`,
      /** A link the code above has no text for: a website, an X or a Telegram value empty. */
      linkEmpty: `${E.warning} Send the link, or tap Remove.`,
    },
    // AI Generate (§5, §8.1, V1-17). The alert, the "Premium only" flag and the "coming soon"
    // mention are the texts of the context (§4.5); the rest is proposed (D19).
    ai: {
      premiumOnly: {
        alert: `${E.locked} AI Generate is a Premium feature.`,
        flag: `${E.locked} AI Generate: Premium only`,
      },
      /** On every Token screen, for everyone, until a text provider is plugged in (§15). */
      comingSoon: `${E.comingSoon} AI model coming soon: AI Generate uses the standard generator for now.`,
      /** Shown to Premium users (proposal). */
      quota: (used: number, limit: number) => `${E.ai} AI generations today: ${used}/${limit}`,
      quotaReached: (limit: number) => ({
        alert: `You've used your ${limit} AI generations for today.`,
        flag: `${E.warning} AI Generate: daily limit reached (${limit}/${limit}). Resets at 00:00 UTC.`,
      }),
      fallback: `${E.warning} AI model unavailable: used the standard generator.`,
      generating: `${E.ai} Generating…`,
    },
  },

  // Simulate a Launch (§6, V1-22): the Bundle and Recap steps. The mockups give the lines of
  // the recap and the DEMO mention; the bundle texts follow the decision of 25/09/2026, the rest
  // is proposed (D19). Values arrive escaped, the ticker with its `$`, amounts formatted.
  sim: {
    /** `🪙 Moon Otter · $OTTR`: the token chosen, on the Bundle and Custom screens. */
    token: (name: string, ticker: string) => `${E.token} ${name} · ${ticker}`,
    // The bundle (decision of 25/09/2026): the dev buys 1 SOL, then the bundle buys in the next
    // block. The screens of a launch say it too; their chosen lines are `token.summary*`.
    bundle: {
      description: `The dev buys ${DEV_BUY_SOL} SOL at launch, then the bundle buys in the next block. How much SOL should the bundle buy?`,
      notSelected: `${E.bundle} Bundle: not selected yet`,
      btnPreset: (sol: number) => `${sol} SOL`,
      btnCustom: `${E.edit} Custom`,
    },
    custom: {
      prompt: "Send the bundle amount in SOL.",
      rules: `Allowed: ${BUNDLE_MIN_SOL} to ${BUNDLE_MAX_SOL} SOL, up to ${BUNDLE_MAX_DECIMALS} decimals.`,
      invalid: `${E.warning} Invalid amount. Send a number from ${BUNDLE_MIN_SOL} to ${BUNDLE_MAX_SOL} SOL.`,
    },
    recap: {
      description: "Check your simulation, then tap Start simulation.",
      /** `┌ Moon Otter · $OTTR`; the block title and the Image line are those of `token`. */
      title: (name: string, ticker: string) => `${name} · ${ticker}`,
      imageAdded: E.confirm,
      linksNone: `${E.links} Links: none`,
      /** `🔗 Website · X · Telegram`, each already an <a> of the caller. */
      links: (links: string[]) => `${E.links} ${links.join(" · ")}`,
      linkLabels: { website: "Website", x: "X", telegram: "Telegram" },
      /** `5 SOL (≈ 15.2% of supply)`: `share` comes from `formatPct(share, 1)`. */
      withShare: (amount: string, share: string) => `${amount} (≈ ${share} of supply)`,
      /** `💰 Dev buy: 1 SOL (≈ 3.4% of supply)` */
      devBuy: (amountWithShare: string) => `${E.devBuy} Dev buy: ${amountWithShare}`,
      /** `📦 Bundle: 3 SOL (≈ 9.1% of supply)`: what it adds after the dev buy. */
      bundle: (amountWithShare: string) => `${E.bundle} Bundle: ${amountWithShare}`,
      /** `🧮 Total: 4 SOL (≈ 12.5% of supply)` */
      total: (amountWithShare: string) => `${E.total} Total: ${amountWithShare}`,
      duration: (minutes: number) => `${E.duration} Duration: ${minutes} min max`,
      btnStart: `${E.startSim} Start simulation`,
    },
    rateLimited: warn("Too many simulations. Wait a minute, then try again."),
    /** The mention of §6, on the recap and at the top of every caption of the simulation. */
    demoBanner: `${E.warning} ${DEMO_MENTION}`,
    // The pictures of the simulation (§6.1, §6.3, V1-25): no emoji, resvg has no color font.
    // PNL, Invested, Position are the rows of the mock-up of 24/09/2026; "Not a real result" and
    // SIMULATION are the words of §6.3; the rest is proposed (D19).
    image: {
      /** `Market cap (USD)`, or `(SOL)` without a SOL price. */
      marketCap: (unit: "USD" | "SOL") => `Market cap (${unit})`,
      pnl: "PNL",
      invested: "Invested",
      position: "Position",
      notReal: "Not a real result",
      watermark: "SIMULATION",
    },
    // The simulation in the chat (§6.1, §6.2, V1-26). Sell 25% / 50% / 100%, Pause, x1 / x2 / x5,
    // Run again, Menu and the mention are the words of the context; the rest is proposed (D19).
    live: {
      /** `⏱ 1:32 / 3:00`: both sides already `formatClock`. */
      clock: (elapsed: string, total: string) => `${E.duration} ${elapsed} / ${total}`,
      speed: (speed: number) => `Speed x${speed}`,
      paused: `${E.pause} Paused`,
      /** `📈 Market cap: $5,175.82 (50.08 SOL)`, the amount already formatted. */
      marketCap: (amount: string) => `${E.marketCap} Market cap: ${amount}`,
      /** `Bonding curve: 34.2% ▰▰▰▱▱▱▱▱▱▱` */
      bondingCurve: (pct: string, bar: string) => `Bonding curve: ${pct} ${bar}`,
      volume: (volume: string, buys: string, sells: string) =>
        `Volume: ${volume} · Buys / Sells: ${buys} / ${sells}`,
      hold: (text: string) => `${E.position} You hold: ${text}`,
      value: (text: string) => `Value if sold now: ${text}`,
      pnl: (text: string) => `PnL: ${text}`,
      soldSoFar: (text: string) => `Sold so far: ${text}`,
      btnSell: (pct: number) => `Sell ${pct}%`,
      btnPause: `${E.pause} Pause`,
      btnResume: `${E.startSim} Resume`,
      /** `x2`, or `✓ x2` for the current speed. */
      btnSpeed: (speed: number, current: boolean) => `${current ? `${E.ok} ` : ""}x${speed}`,
      btnRunAgain: `${E.runAgain} Run again`,
      alreadyRunning: warn("A simulation is already running."),
      busy: warn("The simulator is busy. Try again in a minute."),
      over: "This simulation is over. Start a new one from the menu.",
      /** `Sold 25%: 24.17M OTTR for 0.912 SOL.` */
      sold: (pct: number, tokens: string, ticker: string, amount: string) =>
        `Sold ${pct}%: ${tokens} ${ticker} for ${amount}.`,
      oneAtATime: "One sale at a time.",
      nothingToSell: "Nothing left to sell.",
    },
    // The caption of the PNL card (§6.3, the Axiom-style text of 24/09/2026): the ticker and
    // the PnL, then Invested / Sell / Profit with the whole dollars when there is a price.
    card: {
      title: `${E.simulate} SIMULATION ENDED`,
      /** `🪙 <b>$OTTR</b> | +42.7%` */
      headline: (ticker: string, pct: string) => `${E.token} <b>${ticker}</b> | ${pct}`,
      invested: (amount: string) => `${E.invested} Invested: ${amount}`,
      sell: (amount: string) => `${E.sell} Sell: ${amount}`,
      profit: (amount: string) => `${E.profit} Profit: ${amount}`,
    },
  },

  // Launch Coin (§10.1, V1-35 to V1-37). The mockups give the descriptions, the lines of the
  // steps and of the recap; the notes and the failure lines are proposed (D19). Names arrive
  // escaped, amounts formatted. The dev buy (1 SOL) and the bundle leave the same wallet
  // (decision of 25/09/2026): the texts say it. Reused: the Custom input and the lines of `sim`
  // and `token`, the wallet lines and the no-wallet state of `subscribe.payFromWallet`, the fee
  // line of `wallets.withdraw`.
  launch: {
    wallet: {
      description: "Choose the wallet that creates the token and pays the dev buy and the bundle.",
      /** The smallest launch (D13): the dev buy and the smallest bundle, nothing on top. */
      minimum: `The smallest launch needs ${DEV_BUY_SOL + BUNDLE_MIN_SOL} SOL (${DEV_BUY_SOL} SOL dev buy + ${BUNDLE_MIN_SOL} SOL bundle).`,
      // proposed text (D19)
      unknown: (name: string) => `${name} · balance unavailable`,
      // proposed text (D19): the name, the missing amount and the address to fund (§10.1)
      insufficient: (name: string, missing: string, address: string) =>
        [
          `${E.warning} INSUFFICIENT FUNDS`,
          `${name} can't cover the smallest launch: ${missing} missing.`,
          `Send SOL to this address, then tap ${name} again:`,
          address,
        ].join("\n"),
      // proposed texts (D19)
      unreadable: (name: string) =>
        `${E.warning} Couldn't read the balance of ${name}. Try again in a moment.`,
      gone: `${E.warning} This wallet no longer exists. Choose another one.`,
    },
    bundle: {
      description: `The dev buys ${DEV_BUY_SOL} SOL at launch, then the bundle buys in the next block. Both are paid from this wallet. Choose the bundle amount.`,
      ok: (amount: string) => `${amount} · ${E.ok} OK`,
      short: (amount: string, missing: string) =>
        `${amount} · ${E.warning} Insufficient funds (${missing} missing)`,
      custom: (max: string) => `Custom · ${BUNDLE_MIN_SOL} to ${max} with this wallet`,
      // proposed text (D19): under the smallest bundle, the Custom line says what it lacks
      customShort: (missing: string) =>
        `Custom · ${E.warning} Insufficient funds (${missing} missing)`,
      // proposed text (D19)
      unreadable: `${E.warning} Couldn't read this wallet's balance. Tap Refresh.`,
      /** `5 SOL`: the bundle clicked. */
      insufficient: (name: string, bundle: string, missing: string) =>
        [
          `${E.warning} INSUFFICIENT FUNDS`,
          `${name} can't cover the ${DEV_BUY_SOL} SOL dev buy and a ${bundle} bundle: ${missing} missing.`,
          `Send SOL to ${name}, then tap Refresh, or pick a smaller bundle.`,
        ].join("\n"),
      // proposed text (D19): the rule of the simulation, with the balance of the wallet
      rules: (max: string) =>
        `Allowed: ${BUNDLE_MIN_SOL} to ${max} with this wallet, up to ${BUNDLE_MAX_DECIMALS} decimals.`,
    },
    recap: {
      description: "Check everything before creating the token.",
      /** `link` is `successLabel`, already an <a> of the caller (proposal). */
      success: (link: string) => `${E.success} Your launch will be posted in the ${link}.`,
      successLabel: "Success channel",
      /** §10.1, D6: the line of the recap, and the alert of Create token, while creation is off. */
      v2Notice: `${E.construction} Token creation arrives in V2.`,
      btnCreate: `${E.createToken} Create token`,
    },
  },

  // Subscribe (§8.2, §8.4, V1-29): the offers and the move from Classic to Premium. Plans,
  // durations, prices and remaining times arrive formatted.
  subscribe: {
    title: `${E.subscribe} SUBSCRIBE`,
    /** `⭐ PREMIUM · 2 DAYS`: the header of the screens of one offer (warning, invoice). */
    offerTitle: (plan: string, duration: string) =>
      `${E.subscribe} ${plan.toUpperCase()} · ${duration.toUpperCase()}`,
    // proposed text (D19): §8.2 has no description, §4.5 wants one
    description: "Choose a pass to unlock Launch Coin. Prices are in USD, paid in SOL.",
    /** `plan` comes from `planLabel`, like on the home screen (§4.3). */
    currentPlan: (plan: string) => `${E.currentPlan} Current plan: ${plan}`,
    noPlan: "None",
    classic: `${E.classic} CLASSIC`,
    premium: `${E.premium} PREMIUM · Best value`,
    planEmoji: { CLASSIC: E.classic, PREMIUM: E.premium } satisfies Record<Plan, string>,
    /** `price` in whole dollars: `2 days · $49`. */
    pass: (duration: string, price: string) => `${duration} · ${price}`,
    /** `Premium · 2 days · $59` */
    offer: (plan: string, duration: string, price: string) => `${plan} · ${duration} · ${price}`,
    /** `🔹 Classic · 2 days`: the buttons of the offers. */
    offerButton: (emoji: string, plan: string, duration: string) =>
      `${emoji} ${plan} · ${duration}`,
    premiumAdds: "Premium adds:",
    /** The mention goes once an AI model is plugged in (§8.1, V1-17). */
    aiGenerator: (modelAvailable: boolean) =>
      modelAvailable
        ? `${E.ok} AI token generator`
        : `${E.ok} AI token generator (AI model coming soon)`,
    upToWallets: (count: number) => `${E.ok} Up to ${formatInt(count)} wallets`,
    prioritySupport: `${E.ok} Priority support`,
    /** §8.4: the flag stays on the offers screen for as long as Premium is active. */
    classicDuringPremium: {
      alert: "You can switch to Classic when Premium expires.",
      flag: "Classic: available when your Premium ends",
    },
    /** The note of the Launch Coin entry without a plan (§10.1, V1-35). */
    launchCoinNeedsPlan: `${E.subscribe} Launch Coin needs an active subscription.`,
    upgrade: {
      warning: `${E.warning} Your remaining Classic time will be lost.`,
      // proposed text (D19)
      description: "Premium starts right away when your payment is received.",
      // proposed text (D19)
      newPlan: (emoji: string, offer: string) => `${emoji} New plan: ${offer}`,
    },
    // The invoice (§8.3, V1-30). Amounts arrive formatted (4 decimals), times as `formatClock`
    // (`30:00`) or `formatTimeUtc`. Only « Invoice expired. » and the status lines come from the
    // context; the other texts are proposed (D19).
    invoice: {
      /** `0.5709 SOL ($59.00)`: rounded up, never short of the amount expected. */
      sendExactly: (amount: string) => `Send exactly ${amount} to:`,
      waiting: (countdown: string) => `${E.waiting} Waiting for payment · expires in ${countdown}`,
      lastCheck: (time: string) => `${E.waiting} Waiting for payment · last check ${time}`,
      // proposed text (D19): the deadline stays visible after « I've paid »
      expiresIn: (countdown: string) => `Expires in ${countdown}.`,
      paymentSent: `${E.waiting} Payment sent, waiting for confirmation…`,
      // proposed text (D19)
      partial: (received: string, remaining: string) =>
        `${E.warning} Partial payment: ${received} received, ${remaining} still to send.`,
      // Toasts of « I've paid »: the screen says the same with its status line.
      notDetected: "Payment not detected yet. It can take up to a minute.",
      // proposed text (D19)
      partialDetected: "Partial payment detected.",
      // proposed texts (D19): a blocked click, then the screen with its line (§4.5)
      notFound: warn("Invoice not found."),
      priceUnavailable: warn("Payments are temporarily unavailable."),
      tooManyInvoices: warn("Too many invoices. Try again in a few minutes."),
      checkFailed: warn("We couldn't check the payment. Try again in a moment."),
      expired: `${E.expired} Invoice expired.`,
      // proposed text (D19)
      expiredNote: (minutes: number) =>
        `The SOL amount was locked for ${minutes} minutes. A new invoice uses the current SOL price.`,
      // proposed texts (D19): what arrived on an invoice that can no longer activate
      partialExpired: (received: string) =>
        `${E.warning} ${received} received. Contact support for a refund.`,
      latePayment: `${E.warning} Payment received after the deadline. Contact support for a refund.`,
      btnPayFromWallet: `${E.payFromWallet} Pay from my wallet`,
      btnPaid: `${E.ok} I've paid`,
      btnNewInvoice: `${E.invoice} New invoice`,
    },
    /**
     * The screen of an invoice paid (§8.3), in the bot and in the message of the worker (V1-32),
     * which knows only the plan and its end. `until` comes from `formatDateTime`.
     */
    paymentReceived: (plan: string, until: string) =>
      `${E.ok} Payment received. ${plan} is active until ${until}.`,
    // The reminder the worker sends before the end of a plan (§8.4, V1-34). Every text is
    // proposed (D19); `left` comes from `planLabel`, `ends` from `formatDateTime`.
    reminder: {
      title: `${E.subscribe} SUBSCRIPTION ENDING`,
      description: (plan: string) =>
        `Your ${plan} plan ends soon. Renew it to keep access to Launch Coin.`,
      left: (label: string) => `${E.plan} ${label}`,
      ends: (at: string) => `${E.updated} Ends ${at}`,
      /** §8.4: buying the same offer again extends the plan. */
      extends: "Buying the same plan again extends your current plan.",
      btnRenew: `${E.renew} Renew`,
    },
    // Pay from my wallet (§8.3, V1-31). Titles, descriptions and the notes are proposed texts
    // (D19); names arrive escaped (raw in an alert), amounts formatted. The lines a withdrawal
    // shows too (amount, fees, network, reason, Try again) are the ones of `wallets.withdraw`.
    payFromWallet: {
      title: `${E.payFromWallet} PAY FROM WALLET`,
      description: "Choose the wallet that pays this invoice.",
      /** §10.1, reused. */
      noWallet: "You have no wallet yet. Create or import one first.",
      /** `⭐ Premium · 2 days · 0.5708 SOL ($59.00)` */
      invoice: (plan: string, duration: string, amount: string) =>
        `${E.subscribe} ${plan} · ${duration} · ${amount}`,
      walletOk: (name: string, balance: string) => `${name} · ${balance} ${E.ok}`,
      walletShort: (name: string, balance: string, missing: string) =>
        `${name} · ${balance} ${E.warning} Insufficient funds (${missing} missing)`,
      /** A balance the RPC could not give (`— SOL`): the click reads it again. */
      walletUnknown: (name: string, balance: string) => `${name} · ${balance}`,
      insufficient: {
        alert: (name: string) => `${name} can't cover this payment.`,
        /** `address` arrives in <code>. */
        note: (name: string, amount: string, missing: string, address: string) =>
          [
            `${E.warning} INSUFFICIENT FUNDS`,
            `${name} can't cover ${amount} + fees: ${missing} missing.`,
            `Send SOL to ${name}, then tap it again:`,
            address,
          ].join("\n"),
      },
      confirm: {
        title: `${E.payFromWallet} CONFIRM PAYMENT`,
        description: "Check the payment, then tap Confirm. The SOL is sent right away.",
        for: (plan: string, duration: string) => `${E.subscribe} For: ${plan} · ${duration}`,
        from: (name: string, address: string, balance: string) =>
          `From: ${name} · ${address} · ${balance}`,
        /** `address` arrives in <code>. */
        to: (address: string) => `To: ${address}`,
        amountUpdated: warn("Amount updated."),
        tooMany: warn("Too many payment attempts. Try again in a few minutes."),
        locked: warn("A payment is already being sent."),
      },
      sending: {
        title: `${E.payFromWallet} SENDING PAYMENT`,
        description: (amount: string, name: string) =>
          `Sending ${amount} from ${name}. This can take a few seconds.`,
      },
      failed: {
        title: `${E.fail} PAYMENT FAILED`,
        description: "The payment could not be sent. Your invoice is still open.",
        from: (name: string, balance: string) => `From: ${name} · ${balance}`,
      },
    },
  },

  // Sending a transaction (§10.2, V1-13): one text per `TxFailure` code, for the withdrawal
  // (V1-14), Pay from my wallet (V1-31) and the V2. Amounts arrive formatted, and the screen
  // adds its own emoji: the same failure is a flag on one screen and a result line on another.
  tx: {
    errors: {
      INVALID_AMOUNT: "Enter an amount greater than 0.",
      /** `missing` is how much the amount plus its fees goes over the balance by, when known. */
      INSUFFICIENT_FUNDS: (missing?: string) =>
        missing === undefined
          ? "Not enough SOL for this amount plus fees."
          : `Not enough SOL for this amount plus fees (${missing} missing).`,
      /** `rentMin` is the rent-exempt minimum of an empty account, `0.00089 SOL`. */
      REMAINING_BELOW_RENT: (rentMin?: string) =>
        rentMin === undefined
          ? "The balance left would be below the rent-exempt minimum. Send Max or leave more."
          : `The balance left would be below the rent-exempt minimum (${rentMin}). Send Max or leave at least ${rentMin}.`,
      DESTINATION_BELOW_RENT: (rentMin?: string) =>
        rentMin === undefined
          ? "This address is empty: send at least the rent-exempt minimum."
          : `This address is empty: send at least ${rentMin}.`,
      TRANSACTION_REJECTED: "The network rejected the transaction.",
      BLOCKHASH_EXPIRED: "The network didn't confirm the transaction in time.",
      CONFIRMATION_UNKNOWN:
        "The transaction was sent but is not confirmed yet. Check the explorer before trying again.",
      RPC_UNAVAILABLE: "Solana devnet is not responding. Try again in a moment.",
    } satisfies Record<TxFailureCode, string | ((amount: string) => string)>,
    /** Added to a failure whose `landed` is `no`, and only then: nothing left the wallet. */
    nothingSent: "Nothing was sent.",
  },

  plans: {
    CLASSIC: "Classic",
    PREMIUM: "Premium",
  } satisfies Record<Plan, string>,

  durations: {
    TWO_DAYS: "2 days",
    ONE_MONTH: "1 month",
  } satisfies Record<Duration, string>,

  /** A plan and its time left (§4.3): the home screen and the offers screen (`planLabel`). */
  planStatus: {
    /** `remaining` comes from `formatRemaining`: `1d 4h left`, `until 12 Oct`. */
    active: (plan: string, remaining: string) => `${plan} · ${remaining}`,
    expired: (plan: string) => `${plan} ${E.warning} expired`,
  },

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
      // The step where the bundle is chosen (decision of 25/09/2026), after the fixed dev buy.
      steps: ["Token", "Bundle", "Recap"],
    },
    LAUNCH: {
      title: `${E.launchCoin} LAUNCH`,
      steps: ["Wallet", "Bundle", "Token", "Recap"],
    },
    // Withdraw (§9.5, proposal: the context has no mockup of its header).
    WITHDRAW: {
      title: `${E.withdraw} WITHDRAW`,
      steps: ["Address", "Amount", "Confirm"],
    },
    /** Withdraw all (§9.3): Max is chosen, so the amount step is skipped. */
    WITHDRAW_ALL: {
      title: `${E.withdraw} WITHDRAW`,
      steps: ["Address", "Confirm"],
    },
  },

  // The admin commands (§11.4, V1-38 to V1-45) and the messages to the admins. « ❌ User not
  // found. », the question of /grant, its result line and the funds flag of /purge are the texts
  // of the context; every other text is proposed (D19). User values arrive escaped, amounts and
  // dates formatted.
  admin: {
    /**
     * The registry of the commands (V1-38): the title of their screens, their line in the command
     * menu of the admins, the syntax reminder. `usage` and `example` are plain text — they hold
     * `<` and `>` — escaped by the builder of the reminder. Each ticket adds its command.
     */
    commands: {
      grant: {
        title: `${E.subscribe} GRANT`,
        menu: "Activate a plan by hand",
        usage: "/grant <id or support code> <classic|premium> <2d|1m>",
        example: "/grant P-123456789 premium 1m",
      },
      whois: {
        title: `${E.account} WHOIS`,
        menu: "Check the plan of a user",
        usage: "/whois <support code or id>",
        example: "/whois P-123456789",
      },
      getall: {
        title: `${E.userData} USER DATA`,
        menu: "Everything about a user, keys on confirmation",
        usage: "/getall <id or support code>",
        example: "/getall 123456789",
      },
      purge: {
        title: `${E.delete} PURGE USER`,
        menu: "Delete all data of a user",
        usage: "/purge <support code or Telegram ID>",
        example: "/purge P-123456789",
      },
    },
    // The errors of every command (V1-38): one format, repeated by V1-42 to V1-44.
    common: {
      invalid: `${E.fail} Invalid command.`,
      usage: (usage: string) => `Usage: ${usage}`,
      example: (example: string) => `Example: ${example}`,
      notFound: `${E.notFound} User not found.`,
      searched: (query: string) => `Searched: ${query}`,
      /** `@username (ID <code>123456789</code>)`: `name` escaped, `id` in <code>. */
      user: (name: string, id: string) => `${name} (ID ${id})`,
      /** /grant and /purge tell the user; Telegram refused (bot blocked, chat gone). */
      notNotified: `${E.info} The user could not be notified.`,
      paymentStatuses: {
        PENDING: "Pending",
        PAID: "Paid",
        SWEPT: "Paid",
        EXPIRED: "Expired",
        CANCELED: "Canceled",
      },
      /** `(0.2000 SOL received)`: a partial amount on an invoice not paid. */
      received: (amount: string) => `(${amount} received)`,
      /** §8.3: SOL arrived on an invoice that ended without activating anything. */
      refund: "refund manually",
      // The plan of an account on /whois and /getall: the date in full, `left` under 72 h.
      noPlan: "No subscription",
      /** `Premium · 1d 4h left · until 16 Sep 2026, 18:32 UTC` */
      planActive: (plan: string, until: string, left?: string) =>
        `${plan} · ${left === undefined ? "" : `${left} · `}until ${until}`,
      /** `plan` is `Classic ⚠️ expired` (`planStatus.expired`). */
      planEnded: (plan: string, ended: string) => `${plan} · ended ${ended}`,
    },
    // /grant (§8.4, §11.4, V1-42). `offer` is `Premium · 1 month`, `user` from `common.user`.
    grant: {
      question: (offer: string, user: string) => `Grant ${offer} to ${user}?`,
      /** `plan` from `planLabel` (the offers screen), `None` without a plan. */
      currentPlan: (plan: string) => `Current plan: ${plan}`,
      ends: (at: string) => `Ends: ${at}`,
      extends: (plan: string, duration: string) =>
        `${E.info} Extends the current ${plan} by ${duration}.`,
      upgradeLoss: `${E.warning} Their remaining Classic time will be lost.`,
      /** §8.4: Classic during Premium is refused, as on the offers screen. */
      premiumActive: (until: string) =>
        `${E.warning} Classic: available when their Premium ends (${until}).`,
      used: "This grant is no longer valid.",
      expired: "This grant has expired. Send /grant again.",
      changed: "The user's plan changed. Check again.",
      /** `✅ Premium active until 15 Oct 2026, 14:32 UTC.` */
      done: (plan: string, until: string) => `${E.ok} ${plan} active until ${until}.`,
      grantedTo: (user: string, offer: string) => `Granted to ${user} · ${offer}`,
      canceled: `${E.cancel} Grant canceled.`,
      /** The message to the user (`GRANT_NOTIFY_USER`), adapted from « Payment received » (§8.3). */
      notice: (plan: string, until: string) => `${E.plan} ${plan} is active until ${until}.`,
    },
    // /whois (§11.4, V1-43): the plan, checked before answering a support request.
    whois: {
      description: "Check the plan before answering a support request.",
      /** `⭐ Premium · until 12 Oct 2026, 14:32 UTC`, from `common.planActive` and the others. */
      plan: (text: string) => `${E.plan} ${text}`,
      supportCode: (code: string) => `Support code: ${code}`,
      wallets: (count: number) =>
        count === 0 ? `${E.wallets} No wallet yet` : `${E.wallets} ${counted(count, "wallet")}`,
      payments: `${E.invoice} LAST PAYMENTS`,
      noPayment: "No payment yet.",
      /** Both codes in <code>. */
      codeMismatch: (typed: string, current: string) =>
        `${E.warning} Code ${typed} doesn't match the current plan. Current code: ${current}.`,
    },
    // /getall (§11.4, V1-43, decision of 16/09/2026): the card is the confirmation of Reveal keys.
    getall: {
      description:
        "Everything support needs about this user. Keys stay hidden until you tap Reveal keys.",
      account: `${E.account} ACCOUNT`,
      /** `@username · Alice` */
      names: (username: string, firstName: string) => `${username} · ${firstName}`,
      joined: (joined: string, lastActive: string) =>
        `Joined ${joined} · Last active ${lastActive}`,
      terms: (version: number, at: string) => `Terms v${version} accepted ${at}`,
      noTerms: "Terms not accepted",
      subscription: `${E.plan} SUBSCRIPTION`,
      aiToday: (used: number, limit: number) => `AI Generate today: ${used}/${limit}`,
      history: "History:",
      /** `   · Classic · 2 days · 10 Sep → 12 Sep 2026 · Expired · Grant` */
      historyLine: (line: string) => `   · ${line}`,
      period: (from: string, to: string) => `${from} → ${to}`,
      subscriptionStatuses: { ACTIVE: "Active", EXPIRED: "Expired" },
      origins: { payment: "Payment", grant: "Grant" },
      purchases: `${E.invoice} PURCHASES`,
      /** Beyond the 20 shown: `🧾 PURCHASES · 20 of 34`. */
      purchasesOf: (shown: number, total: number) =>
        `${E.invoice} PURCHASES · ${shown} of ${formatInt(total)}`,
      noPurchase: "No purchase yet.",
      /** The deposit address of an invoice, shortened. */
      to: (address: string) => `to ${address}`,
      /** `👛 WALLETS · 2 · 4.250 SOL ($439.28)`; no total when the balances are unavailable. */
      wallets: (count: number, total?: string) =>
        `${E.wallets} WALLETS · ${formatInt(count)}${total === undefined ? "" : ` · ${total}`}`,
      walletSources: {
        CREATED: "Created",
        IMPORTED_KEY: "Imported (key)",
        IMPORTED_SEED: "Imported (seed)",
      },
      /** `1. Main · Created · 12 Sep 2026`, the full address below it in <code>. */
      wallet: (index: number, name: string, source: string, created: string) =>
        `${index}. ${name} · ${source} · ${created}`,
      walletAddress: (address: string) => `   ${address}`,
      walletBalance: (balance: string) => `   └ ${E.balance} ${balance}`,
      balanceUnavailable: "Balance unavailable",
      noWallet: "No wallet yet.",
      withdrawals: `${E.withdraw} RECENT WITHDRAWALS`,
      noWithdrawal: "No withdrawal yet.",
      /** The source of a withdrawal: its wallet, gone since, or the sweep of an inactive account. */
      deletedWallet: "Deleted wallet",
      inactivitySweep: "Inactivity sweep",
      /** `Main → 9WzD…AWWM` */
      route: (from: string, to: string) => `${from} → ${to}`,
      withdrawalStatuses: { PENDING: "Pending", CONFIRMED: "Confirmed" },
      failed: (error: string) => `Failed: ${error}`,
      explorer: "Explorer",
      counts: (drafts: number, simulations: number) =>
        `${E.simulate} ${counted(drafts, "token draft")} · ${counted(simulations, "simulation")}`,
      btnReveal: `${E.revealKeys} Reveal keys`,
      /** Under « User not found. »: the account went for inactivity, its SOL to the treasury (V1-45). */
      deletedForInactivity: "Account deleted for inactivity. Transfers to treasury:",
      // Reveal keys (decision of 16/09/2026): a message deleted 60 s after its send.
      expired: "This request has expired. Send /getall again.",
      noWalletToReveal: "No wallet to reveal.",
      keysTitle: `${E.revealKeys} WALLET KEYS`,
      /** `@username · 🆔 <code>123456789</code> · 2 wallets` */
      keysOwner: (user: string, id: string, count: number) =>
        `${user} · ${E.id} ${id} · ${counted(count, "wallet")}`,
      keysWallet: (index: number, name: string, source: string) => `${index}. ${name} · ${source}`,
      address: (address: string) => `Address: ${address}`,
      privateKey: (key: string) => `${E.privateKey} Private key: ${key}`,
      seedPhrase: (phrase: string) => `${E.seedPhrase} Seed phrase: ${phrase}`,
      noSeed: "none (imported with a private key)",
      /** A created or seed wallet stored without its phrase (data older than 16/09/2026). */
      seedUnavailable: "unavailable",
      decryptFailed: `${E.fail} Keys unavailable (decryption failed).`,
      keysWarning: (seconds: number) =>
        `${E.warning} Anyone with these keys controls the wallet. Send them only to the account owner, in private. This message will be deleted in ${seconds} s.`,
      sendFailed: `${E.fail} Couldn't send the keys. Send /getall again.`,
      canceled: `${E.cancel} Canceled. No keys were revealed.`,
      /** The sweeper could not delete a keys message (older than 48 h, rights): a reply to it. */
      notDeleted: `${E.warning} Couldn't delete this message with wallet keys. Delete it yourself now.`,
    },
    // /purge (§11.3, §11.4, V1-44). Names arrive escaped, amounts formatted.
    purge: {
      description:
        "Delete all data of this user. Wallet keys will be erased: funds left on them can't be recovered.",
      user: `${E.account} USER`,
      wallets: `${E.wallets} WALLETS`,
      /** `Main · 7xKX…gAsU · 2.500 SOL` */
      wallet: (name: string, address: string, balance: string) =>
        `${name} · ${address} · ${balance}`,
      noWallet: "No wallet",
      invoices: `${E.invoice} PENDING INVOICES`,
      /** `Premium · 2 days · 0.5708 SOL · expires 14:32 UTC` */
      pendingInvoice: (offer: string, amount: string, time: string) =>
        `${offer} · ${amount} · expires ${time}`,
      /** An invoice ended but still payable (§8.3, 24 h): the end of that window. */
      payableInvoice: (offer: string, amount: string, until: string) =>
        `${offer} · ${amount} · payable until ${until}`,
      noInvoice: "None",
      /** Exact (§11.4): `⚠️ Main still holds 2.500 SOL. Ask the user to withdraw first.` */
      funds: (name: string, amount: string) =>
        `${E.warning} ${name} still holds ${amount} SOL. Ask the user to withdraw first.`,
      pending: (offer: string) =>
        `${E.warning} Invoice ${offer} is still pending. Try again after it expires and its 24 h payment window ends.`,
      payable: (offer: string, until: string) =>
        `${E.warning} Invoice ${offer} can still be paid until ${until}. Try again after that.`,
      balancesUnavailable: `${E.warning} Balances unavailable. Try again later.`,
      subscriptionLost: `${E.warning} The active subscription will be lost.`,
      btnConfirm: `${E.delete} Confirm purge`,
      changed: "The user's data changed. Check the summary again.",
      canceled: `${E.cancel} Purge canceled. Nothing was deleted.`,
      failed: `${E.fail} Purge failed. Nothing was deleted. Try again.`,
      done: `${E.ok} User data deleted. Payment records kept for accounting, detached from the account.`,
      deleted: (counts: {
        wallets: number;
        drafts: number;
        simulations: number;
        aiGenerations: number;
        subscriptions: number;
      }) =>
        `Deleted: ${[
          counted(counts.wallets, "wallet"),
          counted(counts.drafts, "draft"),
          counted(counts.simulations, "simulation"),
          counted(counts.aiGenerations, "AI generation"),
          counted(counts.subscriptions, "subscription"),
        ].join(", ")}.`,
      detached: (counts: { payments: number; withdrawals: number }) =>
        `Detached: ${counted(counts.payments, "payment")}, ${counted(counts.withdrawals, "withdrawal")}.`,
      /** The message to the user, sent right before the deletion (§11.3). */
      userNotice: "Your data has been deleted.",
    },
    // The SOL of an inactive account moved to the treasury, then its user came back (V1-45).
    inactiveRefund: {
      description:
        "The user became active while their inactive account was being deleted. Their SOL was already moved to the treasury and the account was kept. Refund the user by hand.",
      user: (user: string) => `${E.account} User: ${user}`,
      moved: (amount: string) => `Moved to treasury: ${amount}`,
      /** `👛 Main · 7xKX…gAsU · 2.4999 SOL · Tx 5Hq1…Zk9a`: the address and the Tx are links. */
      transfer: (name: string, address: string, amount: string, tx: string) =>
        `${E.wallets} ${name} · ${address} · ${amount} · Tx ${tx}`,
    },
    // The deposit addresses of the invoices (§8.3, V1-33): what the worker moved to the
    // treasury and what an admin must refund by hand. Values arrive formatted and escaped.
    depositAlert: {
      manualRefund: `${E.warning} MANUAL REFUND`,
      oldAddress: `${E.warning} OLD DEPOSIT ADDRESS`,
      sweepFailed: `${E.warning} SWEEP FAILED`,
      PARTIAL_EXPIRED:
        "Partial payment on an expired invoice. The funds were moved to the treasury. Refund the user by hand.",
      LATE_FULL_PAYMENT:
        "Full payment received more than 24 h after the invoice expired or was canceled. No subscription was activated. The funds were moved to the treasury. Refund the user by hand.",
      OLD_ADDRESS:
        "Funds were sent to an old deposit address. They were moved to the treasury. Check with the user.",
      /** `attempts` is `null` for an invoice found unmoved when its key was due to go. */
      SWEEP_FAILED: (attempts: number | null) =>
        attempts === null
          ? "The deposit funds were never moved to the treasury. Check the worker logs."
          : `The deposit funds could not be moved to the treasury after ${attempts} attempts. Check the worker logs.`,
      /** `🧾 Invoice: Premium · 2 days · created 12 Sep 2026, 14:02 UTC` */
      invoice: (plan: string, duration: string, created: string) =>
        `${E.invoice} Invoice: ${plan} · ${duration} · created ${created}`,
      /** `user` is `@username (ID 123456789)` or `ID 123456789`, escaped. */
      user: (user: string) => `${E.account} User: ${user}`,
      userWithName: (username: string, telegramId: string) => `@${username} (ID ${telegramId})`,
      userId: (telegramId: string) => `ID ${telegramId}`,
      deletedAccount: "deleted account",
      expected: (amount: string) => `Expected: ${amount}`,
      received: (amount: string) => `Received: ${amount}`,
      moved: (amount: string) => `Moved to treasury: ${amount}`,
      balance: (amount: string) => `Balance: ${amount}`,
      /** `status` is `Paid`, `Expired` or `Canceled`. */
      status: (status: string) => `Status: ${status}`,
      statuses: { PAID: "Paid", SWEPT: "Paid", EXPIRED: "Expired", CANCELED: "Canceled" },
      /** `short` links to the explorer; `full` is in <code> for a copy. */
      deposit: (short: string, full: string) => `Deposit: ${short}\n${full}`,
      from: (address: string) => `From: ${address}`,
      tx: (link: string) => `Tx: ${link}`,
      reason: (reason: string) => `Reason: ${reason}`,
    },
  },

  // The texts of the Mini App live in their own module: see en-webapp.ts.
  webapp: enWebapp,
} as const;
