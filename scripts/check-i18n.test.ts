import { describe, expect, it } from "vitest";
import { checkI18n, findTexts } from "./check-i18n.js";

const find = (source: string) =>
  findTexts("probe.ts", source).map(({ rule, text }) => `${rule}: ${text}`);

describe("findTexts (§14, V1-46)", () => {
  it("finds a literal handed to Telegram, to a screen or to a button", () => {
    expect(
      find(`
        await ctx.reply("Hello");
        await ctx.api.sendMessage(chatId, cond ? en.a : "Nope");
        await ctx.answerCallbackQuery({ text: "Too late", show_alert: true });
        renderScreen({ header, description: "Pick one", info: [en.x, \`\${n} SOL\`], keyboard });
        cbBtn("Back", data);
        notify(ctx, "Done");
      `),
    ).toEqual([
      "sent: Hello",
      "sent: Nope",
      "sent: Too late",
      "sent: Pick one",
      "sent: {} SOL",
      "sent: Back",
      "sent: Done",
    ]);
  });

  it("finds a sentence written anywhere, but not in an error, a log, SQL or a zod issue", () => {
    expect(
      find(`
        const label = "Welcome back";
        log.info({ id }, "announce.published");
        log.warn("Could not tell the user about the error");
        throw new Error("Refusing to start: BOT_TOKEN rejected by Telegram.");
        await client.query("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", [name]);
        ctx.addIssue({ code: "custom", message: "Not a Telegram id or a support code" });
      `),
    ).toEqual(["sentence: Welcome back"]);
  });

  it("lets the texts of en.ts, the values of the code and the separators through", () => {
    expect(
      find(`
        import { en } from "@launchbot/shared";
        type Mode = "new" | "edit";
        await ctx.reply(en.common.genericError, { parse_mode: "HTML" });
        renderScreen({ header: ui.screenHeader(texts.title), description: [a, b].join(" · "), keyboard });
        cbBtn(\`\${E.back} \${en.btn.back}\`, NAV_HOME);
        if (state.status === "PREVIEW") encodeCallback("adm", "ann", "pub", id);
      `),
    ).toEqual([]);
  });
});

describe("the texts of the bot and the worker (§14, V1-46)", () => {
  it("all come from packages/shared/src/i18n/en.ts", () => {
    expect(checkI18n()).toEqual([]);
  });
});
