import type { UserBalances, WalletBalance } from "@launchbot/db";
import { DAY_MS, en, LAUNCH_COIN, SIM_END_HOLD_MS, solToLamports as sol } from "@launchbot/shared";
import type { PlanStatus, SubscriptionPeriod } from "@launchbot/shared";
import { resetRateLimits } from "@launchbot/shared/server";
import type { Env } from "@launchbot/shared/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  botHarness,
  callbackUpdate,
  chatMember,
  fakeLaunchFunding,
  fakeScheduler,
  feed,
  MAIN_WALLET,
  storedSession,
  telegramError,
  TEST_BALANCES,
  TEST_FEE,
  TEST_LAUNCH_WALLET,
  TEST_SIGNATURE,
  TEST_USER,
  TEST_WALLET,
  testWithdrawal,
  textUpdate,
} from "../../test-harness.js";
import type { DataServices } from "../../services/data.js";
import type { ApiReplies } from "../../test-harness.js";
import { joinedCallback } from "../access/screens.js";
import { SIM_CB } from "../simulation/screens.js";
import { TOKEN_CB } from "../token-step/screens.js";
import { LAUNCH_CB } from "./screens.js";

/** The wallets of the mockups at the balance of a test: Main 4.200 SOL, Test 0.400 SOL at first. */
const mainWith = (lamports: bigint | null): WalletBalance => ({ ...MAIN_WALLET, lamports });
const testWith = (lamports: bigint | null): WalletBalance => ({ ...TEST_WALLET, lamports });

const period = (expiresAt: Date): SubscriptionPeriod => ({
  plan: "CLASSIC",
  duration: "ONE_MONTH",
  startsAt: new Date(Date.now() - DAY_MS),
  expiresAt,
});
const activePlan = (): PlanStatus => ({
  kind: "ACTIVE",
  subscription: period(new Date(Date.now() + 10 * DAY_MS)),
});

beforeEach(resetRateLimits);

/**
 * The bot on fakes with a plan and wallets the test changes as it goes: `wallets` is read at
 * every balance read, `plan` at every check of the plan.
 */
function harness(
  options: {
    plan?: PlanStatus;
    wallets?: WalletBalance[];
    replies?: ApiReplies;
    env?: Partial<Env>;
    launchFunding?: ReturnType<typeof fakeLaunchFunding>;
    /** The simulations the runner takes at once: 0 refuses the chart of a launch. */
    maxActive?: number;
  } = {},
) {
  const world = {
    plan: options.plan ?? activePlan(),
    wallets: options.wallets ?? [mainWith(sol(4.2)), testWith(sol(0.4))],
  };
  const balances = (): UserBalances => ({ ...TEST_BALANCES, wallets: world.wallets });
  const read = vi.fn<DataServices["getUserBalances"]>(() => Promise.resolve(balances()));
  const plans = vi.fn<DataServices["getPlanStatus"]>(() => Promise.resolve(world.plan));
  const replies: ApiReplies = options.replies ?? {};
  const clock = fakeScheduler();
  const h = botHarness({
    replies,
    data: { getPlanStatus: plans, getUserBalances: read },
    env: options.env,
    launchFunding: options.launchFunding,
    // The chart of a launch runs on a virtual clock (V1-26).
    simRunner: { scheduler: clock.scheduler, maxActive: options.maxActive ?? 20 },
  });
  const click = (data: string) => feed(h.bot, callbackUpdate(data, { messageId: 55 }));
  return {
    ...h,
    ...clock,
    world,
    replies,
    read,
    plans,
    click,
    type: (text: string) => feed(h.bot, textUpdate(text)),
    screen: h.api.screen,
    lastAlert: h.api.lastAlert,
    launch: () => storedSession(h.prisma)?.launch,
    freshReads: () => read.mock.calls.filter(([, read]) => read?.skipCache === true).length,
  };
}

/** Step 1, then Main (4.200 SOL): step 2 with its wallet in the session. */
async function atBundle(h: ReturnType<typeof harness>) {
  await h.click(LAUNCH_COIN);
  await h.click(LAUNCH_CB.wallet("w1"));
}

