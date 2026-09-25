import { createUi } from "@launchbot/shared";
import { captureLogs, resetRateLimits, setLogDestination } from "@launchbot/shared/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_ID,
  botHarness,
  callbackUpdate,
  feed,
  TEST_USER,
  textUpdate,
} from "../../test-harness.js";
import type { SupportDataService } from "@launchbot/db";
import { renderAdminUsageError, renderAdminUserNotFound } from "./common.js";
import { ADMIN_COMMANDS, createAdminGuard } from "./guard.js";

const ui = createUi("devnet");

beforeEach(resetRateLimits);
afterEach(() => {
  setLogDestination(undefined);
});

/** The bot, the user of the tests an admin or not, with a lookup that finds nobody. */
function harness(admin: boolean) {
  const findUser = vi.fn<SupportDataService["findUser"]>(() => Promise.resolve(null));
  const h = botHarness({
    env: { ADMIN_TELEGRAM_IDS: admin ? [ADMIN_ID] : [] },
    admin: {
      support: {
        findUser,
        findUserById: () => Promise.resolve(null),
        loadUserSupportData: () => Promise.reject(new Error("unused")),
        inactivitySweeps: () => Promise.resolve([]),
        walletSecrets: () => Promise.resolve([]),
      },
    },
  });
  return { ...h, findUser };
}

describe("the admin guard (V1-38)", () => {
  it("lets an admin run the commands of the registry", async () => {
    const h = harness(true);

    await feed(h.bot, textUpdate("/whois 42"));

    expect(h.findUser).toHaveBeenCalledWith(42n);
    expect(h.api.text("sendMessage")).toContain("❌ User not found.");
  });

  it.each(ADMIN_COMMANDS)(
    "answers nothing to /%s from anyone else, and logs the denial",
    async (name) => {
      const logs = captureLogs();
      const h = harness(false);

      await feed(h.bot, textUpdate(`/${name} P-987654321 premium 1m`));

      expect(h.api.calls).toEqual([]);
      expect(h.findUser).not.toHaveBeenCalled();
      const denied = logs.find((line) => line.includes("admin.denied")) ?? "";
      expect(denied).toContain(name);
      // The sender and the name of the command only: the arguments name another user.
      expect(denied).not.toContain("987654321");
    },
  );

  it("answers an admin click of anyone else with nothing, not even the stale text", async () => {
    const h = harness(false);

    await feed(h.bot, callbackUpdate("adm:grant:ok:AbCd1234"));
    await feed(h.bot, callbackUpdate("adm:prg:ok:42"));

    expect(h.api.calls.map((call) => call.method)).toEqual([
      "answerCallbackQuery",
      "answerCallbackQuery",
    ]);
    expect(h.api.of("answerCallbackQuery").map((call) => call.payload["text"])).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("makes no admin of an empty list, and reads the ids as numbers or bigints", () => {
    expect(createAdminGuard([]).isAdmin(ADMIN_ID)).toBe(false);
    const guard = createAdminGuard([ADMIN_ID]);
    expect(guard.isAdmin(ADMIN_ID)).toBe(true);
    expect(guard.isAdmin(TEST_USER.telegramId)).toBe(true);
    expect(guard.isAdmin(ADMIN_ID + 1)).toBe(false);
    expect(guard.isAdmin(undefined)).toBe(false);
  });

  it("ignores a command addressed to another bot", async () => {
    const h = harness(true);

    await feed(h.bot, textUpdate("/whois@another_bot 42"));

    expect(h.findUser).not.toHaveBeenCalled();
  });
});

describe("the common errors (V1-38)", () => {
  it("reminds the syntax with an example, the placeholders escaped", () => {
    expect(renderAdminUsageError(ui, "grant").text).toBe(
      [
        "<b>⭐ GRANT</b> · 🧪 Devnet",
        "",
        "❌ Invalid command.",
        "Usage: /grant &lt;id or support code&gt; &lt;classic|premium&gt; &lt;2d|1m&gt;",
        "Example: /grant P-123456789 premium 1m",
      ].join("\n"),
    );
  });

  it("says what was searched, escaped", () => {
    const screen = renderAdminUserNotFound(ui, "whois", "P-<42>");

    expect(screen.text).toBe(
      ["<b>👤 WHOIS</b> · 🧪 Devnet", "", "❌ User not found.", "Searched: P-&lt;42&gt;"].join(
        "\n",
      ),
    );
    expect(screen.reply_markup.inline_keyboard).toEqual([]);
  });

  it.each(["", "@alice", "X-12"])("sends the reminder for /whois %j", async (args) => {
    const h = harness(true);

    await feed(h.bot, textUpdate(`/whois ${args}`.trim()));

    expect(h.findUser).not.toHaveBeenCalled();
    expect(h.api.text("sendMessage")).toContain("❌ Invalid command.");
    expect(h.api.text("sendMessage")).toContain("Example: /whois P-123456789");
  });

  it("refuses an argument in excess", async () => {
    const h = harness(true);

    await feed(h.bot, textUpdate("/purge 42 43"));

    expect(h.api.text("sendMessage")).toContain(
      "Usage: /purge &lt;support code or Telegram ID&gt;",
    );
  });
});
