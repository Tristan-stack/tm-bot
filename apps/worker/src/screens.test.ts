import {
  buildDepositAlert,
  buildInactiveRefundAlert,
  buildPaymentReceivedScreen,
  buildReminderScreen,
  createUi,
} from "@launchbot/shared";
import type { AlertInvoice, Screen } from "@launchbot/shared";
import { catalogScreen, screenIssues } from "@launchbot/shared/test";
import type { SentCall } from "@launchbot/shared/test";
import type { Api } from "grammy";
import { describe, expect, it } from "vitest";
import { createTelegramSender } from "./telegram.js";

// Every message the worker sends (V1-32 to V1-34, V1-45) against the rules of §4.5 (V1-46),
// through the real sender: what Telegram would receive. User values are hostile on purpose.

const ui = createUi("devnet");
const HOSTILE = "<b>x</b> & co";
const ESCAPED = "&lt;b&gt;x&lt;/b&gt; &amp; co";
const DEPOSIT = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const SENDER = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
// Built at runtime: an 88-character base58 literal looks like a key to secret scanners.
const SIGNATURE = `5KtP${"1".repeat(80)}x9Qm`;
const NOW = new Date("2026-09-25T14:32:00Z");

const INVOICE: AlertInvoice = {
  plan: "PREMIUM",
  duration: "ONE_MONTH",
  createdAt: new Date("2026-09-24T12:00:00Z"),
  priceUsd: "59.00",
  expectedLamports: 570_820_434n,
  depositAddress: DEPOSIT,
  status: "EXPIRED",
};

/** What the worker's sender hands to the Bot API for one screen. */
async function sent(screen: Screen): Promise<SentCall> {
  const calls: SentCall[] = [];
  const sendMessage = (chat_id: string, text: string, other: object) => {
    calls.push({ method: "sendMessage", payload: { chat_id, text, ...other } });
    return Promise.resolve({ message_id: 1 });
  };
  const sender = createTelegramSender({
    api: { sendMessage } as unknown as Pick<Api, "sendMessage">,
    adminIds: [1],
  });
  await sender.notifyAdmins(screen);
  const call = calls[0];
  if (call === undefined) throw new Error("Nothing was sent");
  const { currentTestName, testPath } = expect.getState();
  catalogScreen(call, { test: currentTestName, file: testPath });
  return call;
}

const WORKER_SCREENS: [string, Screen][] = [
  ["payment received", buildPaymentReceivedScreen(ui, { plan: "CLASSIC", expiresAt: NOW })],
  [
    "plan reminder",
    buildReminderScreen(
      ui,
      {
        plan: "PREMIUM",
        duration: "TWO_DAYS",
        startsAt: new Date("2026-09-24T02:32:00Z"),
        expiresAt: new Date("2026-09-25T20:32:00Z"),
      },
      NOW,
    ),
  ],
  ...(["PARTIAL_EXPIRED", "LATE_FULL_PAYMENT", "OLD_ADDRESS"] as const).map(
    (kind): [string, Screen] => [
      `deposit alert ${kind}`,
      buildDepositAlert(ui, {
        kind,
        invoice: INVOICE,
        user: { telegramId: 123_456_789n, username: "tristan" },
        balanceLamports: 300_000_000n,
        movedLamports: 299_995_000n,
        signature: SIGNATURE,
        from: SENDER,
      }),
    ],
  ),
  [
    "deposit alert SWEEP_FAILED of a deleted account",
    buildDepositAlert(ui, {
      kind: "SWEEP_FAILED",
      invoice: INVOICE,
      user: null,
      balanceLamports: null,
      reason: `BLOCKHASH_EXPIRED: ${HOSTILE}`,
      attempts: 8,
    }),
  ],
  [
    "inactive account refund",
    buildInactiveRefundAlert(ui, {
      user: { telegramId: 123_456_789n, username: null, firstName: HOSTILE },
      transfers: [
        { walletName: HOSTILE, fromAddress: SENDER, lamports: 999_995_000n, signature: SIGNATURE },
      ],
    }),
  ],
];

describe("the messages of the worker (§4.5, V1-46)", () => {
  it.each(WORKER_SCREENS)("%s follows the rules of the screens", async (_name, screen) => {
    const call = await sent(screen);

    expect(screenIssues(call)).toEqual([]);
  });

  it("escapes what a user wrote: a first name, a wallet name, an error detail", async () => {
    const texts = await Promise.all(
      WORKER_SCREENS.filter(([name]) => /SWEEP_FAILED|refund/.test(name)).map(async ([, screen]) =>
        String((await sent(screen)).payload["text"]),
      ),
    );

    for (const text of texts) {
      expect(text).toContain(ESCAPED);
      expect(text).not.toContain(HOSTILE);
    }
  });
});
