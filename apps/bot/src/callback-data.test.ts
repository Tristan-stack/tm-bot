import {
  BUNDLE_PRESETS_SOL,
  LAUNCH_COIN,
  NAV_HOME,
  OFFER_CODES,
  SIM_SPEEDS,
  SUB_OPEN,
  TG,
  utf8ByteLength,
  WITHDRAWAL_PRESETS_PCT,
} from "@launchbot/shared";
import { describe, expect, it } from "vitest";
import { ANNOUNCE_CHANNELS } from "./context.js";
import { joinedCallback } from "./features/access/screens.js";
import { ADMIN_CB } from "./features/admin/common.js";
import { MENU } from "./features/home/screen.js";
import { LAUNCH_CB } from "./features/launch/screens.js";
import { SELL_PCTS, SIM_CB } from "./features/simulation/screens.js";
import { PAY_CB } from "./features/subscribe/pay-screens.js";
import { SUB_CB } from "./features/subscribe/screens.js";
import { TOKEN_CB } from "./features/token-step/screens.js";
import { WALLET_CB } from "./features/wallets/screens.js";
import { WITHDRAW_CB } from "./features/wallets/withdraw-screens.js";

// Every callback data the bot can build, with the longest arguments it can get (V1-46): the
// codec throws over 64 bytes, so a builder that could overflow fails here, not on a button.

/** Every id is a cuid: 25 characters (packages/db/prisma/schema.prisma). */
const ID = "c".repeat(25);
/** The nonces of /grant and /getall are 16 hex characters, the confirm tokens 8. */
const NONCE = "f".repeat(16);
/** A Telegram id as long as a bigint gets: 19 digits. */
const TELEGRAM_ID = 9_223_372_036_854_775_807n;

const TOKEN_FLOWS = ["SIMULATION", "LAUNCH"] as const;
const EDITABLE = ["name", "ticker", "description"] as const;
const OPTIONAL = ["image", "website", "x", "telegram"] as const;

