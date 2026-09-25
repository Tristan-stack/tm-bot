import { cbBtn, en, encodeCallback, renderScreen, urlBtn } from "@launchbot/shared";
import type { Screen, Ui } from "@launchbot/shared";
import type { Env } from "@launchbot/shared/server";

/**
 * `acc:join:<resume>`: `resume` is a key of the resume registry (`home`, `launch`…), where the
 * user goes once in the channel. Throws for a key that cannot go in callback data.
 */
export const joinedCallback = (resume: string) => encodeCallback("acc", "join", resume);

export type AccessScreensEnv = Pick<Env, "CHANNEL_BOT_URL">;

/**
 * The channel screen (§4.2), the only screen of the first access since the Terms were removed
 * (decision of 25/09/2026). Before a launch it says why it interrupts, and keeps saying it after
 * a click on "I've joined": the note comes first, then the flag (§4.5), both between the
 * description and the keyboard.
 */
export const buildChannelScreen = (
  ui: Ui,
  env: AccessScreensEnv,
  { resume, flag }: { resume: string; flag?: string },
): Screen =>
  renderScreen({
    header: ui.screenHeader(en.access.channel.title),
    description: en.access.channel.description,
    info: resume === "launch" ? en.access.channel.launchNote : [],
    flags: [flag],
    keyboard: [
      [urlBtn(en.access.channel.btnJoin, env.CHANNEL_BOT_URL)],
      [cbBtn(en.access.channel.btnJoined, joinedCallback(resume))],
    ],
  });
