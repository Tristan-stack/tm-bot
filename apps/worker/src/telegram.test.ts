import { buildPaymentReceivedScreen, createUi } from "@launchbot/shared";
import { captureLogs, setLogDestination } from "@launchbot/shared/server";
import { GrammyError, HttpError } from "grammy";
import type { Api } from "grammy";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTelegramSender, sendFailureOf } from "./telegram.js";

afterEach(() => {
  setLogDestination(undefined);
});

const apiError = (code: number, description: string) =>
  new GrammyError(
    `Call to 'sendMessage' failed! (${code}: ${description})`,
    { ok: false, error_code: code, description },
    "sendMessage",
    {},
  );

const screen = buildPaymentReceivedScreen(createUi("devnet"), {
  plan: "PREMIUM",
  expiresAt: new Date("2026-09-17T14:32:00Z"),
});

function fakeApi(...failures: (Error | undefined)[]) {
  const sendMessage = vi.fn((chatId: string | number) => {
    const failure = failures.shift();
    return failure === undefined
      ? Promise.resolve({ message_id: 77, chat: { id: chatId } })
      : Promise.reject(failure);
  });
  return { sendMessage } as unknown as Pick<Api, "sendMessage"> & {
    sendMessage: typeof sendMessage;
  };
}

describe("sendFailureOf (V1-32)", () => {
  it("maps the answers of Telegram that decide a retry", () => {
    expect(sendFailureOf(apiError(403, "Forbidden: bot was blocked by the user"))).toBe("BLOCKED");
    expect(sendFailureOf(apiError(400, "Bad Request: chat not found"))).toBe("CHAT_NOT_FOUND");
    expect(sendFailureOf(apiError(429, "Too Many Requests: retry after 5"))).toBe("RATE_LIMITED");
    expect(sendFailureOf(apiError(400, "Bad Request: can't parse entities"))).toBe("ERROR");
    expect(sendFailureOf(apiError(502, "Bad Gateway"))).toBe("ERROR");
    expect(sendFailureOf(new HttpError("Network request for 'sendMessage' failed!", {}))).toBe(
      "ERROR",
    );
  });
});

describe("createTelegramSender", () => {
  it("sends a new message to the private chat, the id as a string, the screen as built", async () => {
    const api = fakeApi();
    const sender = createTelegramSender({ api, adminIds: [] });

    await expect(sender.sendScreen(123_456_789n, screen)).resolves.toEqual({
      ok: true,
      messageId: 77,
    });
    const { text, ...rest } = screen;
    expect(api.sendMessage).toHaveBeenCalledWith("123456789", text, rest);
  });

  it("says why a message did not go, without throwing", async () => {
    captureLogs();
    const api = fakeApi(apiError(403, "Forbidden: bot was blocked by the user"));
    const sender = createTelegramSender({ api, adminIds: [] });

    await expect(sender.sendScreen(1n, screen)).resolves.toEqual({ ok: false, reason: "BLOCKED" });
  });

  it("never logs the bot token an error may quote", async () => {
    const lines = captureLogs();
    // Shaped like a token, built at runtime: no secret-looking literal in the sources.
    const token = `7123456:${"A".repeat(35)}`;
    const api = fakeApi(
      new Error(`request to https://api.telegram.org/bot${token}/sendMessage failed`),
    );
    const sender = createTelegramSender({ api, adminIds: [] });

    await expect(sender.sendScreen(1n, screen)).resolves.toEqual({ ok: false, reason: "ERROR" });
    const logged = lines.join("");
    expect(logged).toContain("telegram.send_failed");
    expect(logged).not.toContain(token);
  });

  it("tells every admin, whatever one of them answers", async () => {
    captureLogs();
    const api = fakeApi(apiError(400, "Bad Request: chat not found"));
    const sender = createTelegramSender({ api, adminIds: [11, 22] });

    await sender.notifyAdmins(screen);

    expect(api.sendMessage.mock.calls.map(([chatId]) => chatId)).toEqual(["11", "22"]);
    const { text, ...rest } = screen;
    expect(api.sendMessage).toHaveBeenLastCalledWith("22", text, rest);
  });
});
