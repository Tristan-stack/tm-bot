import type { UserBalances } from "@launchbot/db";
import type { PlanStatus } from "@launchbot/shared";
import {
  createUi,
  en,
  HOUR_MS,
  isCallbackDataSize,
  LAMPORTS_PER_SOL,
  NAV_HOME,
} from "@launchbot/shared";
import { resetRateLimits } from "@launchbot/shared/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DataServices } from "../../services/data.js";
import {
  BALANCES_READ_AT,
  botHarness,
  callbackUpdate,
  fakeData,
  feed,
  telegramError,
  TEST_ENV,
  TEST_USER,
  textUpdate,
} from "../../test-harness.js";
import type { ApiReplies } from "../../test-harness.js";
import { computeNextStep, loadHomeData } from "./data.js";
import type { HomeData } from "./data.js";
import { buildHomeScreen, MENU } from "./screen.js";

const ui = createUi("devnet");
const NOW = new Date("2026-09-21T14:40:00Z");

const plan = (
  kind: "ACTIVE" | "EXPIRED",
  name: "CLASSIC" | "PREMIUM",
  expiresAt: Date,
): PlanStatus => ({
  kind,
  subscription: { plan: name, duration: "ONE_MONTH", startsAt: NOW, expiresAt },
});
const EXPIRED_CLASSIC = plan("EXPIRED", "CLASSIC", NOW);

/** The user of §4.3: two wallets, no subscription. */
const home = (overrides: Partial<HomeData> = {}): HomeData => ({
  username: "username",
  firstName: "Tristan",
  telegramId: 123456789n,
  subscription: { kind: "NONE" },
  wallets: { count: 2, totalLamports: 4_250_000_000n, hasReadyWallet: true },
  botChannelMembers: 1248,
  activeSubscribers: 767,
  solUsd: 103.36,
  updatedAt: BALANCES_READ_AT,
  now: NOW,
  ...overrides,
});

const textOf = (data: HomeData) => buildHomeScreen(ui, TEST_ENV, data).text;

