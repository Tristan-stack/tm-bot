import { createLogger } from "@launchbot/shared/server";
import type { Env } from "@launchbot/shared/server";
import type { Api } from "grammy";

const log = createLogger("bot:channels");

const CHANNEL_VARIABLES = [
  "CHANNEL_BOT_ID",
  "CHANNEL_SUCCESS_ID",
  "CHANNEL_ANNOUNCEMENTS_ID",
] as const satisfies readonly (keyof Env)[];

export type ChannelsEnv = Pick<Env, (typeof CHANNEL_VARIABLES)[number]>;

/**
 * The bot must administer its three channels (§3): without it `getChatMember` fails and nobody
 * gets past the channel screen, and no post goes out (V1-38, V1-39). A fault is logged per
 * channel and never stops the bot: the operator fixes the rights in Telegram, no restart needed.
 */
export async function checkChannelRights(
  api: Pick<Api, "getChatMember">,
  botId: number,
  env: ChannelsEnv,
): Promise<void> {
  await Promise.all(
    CHANNEL_VARIABLES.map(async (variable) => {
      // A channel id is public configuration, not a secret.
      const channel = `${variable} (${env[variable]})`;
      try {
        const member = await api.getChatMember(env[variable], botId);
        if (member.status === "creator") return;
        if (member.status !== "administrator") {
          log.error(
            `Bot is not an administrator of ${channel}: membership checks and posts will fail.`,
          );
          // Proposal: posting is what V1-38 and V1-39 need from an administrator.
        } else if (member.can_post_messages !== true) {
          log.error(`Bot cannot post messages in ${channel}: posts will fail.`);
        }
      } catch (error) {
        log.error(
          { err: error },
          `Could not check the rights of the bot in ${channel}: membership checks and posts will fail.`,
        );
      }
    }),
  );
}