describe("the entry (V1-35)", () => {
  it("checks the channel without cache, then shows step 1", async () => {
    const h = harness();

    await h.click(LAUNCH_COIN);

    expect(h.api.of("getChatMember")).toHaveLength(1);
    expect(h.screen()).toContain("<b>🚀 LAUNCH · STEP 1/4</b>");
    expect(h.screen()).toContain("└ Test · 0.400 SOL ⚠️ Insufficient funds (3.600 SOL missing)");
  });

  it("stops at the channel screen with its note; « I've joined » resumes without a second check", async () => {
    const h = harness({ replies: { getChatMember: chatMember("left") } });

    await h.click(LAUNCH_COIN);
    expect(h.screen()).toContain("🚀 Join the channel to launch a coin.");
    expect(h.screen()).not.toContain("STEP 1/4");

    h.replies["getChatMember"] = chatMember("member");
    await h.click(joinedCallback("launch"));

    expect(h.api.of("getChatMember")).toHaveLength(2);
    expect(h.screen()).toContain("<b>🚀 LAUNCH · STEP 1/4</b>");
  });

  it.each([
    ["no plan", { kind: "NONE" }],
    ["an expired plan", { kind: "EXPIRED", subscription: period(new Date(Date.now() - 1000)) }],
  ] satisfies [string, PlanStatus][])(
    "sends %s to the offers, with the note",
    async (_case, plan) => {
      const h = harness({ plan });

      await h.click(LAUNCH_COIN);

      expect(h.screen()).toContain("<b>⭐ SUBSCRIBE</b>");
      expect(h.screen()).toContain("⭐ Launch Coin needs an active subscription.");
      expect(h.plans).toHaveBeenCalledTimes(1);
    },
  );

  it("sends a user without a wallet to the wallets", async () => {
    const h = harness({ wallets: [] });

    await h.click(LAUNCH_COIN);

    expect(h.screen()).toContain("You have no wallet yet. Create or import one first.");
  });
});

describe("step 1/4 Wallet (V1-35)", () => {
  it("a wallet short of the smallest launch: its note and address, nothing kept", async () => {
    const h = harness();

    await h.click(LAUNCH_COIN);
    await h.click(LAUNCH_CB.wallet("w2"));

    expect(h.screen()).toContain(
      [
        "⚠️ INSUFFICIENT FUNDS",
        "Test can't cover the smallest launch: 3.600 SOL missing.",
        "Send SOL to this address, then tap Test again:",
        `<code>${TEST_WALLET.publicKey}</code>`,
      ].join("\n"),
    );
    expect(h.launch()?.walletId).toBeUndefined();
    expect(h.lastAlert()?.["show_alert"]).not.toBe(true);
  });

  it("a wallet that covers it: kept, then step 2", async () => {
    const h = harness();

    await atBundle(h);

    expect(h.launch()?.walletId).toBe("w1");
    expect(h.screen()).toContain("<b>🚀 LAUNCH · STEP 2/4</b>");
    // The click read the balance fresh, the Refresh limit allowed it (proposal).
    expect(h.freshReads()).toBe(1);
  });

  it("a wallet gone or someone else's: step 1 with the flag, nothing said of it", async () => {
    const h = harness();

    await h.click(LAUNCH_COIN);
    await h.click(LAUNCH_CB.wallet("someone-else"));

    expect(h.screen()).toContain("⚠️ This wallet no longer exists. Choose another one.");
    expect(h.launch()?.walletId).toBeUndefined();
  });

  it("another wallet drops the bundle chosen with the first one", async () => {
    const h = harness({
      wallets: [mainWith(sol(4.2)), { ...TEST_WALLET, id: "w3", name: "Rich", lamports: sol(30) }],
    });

    await atBundle(h);
    await h.click(LAUNCH_CB.preset(3));
    expect(h.launch()?.bundleLamports).toBe(sol(3).toString());

    await h.click(LAUNCH_CB.walletStep);
    await h.click(LAUNCH_CB.wallet("w3"));

    expect(h.launch()).toMatchObject({ walletId: "w3" });
    expect(h.launch()?.bundleLamports).toBeUndefined();
  });

  it("a plan that ends mid-flow: the offers, the session kept", async () => {
    const h = harness();

    await atBundle(h);
    h.world.plan = { kind: "NONE" };
    await h.click(LAUNCH_CB.preset(3));

    expect(h.screen()).toContain("⭐ Launch Coin needs an active subscription.");
    expect(h.launch()).toMatchObject({ walletId: "w1" });
  });
});