describe("buildHomeScreen", () => {
  it("renders the mockup of §4.3", () => {
    expect(textOf(home())).toBe(
      [
        "<b>🚀 LAUNCH BOT</b> · 🧪 Devnet",
        "",
        "<b>👤 ACCOUNT</b>",
        "┌ @username",
        "├ 🆔 <code>123456789</code>",
        "├ ⭐ No subscription",
        "└ 👛 2 wallets · 4.250 SOL ($439.28)",
        "",
        "<b>👥 COMMUNITY</b>",
        '┌ 📣 <a href="https://t.me/launchbot_news">Announcements</a>',
        '├ 🏆 <a href="https://t.me/launchbot_success">Success</a>',
        '├ 📢 <a href="https://t.me/launchbot_channel">Bot channel</a> · 1,248 members',
        "└ ⭐ 767 active subscribers",
        "",
        "📈 SOL $103.36",
        "",
        "➡️ Subscribe to unlock Launch Coin.",
        "",
        "🕒 Updated 14:32 UTC",
      ].join("\n"),
    );
  });

  it("is sent as HTML with link previews disabled", () => {
    expect(buildHomeScreen(ui, TEST_ENV, home())).toMatchObject({
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  });

  it("shows the first name of a user without a username", () => {
    expect(textOf(home({ username: null }))).toContain("┌ Tristan\n");
  });

  it("escapes the name", () => {
    const text = textOf(home({ username: null, firstName: "<b>Bold</b> & co" }));

    expect(text).toContain("┌ &lt;b&gt;Bold&lt;/b&gt; &amp; co");
  });

  it("shows the time left under 72 h, and the end date from 72 h", () => {
    const active = (msLeft: number) =>
      textOf(home({ subscription: plan("ACTIVE", "PREMIUM", new Date(NOW.getTime() + msLeft)) }));

    expect(active(72 * HOUR_MS - 60_000)).toContain("├ ⭐ Premium · 2d 23h left");
    expect(active(28 * HOUR_MS)).toContain("├ ⭐ Premium · 1d 4h left");
    expect(active(72 * HOUR_MS)).toContain("├ ⭐ Premium · until 24 Sep");
  });

  it("flags an expired subscription", () => {
    const text = textOf(home({ subscription: EXPIRED_CLASSIC }));

    expect(text).toContain("├ ⭐ Classic ⚠️ expired");
  });

  it("counts the wallets: none, one, several", () => {
    const wallets = (count: number, totalLamports: bigint) =>
      textOf(home({ wallets: { count, totalLamports, hasReadyWallet: false } }));

    expect(wallets(0, 0n)).toContain("└ 👛 No wallet yet");
    expect(wallets(1, 2_500_000_000n)).toContain("└ 👛 1 wallet · 2.500 SOL ($258.40)");
    expect(wallets(2, 4_250_000_000n)).toContain("└ 👛 2 wallets · 4.250 SOL ($439.28)");
  });

  it("hides every USD amount when the price is unknown", () => {
    const text = textOf(home({ solUsd: null }));

    expect(text).toContain("📈 SOL —");
    expect(text).toContain("└ 👛 2 wallets · 4.250 SOL\n");
    expect(text).not.toContain("$");
  });

  it("says so when the balances are unavailable", () => {
    const text = textOf(
      home({ wallets: { count: 2, totalLamports: null, hasReadyWallet: false } }),
    );

    expect(text).toContain("└ 👛 2 wallets · balance unavailable");
  });

  it("keeps the member line when the count is unknown", () => {
    expect(textOf(home({ botChannelMembers: null }))).toContain("Bot channel</a> · — members");
  });

  it("uses the singular for one member and one subscriber", () => {
    const text = textOf(home({ botChannelMembers: 1, activeSubscribers: 1 }));

    expect(text).toContain("· 1 member\n");
    expect(text).toContain("└ ⭐ 1 active subscriber\n");
  });

  it("lays the main menu out in five rows, without Stats, Referrals or legal pages", () => {
    const keyboard = buildHomeScreen(ui, TEST_ENV, home()).reply_markup.inline_keyboard;

    expect(keyboard).toEqual([
      [{ text: "🚀 Launch Coin", callback_data: "lc:open" }],
      [{ text: "📊 Simulate a Launch", callback_data: "sim:open" }],
      [{ text: "⭐ Subscribe", callback_data: "sub:open" }],
      [
        { text: "👛 Wallets", callback_data: "wal:list" },
        { text: "🆘 Support", callback_data: "sup:open" },
      ],
      [{ text: "🔄 Refresh", callback_data: "home:refresh" }],
    ]);
    expect(JSON.stringify(keyboard)).not.toMatch(/stats|referral|terms|privacy/i);
  });

  it("keeps every callback data of the menu within 64 bytes", () => {
    for (const data of [...Object.values(MENU), NAV_HOME]) {
      expect(isCallbackDataSize(data)).toBe(true);
    }
  });
});

describe("computeNextStep", () => {
  const step = (overrides: Partial<HomeData>) => computeNextStep(home(overrides));
  const active = plan("ACTIVE", "CLASSIC", NOW);
  const noWallet = { count: 0, totalLamports: 0n, hasReadyWallet: false };
  const unfunded = { count: 1, totalLamports: 0n, hasReadyWallet: false };
  const funded = { count: 1, totalLamports: LAMPORTS_PER_SOL * 2n, hasReadyWallet: true };

  it("asks for a wallet first, even without a subscription", () => {
    expect(step({ wallets: noWallet })).toBe("create_wallet");
    expect(step({ wallets: noWallet, subscription: active })).toBe("create_wallet");
  });

  it("then for a subscription, an expired one included", () => {
    expect(step({ wallets: funded })).toBe("subscribe");
    expect(step({ wallets: funded, subscription: EXPIRED_CLASSIC })).toBe("subscribe");
  });

  it("then for funds, unknown balances counting as not ready", () => {
    expect(step({ wallets: unfunded, subscription: active })).toBe("fund_wallet");
    expect(
      step({
        wallets: { count: 1, totalLamports: null, hasReadyWallet: false },
        subscription: active,
      }),
    ).toBe("fund_wallet");
  });

  it("is all set with a subscription and a ready wallet", () => {
    expect(step({ wallets: funded, subscription: active })).toBe("all_set");
    expect(textOf(home({ wallets: funded, subscription: active }))).toContain("✅ You're all set.");
  });
});

describe("loadHomeData", () => {
  const load = (overrides: Partial<DataServices> = {}) =>
    loadHomeData(fakeData(overrides), TEST_USER, { skipBalanceCache: false, now: NOW });

  const balancesOf = (lamports: bigint | null): UserBalances => ({
    wallets: [{ id: "w1", name: "Main", publicKey: "pk-main", createdAt: NOW, lamports }],
    totalLamports: lamports,
    fetchedAt: BALANCES_READ_AT,
    status: lamports === null ? "unavailable" : "fresh",
  });

  it("looks for a wallet that is ready among the balances", async () => {
    const ready = (lamports: bigint | null) =>
      load({ getUserBalances: () => Promise.resolve(balancesOf(lamports)) }).then(
        (data) => data.wallets.hasReadyWallet,
      );

    // 4 SOL: the dev buy and the smallest bundle (D13, decision of 25/09/2026).
    expect(await ready(3_999_999_999n)).toBe(false);
    expect(await ready(4_000_000_000n)).toBe(true);
  });

  it("dates the screen from the balances it shows", async () => {
    const data = await load();

    expect(data.updatedAt).toBe(BALANCES_READ_AT);
    expect(data.now).toBe(NOW);
  });

  it("still counts the wallets when their balances are unavailable", async () => {
    const data = await load({ getUserBalances: () => Promise.resolve(balancesOf(null)) });

    expect(data.wallets).toEqual({ count: 1, totalLamports: null, hasReadyWallet: false });
  });

  it("shows the plan status as the database reads it (V1-27)", async () => {
    const premium = plan("ACTIVE", "PREMIUM", new Date(NOW.getTime() + HOUR_MS));
    const data = await load({ getPlanStatus: () => Promise.resolve(premium) });

    expect(data.subscription).toBe(premium);
  });
});

function harness(overrides: Partial<DataServices> = {}, replies: ApiReplies = {}) {
  const { bot, api, data } = botHarness({ data: overrides, replies });
  return { bot, api, getUserBalances: vi.spyOn(data, "getUserBalances") };
}

beforeEach(resetRateLimits);

describe("home handlers", () => {
  it("sends the home screen as a new message on /start", async () => {
    const { bot, api, getUserBalances } = harness();

    await feed(bot, textUpdate("/start"));

    expect(api.of("sendMessage")).toHaveLength(1);
    expect(api.of("editMessageText")).toEqual([]);
    expect(api.text("sendMessage")).toContain("└ 👛 2 wallets · 4.250 SOL ($439.28)");
    expect(getUserBalances).toHaveBeenCalledExactlyOnceWith(TEST_USER.id, { skipCache: false });
  });

  it("edits the screen in place on Back and Menu", async () => {
    const { bot, api, getUserBalances } = harness();

    await feed(bot, callbackUpdate(NAV_HOME, { messageId: 55 }));

    expect(api.of("sendMessage")).toEqual([]);
    expect(api.of("editMessageText")[0]?.payload).toMatchObject({ message_id: 55 });
    expect(api.text("editMessageText")).toContain("<b>🚀 LAUNCH BOT</b> · 🧪 Devnet");
    // Only a Refresh may skip the balance cache.
    expect(getUserBalances).toHaveBeenCalledExactlyOnceWith(TEST_USER.id, { skipCache: false });
    expect(api.of("answerCallbackQuery")[0]?.payload["text"]).toBeUndefined();
  });

  it("sends a new message when the screen can no longer be edited", async () => {
    const { bot, api } = harness(
      {},
      { editMessageText: telegramError("editMessageText", "Bad Request: message can't be edited") },
    );

    await feed(bot, callbackUpdate(NAV_HOME));

    expect(api.of("sendMessage")).toHaveLength(1);
  });

  it("skips the balance cache on Refresh, and answers without a text", async () => {
    const { bot, api, getUserBalances } = harness();

    await feed(bot, callbackUpdate(MENU.refresh, { messageId: 55 }));

    expect(getUserBalances).toHaveBeenCalledExactlyOnceWith(TEST_USER.id, { skipCache: true });
    expect(api.of("editMessageText")[0]?.payload).toMatchObject({ message_id: 55 });
    expect(api.of("answerCallbackQuery")[0]?.payload["text"]).toBeUndefined();
  });

  it("reads the cache, without an error, for a Refresh less than 10 s after another", async () => {
    const { bot, api, getUserBalances } = harness();

    await feed(bot, callbackUpdate(MENU.refresh));
    await feed(bot, callbackUpdate(MENU.refresh));

    expect(getUserBalances.mock.calls.map(([, options]) => options)).toEqual([
      { skipCache: true },
      { skipCache: false },
    ]);
    expect(api.text("editMessageText", 1)).not.toContain("Too many");
  });

  it("answers Already up to date, as a toast, when nothing changed", async () => {
    const { bot, api } = harness(
      {},
      { editMessageText: telegramError("editMessageText", "Bad Request: message is not modified") },
    );

    await feed(bot, callbackUpdate(MENU.refresh));

    expect(api.of("answerCallbackQuery")[0]?.payload).toMatchObject({
      text: "Already up to date",
      show_alert: false,
    });
    expect(api.of("sendMessage")).toEqual([]);
  });

  it("shows the home screen when the price and the member count are unknown", async () => {
    const { bot, api } = harness({
      getSolUsdPrice: () => Promise.resolve(null),
      getBotChannelMemberCount: () => Promise.resolve(null),
    });

    await feed(bot, textUpdate("/start"));

    expect(api.text("sendMessage")).toContain("📈 SOL —");
    expect(api.text("sendMessage")).not.toContain("$");
  });

  it("answers the expired-button text for an unknown nav or home action", async () => {
    const { bot, api } = harness();

    await feed(bot, callbackUpdate("nav:elsewhere"));
    await feed(bot, callbackUpdate("home:unknown"));

    expect(api.of("answerCallbackQuery").map((call) => call.payload["text"])).toEqual([
      en.common.staleButton,
      en.common.staleButton,
    ]);
  });
});
