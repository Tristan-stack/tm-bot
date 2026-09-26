import { setTimeout as delay } from "node:timers/promises";
import { en } from "@launchbot/shared";
import { createLogger, loadEnv } from "@launchbot/shared/server";
import { Api } from "grammy";
import {
  parsePreviewArgs,
  publishToSuccessChannel,
  successChannelDeps,
} from "./success-channel.js";

// A look at the Success post before V2 posts it for real (V1-39):
//   pnpm --filter @launchbot/bot success-post:preview -- --chat <chatId> [--no-image] [--no-links]
// The chat is a private chat with the bot, or a test channel.

const log = createLogger("bot:success-post-preview");

/** The Join link. A dropped `getMe` does not cancel the preview: the card still goes out. */
async function resolveBotUrl(api: Api): Promise<string | undefined> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const me = await api.getMe();
      return me.username === undefined ? undefined : `https://t.me/${me.username}`;
    } catch (error) {
      if (attempt < 2) {
        await delay(400 * (attempt + 1));
        continue;
      }
      log.warn({ err: error }, "success_post.preview_bot_url_failed");
      return undefined;
    }
  }
  return undefined;
}

/** A real devnet mint, only so the preview link opens. The §10.4 address is an illustration. */
const PREVIEW_MINT = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

const args = parsePreviewArgs(process.argv.slice(2));
if (args === undefined) {
  log.error("Usage: success-post:preview --chat <chatId> [--no-image] [--no-links]");
  process.exitCode = 1;
} else {
  const env = loadEnv();
  try {
    const example = en.successPost.example;
    const api = new Api(env.BOT_TOKEN);
    const botUrl = await resolveBotUrl(api);
    await publishToSuccessChannel(
      api,
      {
        launchStatus: "CONFIRMED",
        txSignature: "preview",
        mint: PREVIEW_MINT,
        name: example.name,
        symbol: example.symbol,
        description: example.description,
        devBuyLamports: 8_399_000_000n,
        soldLamports: 15_874_000_000n,
        solUsd: 121.74,
        devTokens: 96_657_870_000_000n,
      },
      {
        ...successChannelDeps(env),
        channelId: args.chatId,
        botUrl,
        ...(args.noLinks ? { showLinks: false } : {}),
        ...(args.noImage ? { defaultImageUrl: undefined, onMissingImage: "text" as const } : {}),
      },
    );
  } catch (error) {
    log.error({ err: error }, "success_post.preview_failed");
    process.exitCode = 1;
  }
}