describe("step 2/4 Bundle (V1-36, decision of 25/09/2026)", () => {
  it("a bundle the wallet cannot cover: the note and Refresh, nothing kept", async () => {
    const h = harness();

    await atBundle(h);
    await h.click(LAUNCH_CB.preset(5));

    expect(h.screen()).toContain(
      "Main can't cover the 1 SOL dev buy and a 5 SOL bundle: 1.800 SOL missing.",
    );
    expect(h.api.keyboard("editMessageText", -1)).toContainEqual([
      { text: "🔄 Refresh", callback_data: "lc:b:r" },
    ]);
    expect(h.launch()).toMatchObject({ blockedLamports: sol(5).toString() });
    expect(h.launch()?.bundleLamports).toBeUndefined();
  });

  it("a covered bundle: kept, then the Token step with the choices above the block", async () => {
    const h = harness();

    await atBundle(h);
    h.read.mockClear();
    await h.click(LAUNCH_CB.preset(3));

    expect(h.launch()?.bundleLamports).toBe(sol(3).toString());
    expect(h.screen()).toContain("<b>🚀 LAUNCH · STEP 3/4</b>");
    expect(h.screen()).toContain(
      "👛 Wallet: Main · 4.200 SOL\n💰 Dev buy: 1 SOL\n📦 Bundle: 3 SOL",
    );
    expect(h.read).toHaveBeenCalledTimes(1);
  });

  it("keeps the choices above Edit and above each field input of the Token step (§15)", async () => {
    const h = harness();
    const choices = "👛 Wallet: Main · 4.200 SOL\n💰 Dev buy: 1 SOL\n📦 Bundle: 3 SOL";

    await atBundle(h);
    await h.click(LAUNCH_CB.preset(3));
    await h.click(TOKEN_CB.edit("LAUNCH"));
    const edit = h.screen();
    await h.click(TOKEN_CB.editField("LAUNCH", "name"));
    const nameInput = h.screen();
    await h.click(TOKEN_CB.input("LAUNCH", "website"));

    for (const screen of [edit, nameInput, h.screen()]) {
      expect(screen).toContain("<b>🚀 LAUNCH · STEP 3/4</b>");
      expect(screen).toContain(choices);
    }
    expect(nameInput).toContain(`${choices}\nCurrent: —`);
  });

  it("Refresh after funding the wallet: the note goes, the bundle passes", async () => {
    const h = harness();

    await atBundle(h);
    await h.click(LAUNCH_CB.preset(5));
    h.world.wallets = [mainWith(sol(6))];
    resetRateLimits();
    await h.click(LAUNCH_CB.refresh);

    expect(h.screen()).not.toContain("INSUFFICIENT FUNDS");
    expect(h.screen()).toContain("├ 5 SOL · ✅ OK");
    expect(h.screen()).toContain("🕒 Updated 14:32 UTC");
    expect(h.launch()?.blockedLamports).toBeUndefined();

    await h.click(LAUNCH_CB.preset(5));
    expect(h.launch()?.bundleLamports).toBe(sol(5).toString());
  });

  it("two Refresh within 10 s read the chain once", async () => {
    const h = harness();

    await atBundle(h);
    resetRateLimits();
    await h.click(LAUNCH_CB.refresh);
    await h.click(LAUNCH_CB.refresh);

    // One for the wallet click, one for the first Refresh.
    expect(h.freshReads()).toBe(2);
  });

  it("a Refresh with nothing new says it is up to date", async () => {
    const h = harness();

    await atBundle(h);
    h.replies["editMessageText"] = telegramError(
      "editMessageText",
      "Bad Request: message is not modified",
    );
    await h.click(LAUNCH_CB.refresh);

    expect(h.lastAlert()?.["text"]).toBe("Already up to date");
  });

  it("Custom: a wrong amount keeps the input open with its flag", async () => {
    const h = harness();

    await atBundle(h);
    await h.click(LAUNCH_CB.custom);
    expect(h.screen()).toContain("Allowed: 3 to 3.200 SOL with this wallet, up to 3 decimals.");

    await h.type("25");

    expect(h.screen()).toContain("⚠️ Invalid amount. Send a number from 3 to 20 SOL.");
    expect(storedSession(h.prisma)?.pendingInput).toEqual({ kind: "launch_amount" });
  });

  it("Custom: a bundle above the balance ends the input on the note", async () => {
    const h = harness();

    await atBundle(h);
    await h.click(LAUNCH_CB.custom);
    await h.type("7");

    expect(h.screen()).toContain(
      "Main can't cover the 1 SOL dev buy and a 7 SOL bundle: 3.800 SOL missing.",
    );
    expect(storedSession(h.prisma)?.pendingInput).toBeUndefined();
  });

  it("Custom: a covered bundle goes to the Token step", async () => {
    const h = harness();

    await atBundle(h);
    await h.click(LAUNCH_CB.custom);
    await h.type("3.1");

    expect(h.launch()?.bundleLamports).toBe(sol(3.1).toString());
    expect(h.screen()).toContain("<b>🚀 LAUNCH · STEP 3/4</b>");
  });

  it("Custom out of reach (the balance fell under 4 SOL): the note for 3 SOL, no input", async () => {
    const h = harness();

    await atBundle(h);
    h.world.wallets = [mainWith(sol(3.9))];
    await h.click(LAUNCH_CB.custom);

    expect(h.screen()).toContain(
      "Main can't cover the 1 SOL dev buy and a 3 SOL bundle: 0.100 SOL missing.",
    );
    expect(storedSession(h.prisma)?.pendingInput).toBeUndefined();
  });

  it("Cancel shows step 2 again, Back step 1", async () => {
    const h = harness();

    await atBundle(h);
    await h.click(LAUNCH_CB.custom);
    await h.click(LAUNCH_CB.cancelCustom);
    expect(h.screen()).toContain("<b>🚀 LAUNCH · STEP 2/4</b>");

    await h.click(LAUNCH_CB.walletStep);
    expect(h.screen()).toContain("<b>🚀 LAUNCH · STEP 1/4</b>");
    expect(h.launch()?.walletId).toBe("w1");
  });

  it("a wallet deleted meanwhile sends back to step 1", async () => {
    const h = harness();

    await atBundle(h);
    h.world.wallets = [testWith(sol(0.4))];
    await h.click(LAUNCH_CB.preset(3));

    expect(h.screen()).toContain("⚠️ This wallet no longer exists. Choose another one.");
  });
});

