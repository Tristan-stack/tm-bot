import type { Duration, ImportFormat, Plan, TxFailureCode } from "../constants.js";
import {
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
    /** The summary lines of a launch (§10.1), before the block: `👛 Wallet: Main · 4.200 SOL`. */
    summaryWallet: (line: string) => `${E.wallets} Wallet: ${line}`,
    summaryDevBuy: (amount: string) => `${E.devBuy} Dev buy: ${amount}`,
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
    // Provisional step 2 of a simulation, until V1-22. proposed texts (D19)
    devBuySoon: {
      /** `name` arrives escaped, `ticker` with its `$`. */
      token: (name: string, ticker: string) => `${E.token} ${name} · ${ticker}`,
      description: "The dev buy step is coming soon.",
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

  // The texts of the Mini App live in their own module: see en-webapp.ts.
  webapp: enWebapp,
} as const;