const ALL: [string, string][] = [
  ["NAV_HOME", NAV_HOME],
  ["LAUNCH_COIN", LAUNCH_COIN],
  ["SUB_OPEN", SUB_OPEN],
  ...Object.entries(MENU),
  // The resumes of the channel screen: home (V1-08) and launch (V1-35).
  ...["home", "launch"].map((key): [string, string] => [`acc:join:${key}`, joinedCallback(key)]),
  ...Object.entries(WALLET_CB).flatMap(([name, build]): [string, string][] =>
    typeof build !== "function"
      ? [[`WALLET_CB.${name}`, build]]
      : name === "importFormat"
        ? (["KEY", "SEED"] as const).map((format) => [
            `WALLET_CB.importFormat(${format})`,
            WALLET_CB.importFormat(format),
          ])
        : [[`WALLET_CB.${name}`, (build as (id: string) => string)(ID)]],
  ),
  ...Object.entries(WITHDRAW_CB).flatMap(([name, build]): [string, string][] =>
    typeof build !== "function"
      ? [[`WITHDRAW_CB.${name}`, build]]
      : name === "pct"
        ? WITHDRAWAL_PRESETS_PCT.map((pct) => [`WITHDRAW_CB.pct(${pct})`, WITHDRAW_CB.pct(pct)])
        : [[`WITHDRAW_CB.${name}`, WITHDRAW_CB.confirm(NONCE)]],
  ),
  ...TOKEN_FLOWS.flatMap((flow): [string, string][] => [
    [`TOKEN_CB.generate(${flow})`, TOKEN_CB.generate(flow)],
    [`TOKEN_CB.ai(${flow})`, TOKEN_CB.ai(flow)],
    [`TOKEN_CB.edit(${flow})`, TOKEN_CB.edit(flow)],
    ...EDITABLE.map((field): [string, string] => [
      `TOKEN_CB.editField(${flow}, ${field})`,
      TOKEN_CB.editField(flow, field),
    ]),
    ...OPTIONAL.flatMap((field): [string, string][] => [
      [`TOKEN_CB.input(${flow}, ${field})`, TOKEN_CB.input(flow, field)],
      [`TOKEN_CB.remove(${flow}, ${field})`, TOKEN_CB.remove(flow, field)],
    ]),
    [`TOKEN_CB.cancel(${flow})`, TOKEN_CB.cancel(flow)],
    [`TOKEN_CB.next(${flow})`, TOKEN_CB.next(flow)],
  ]),
  // Presets only: a Custom amount is typed, it never travels in callback data.
  ...BUNDLE_PRESETS_SOL.flatMap((sol): [string, string][] => [
    [`SIM_CB.preset(${sol})`, SIM_CB.preset(sol)],
    [`LAUNCH_CB.preset(${sol})`, LAUNCH_CB.preset(sol)],
  ]),
  ...Object.entries(SIM_CB).flatMap(([name, build]): [string, string][] => {
    if (typeof build !== "function") return [[`SIM_CB.${name}`, build]];
    if (name === "sell")
      return SELL_PCTS.map((pct) => [`SIM_CB.sell(${pct})`, SIM_CB.sell(ID, pct)]);
    if (name === "speed") {
      return SIM_SPEEDS.map((speed) => [`SIM_CB.speed(${speed})`, SIM_CB.speed(ID, speed)]);
    }
    return name === "preset" ? [] : [[`SIM_CB.${name}`, (build as (id: string) => string)(ID)]];
  }),
  ...Object.entries(LAUNCH_CB).flatMap(([name, build]): [string, string][] =>
    typeof build !== "function"
      ? [[`LAUNCH_CB.${name}`, build]]
      : name === "wallet"
        ? [[`LAUNCH_CB.wallet`, LAUNCH_CB.wallet(ID)]]
        : [],
  ),
  ...OFFER_CODES.flatMap((code): [string, string][] => [
    [`SUB_CB.buy(${code})`, SUB_CB.buy(code)],
    [`SUB_CB.upgrade(${code})`, SUB_CB.upgrade(code)],
  ]),
  ...(["invoice", "paid", "cancel", "renew", "payFromWallet"] as const).map(
    (name): [string, string] => [`SUB_CB.${name}`, SUB_CB[name](ID)],
  ),
  ["SUB_CB.open", SUB_CB.open],
  ["PAY_CB.wallet", PAY_CB.wallet(ID, ID)],
  ["PAY_CB.confirm", PAY_CB.confirm(NONCE)],
  ["PAY_CB.tryAgain", PAY_CB.tryAgain],
  ...ANNOUNCE_CHANNELS.map((channel): [string, string] => [
    `ADMIN_CB.announceToggle(${channel})`,
    ADMIN_CB.announceToggle(channel, NONCE),
  ]),
  ...(
    [
      "announcePublish",
      "announceEdit",
      "announceCancel",
      "announceRetry",
      "grantConfirm",
      "grantCancel",
      "reveal",
      "revealCancel",
    ] as const
  ).map((name): [string, string] => [`ADMIN_CB.${name}`, ADMIN_CB[name](NONCE)]),
  ["ADMIN_CB.purgeConfirm", ADMIN_CB.purgeConfirm(TELEGRAM_ID)],
  ["ADMIN_CB.purgeCancel", ADMIN_CB.purgeCancel],
];

describe("callback data (§4.4, V1-46)", () => {
  it.each(ALL)("%s fits in 64 bytes with its longest arguments", (_name, data) => {
    expect(utf8ByteLength(data)).toBeLessThanOrEqual(TG.CALLBACK_DATA_MAX_BYTES);
  });

  it("covers every builder of every domain, and gives each button its own data", () => {
    const data = ALL.map(([, value]) => value);

    expect(new Set(data.map((value) => value.split(":")[0]))).toEqual(
      new Set(["nav", "home", "acc", "wal", "tok", "sim", "lc", "sub", "sup", "adm"]),
    );
    // The widest one: the invoice and the wallet of Pay from my wallet (V1-31).
    expect(Math.max(...data.map(utf8ByteLength))).toBe(utf8ByteLength(PAY_CB.wallet(ID, ID)));
  });
});