describe("steps 3/4 Token and 4/4 Recap (V1-37)", () => {
  /** Through step 2 with a 3 SOL bundle, then a generated token on the launch draft. */
  async function atToken(h: ReturnType<typeof harness>) {
    await atBundle(h);
    await h.click(LAUNCH_CB.preset(3));
    await h.click(TOKEN_CB.generate("LAUNCH"));
  }

  it("Continue with a name and a ticker: the recap", async () => {
    const h = harness();

    await atToken(h);
    await h.click(TOKEN_CB.next("LAUNCH"));

    expect(h.screen()).toContain("<b>🚀 LAUNCH · STEP 4/4</b>");
    expect(h.screen()).toContain("📦 Bundle: 3 SOL (≈ 9.1% of supply)");
    expect(h.screen()).toContain("🧮 Total: 4 SOL (≈ 12.5% of supply)");
    expect(h.screen()).toContain(
      "🚧 Create token moves the dev buy and the bundle to a fresh launch wallet. The token itself arrives in V2.",
    );
  });

  it("Continue without a token: the alert and the Missing flag of the step", async () => {
    const h = harness();

    await atBundle(h);
    await h.click(LAUNCH_CB.preset(3));
    await h.click(TOKEN_CB.next("LAUNCH"));

    expect(h.lastAlert()).toMatchObject({ text: "Add a name and ticker first.", show_alert: true });
    expect(h.screen()).toContain("⚠️ Missing: name, ticker");
  });

  describe("Create token funds a fresh launch wallet (decision of 26/09/2026)", () => {
    /** The recap, then its Create token. */
    async function create(h: ReturnType<typeof harness>) {
      await atToken(h);
      await h.click(TOKEN_CB.next("LAUNCH"));
      await h.click(LAUNCH_CB.create(h.launch()?.createToken ?? ""));
    }

    it("moves the dev buy and the bundle, then shows the launch wallet", async () => {
      const h = harness();

      await create(h);

      expect(h.launchFunding.requests).toEqual([
        {
          userId: TEST_USER.id,
          walletId: "w1",
          debitLamports: sol(4),
          symbol: expect.any(String) as string,
        },
      ]);
      const screens = h.api.of("editMessageText").map((call) => String(call.payload["text"]));
      expect(screens.at(-2)).toContain("⏳ Moving 4.000 SOL from Main to a fresh launch wallet…");
      expect(h.screen()).toContain("✅ Launch wallet funded.");
      expect(h.screen()).toContain(
        `🚀 Launch wallet: <code>${TEST_LAUNCH_WALLET.publicKey}</code>`,
      );
      expect(h.screen()).toContain("👛 From: Main");
      expect(h.api.keyboard("editMessageText", -1)).toContainEqual([
        {
          text: "🔍 Explorer",
          url: `https://explorer.solana.com/address/${TEST_LAUNCH_WALLET.publicKey}?cluster=devnet`,
        },
      ]);
    });

    it("runs the chart of the coin, then sweeps the launch wallet when it ends", async () => {
      const h = harness();

      await create(h);

      // Under the funded screen, as if the coin were live: its dev buy and its bundle, the
      // header of the launch, no SIMULATION nor DEMO mention.
      const [chart] = h.api.of("sendPhoto");
      const caption = String(chart?.payload["caption"]);
      expect(caption.startsWith("<b>🚀 LAUNCH</b>")).toBe(true);
      expect(caption).not.toContain("SIMULATION");
      expect(caption).not.toContain("DEMO");
      const [sim] = h.simulations.rows;
      expect(sim).toMatchObject({ userId: TEST_USER.id, devBuySol: "1", bundleSol: "3" });
      expect(h.launchSweep.swept).toEqual([]);

      await h.click(SIM_CB.sell(sim?.id ?? "", 100));
      expect(h.launchSweep.swept).toEqual([TEST_LAUNCH_WALLET.id]);
      await h.advance(SIM_END_HOLD_MS + 1000);
      // The card: a launch runs once, Menu alone.
      const card = h.api.of("editMessageMedia").at(-1)?.payload;
      const media = card?.["media"] as { type?: string; caption?: string } | undefined;
      expect(media?.type).toBe("animation");
      expect(media?.caption).not.toContain("SIMULATION ENDED");
      expect(media?.caption).not.toContain("DEMO");
      expect(h.api.keyboard("editMessageMedia", -1)).toEqual([
        [{ text: "🏠 Menu", callback_data: "nav:home" }],
      ]);
      expect(h.launchSweep.swept).toHaveLength(1);
    });

    it("sweeps at once, and says why, when the chart cannot start", async () => {
      const h = harness({ maxActive: 0 });

      await create(h);

      expect(h.api.of("sendPhoto")).toHaveLength(0);
      expect(h.screen()).toContain("✅ Launch wallet funded.");
      expect(h.screen()).toContain(en.sim.live.busy.flag);
      expect(h.launchSweep.swept).toEqual([TEST_LAUNCH_WALLET.id]);
    });

    it("funds once for a recap: a second click on it is a stale button", async () => {
      const h = harness();
      await atToken(h);
      await h.click(TOKEN_CB.next("LAUNCH"));
      const token = h.launch()?.createToken ?? "";

      await h.click(LAUNCH_CB.create(token));
      await h.click(LAUNCH_CB.create(token));

      expect(h.launchFunding.requests).toHaveLength(1);
      expect(h.lastAlert()?.["text"]).toBe("This button has expired. Please use the menu.");
    });

    it("counts test amounts: 1/100 leaves the wallet, as the screens say", async () => {
      const h = harness({ env: { LAUNCH_TEST_DIVISOR: 100 } });

      await h.click(LAUNCH_COIN);
      // 0.400 SOL covers the smallest launch divided by 100.
      expect(h.screen()).not.toContain("Insufficient funds");
      expect(h.screen()).toContain(
        "⚠️ Test amounts: only 1/100 of the dev buy and the bundle leaves the wallet.",
      );

      await h.click(LAUNCH_CB.wallet("w1"));
      await h.click(LAUNCH_CB.preset(3));
      await h.click(TOKEN_CB.generate("LAUNCH"));
      await h.click(TOKEN_CB.next("LAUNCH"));
      expect(h.screen()).toContain("💰 Dev buy: 0.01 SOL");
      await h.click(LAUNCH_CB.create(h.launch()?.createToken ?? ""));

      const screens = h.api.of("editMessageText").map((call) => String(call.payload["text"]));
      expect(screens.at(-2)).toContain("⏳ Moving 0.040 SOL from Main to a fresh launch wallet…");
      // What the screen said leaves the wallet is what the service is asked to send.
      expect(h.launchFunding.requests[0]?.debitLamports).toBe(sol(0.04));
    });

    it("shows the recap again with why when nothing left the wallet", async () => {
      const h = harness({
        launchFunding: fakeLaunchFunding({
          fund: () =>
            Promise.resolve({
              status: "refused",
              failure: {
                ok: false,
                code: "INSUFFICIENT_FUNDS",
                landed: "no",
                missingLamports: 12_000_000n,
              },
            }),
        }),
      });

      await create(h);

      expect(h.screen()).toContain("<b>🚀 LAUNCH · STEP 4/4</b>");
      expect(h.screen()).toContain(
        "⚠️ Not enough SOL for this amount plus fees (0.012 SOL missing).",
      );
      // A new recap, a new token.
      expect(h.launch()?.createToken).toMatch(/^[0-9a-f]{8}$/);
    });

    it("says a transfer of the wallet is still in flight on the recap", async () => {
      const h = harness({
        launchFunding: fakeLaunchFunding({
          fund: () => Promise.resolve({ status: "in_progress" }),
        }),
      });

      await create(h);

      expect(h.screen()).toContain("<b>🚀 LAUNCH · STEP 4/4</b>");
      expect(h.screen()).toContain(
        "⏳ A transfer from this wallet is still in progress. Try again in a minute.",
      );
    });

    it("says why a funding failed, and Try again goes back to the recap", async () => {
      const failed = testWithdrawal({
        toAddress: TEST_LAUNCH_WALLET.publicKey,
        lamports: sol(4) - TEST_FEE,
        status: "FAILED",
        kind: "LAUNCH_FUNDING",
        signature: TEST_SIGNATURE,
      });
      const h = harness({
        launchFunding: fakeLaunchFunding({
          fund: () =>
            Promise.resolve({
              status: "failed",
              wallet: MAIN_WALLET,
              withdrawal: failed,
              failure: { ok: false, code: "BLOCKHASH_EXPIRED", landed: "no" },
            }),
        }),
      });

      await create(h);

      expect(h.screen()).toContain("❌ The launch wallet was not funded.");
      expect(h.screen()).toContain("Nothing was sent.");
      await h.click(TOKEN_CB.next("LAUNCH"));
      expect(h.screen()).toContain("<b>🚀 LAUNCH · STEP 4/4</b>");
    });
  });

  it("Back from the recap is the Token step, Back from the Token step is step 2", async () => {
    const h = harness();

    await atToken(h);
    await h.click(TOKEN_CB.next("LAUNCH"));
    await h.click(LAUNCH_CB.tokenStep);
    expect(h.screen()).toContain("<b>🚀 LAUNCH · STEP 3/4</b>");

    await h.click(LAUNCH_CB.bundleStep);
    expect(h.screen()).toContain("<b>🚀 LAUNCH · STEP 2/4</b>");
    expect(h.screen()).toContain("📦 Bundle: 3 SOL");
  });

  it("a recap without its bundle goes back to step 2", async () => {
    const h = harness();

    await atBundle(h);
    await h.click(TOKEN_CB.generate("LAUNCH"));
    await h.click(TOKEN_CB.next("LAUNCH"));

    expect(h.screen()).toContain("<b>🚀 LAUNCH · STEP 2/4</b>");
  });

  it("a Classic subscriber sees AI Generate locked, and the coming-soon mention", async () => {
    const h = harness();

    await atToken(h);
    await h.click(TOKEN_CB.ai("LAUNCH"));

    expect(h.lastAlert()).toMatchObject({
      text: "🔒 AI Generate is a Premium feature.",
      show_alert: true,
    });
    expect(h.screen()).toContain("🔒 AI Generate: Premium only");
    expect(h.screen()).toContain("AI model coming soon");
  });
});
