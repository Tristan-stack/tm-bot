import { en } from "@launchbot/shared";
import { createLogger, loadEnv } from "@launchbot/shared/server";
import { Api } from "grammy";
import {
  parsePreviewArgs,
  publishToSuccessChannel,
  successChannelDeps,
} from "./success-channel.js";

// A look at the Success post before V2 posts it for real (V1-39):
//   pnpm --filter @launchbot/bot success-post:preview -- --chat <chatId> [--no-image] [--no-links] [--long-description]
// The chat is a private chat with the bot, or a test channel.

const log = createLogger("bot:success-post-preview");

/** A real devnet mint, only so the preview link opens. The §10.4 address is an illustration. */
const PREVIEW_MINT = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const LONG_DESCRIPTION = "otter ".repeat(500);

const args = parsePreviewArgs(process.argv.slice(2));
if (args === undefined) {
  log.error(
    "Usage: success-post:preview --chat <chatId> [--no-image] [--no-links] [--long-description]",
  );
  process.exitCode = 1;
} else {
  const env = loadEnv();
  try {
    const example = en.successPost.example;
    await publishToSuccessChannel(
      new Api(env.BOT_TOKEN),
      {
        launchStatus: "CONFIRMED",
        txSignature: "preview",
        mint: PREVIEW_MINT,
        name: example.name,
        symbol: example.symbol,
        description: args.longDescription ? LONG_DESCRIPTION : example.description,
        devBuyLamports: 3_000_000_000n,
        devTokens: 96_657_870_000_000n,
        ...(args.noLinks
          ? {}
          : {
              website: "https://moonotter.example",
              twitter: "https://x.com/moonotter",
              telegram: "https://t.me/moonotter",
            }),
      },
      {
        ...successChannelDeps(env),
        channelId: args.chatId,
        ...(args.noImage ? { defaultImageUrl: undefined, onMissingImage: "text" as const } : {}),
      },
    );
  } catch (error) {
    log.error({ err: error }, "success_post.preview_failed");
    process.exitCode = 1;
  }
}
