/**
 * Single source of emojis (D7). Rebuilt from the reference table of the board: the emojis of
 * the context were lost at export. Texts and keyboards take their emojis from here only.
 */
export const E = {
  // Titles and main menu
  launchBot: "🚀",
  launchCoin: "🚀",
  simulate: "📊",
  subscribe: "⭐",
  wallets: "👛",
  support: "🆘",
  terms: "📜",
  privacy: "🔒",
  refresh: "🔄",
  devnet: "🧪",

  // Navigation
  back: "⬅️",
  menu: "🏠",
  cancel: "❌",
  continue: "➡️",
  confirm: "✅",
  joinChannel: "📢",

  // Home
  account: "👤",
  id: "🆔",
  plan: "⭐",
  warning: "⚠️",
  community: "👥",
  announcements: "📣",
  success: "🏆",
  botChannel: "📢",
  solPrice: "📈",
  updated: "🕒",
  nextStep: "➡️",
  allSet: "✅",

  // Token generator
  token: "🪙",
  generate: "🎲",
  ai: "🤖",
  locked: "🔒",
  edit: "✏️",
  image: "🖼",
  website: "🌐",
  x: "🐦",
  telegram: "✈️",
  remove: "🗑",
  links: "🔗",

  // Wallets
  create: "➕",
  import: "📥",
  withdraw: "📤",
  rename: "✏️",
  delete: "🗑",
  explorer: "🔍",
  created: "📅",
  balance: "💰",
  privateKey: "🔑",
  seedPhrase: "🌱",
  destination: "📍",

  // Flows
  devBuy: "💰",
  fees: "⛽",
  duration: "⏱",
  startSim: "▶️",
  createToken: "🚀",
  construction: "🚧",

  // Subscribe
  currentPlan: "📋",
  classic: "🔹",
  premium: "💎",
  invoice: "🧾",
  payFromWallet: "👛",
  waiting: "⏳",
  expired: "⌛",
  ok: "✅",
  renew: "🔄",

  // Flags
  info: "ℹ️",
  comingSoon: "🤖",

  // Support and admin
  contact: "💬",
  publish: "📣",
  checked: "☑️",
  unchecked: "⬜",
  notFound: "❌",
  revealKeys: "🔑",

  // Results
  fail: "❌",
  retry: "🔁",
  close: "✖️",
} as const;

export type EmojiName = keyof typeof E;
