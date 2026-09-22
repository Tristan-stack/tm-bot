import { cbBtn, en, encodeCallback, renderScreen, urlBtn, webAppBtn } from "@launchbot/shared";
import type { Button, Screen, Ui } from "@launchbot/shared";
import { buildWebAppUrl } from "@launchbot/shared/server";
import type { Env } from "@launchbot/shared/server";

export const ACCEPT_TERMS = encodeCallback("acc", "terms");

/**
 * `acc:join:<resume>`: `resume` is a key of the resume registry (`home`, `launch`…), where the
 * user goes once in the channel. Throws for a key that cannot go in callback data.
 */
export const joinedCallback = (resume: string) => encodeCallback("acc", "join", resume);

/** `[ 📜 Terms of Service ][ 🔒 Privacy Policy ]`: on the Terms screen and in the main menu. */
export const legalRow = (webAppUrl: string): Button[] => [
  webAppBtn(en.btn.terms, buildWebAppUrl("/terms", webAppUrl)),
  webAppBtn(en.btn.privacy, buildWebAppUrl("/privacy", webAppUrl)),
];

export type AccessScreensEnv = Pick<Env, "WEBAPP_URL" | "CHANNEL_BOT_URL">;

/** Screen 1 (§4.2). The Devnet badge is not in the mockup: the header rule of §4.5 adds it. */
export const buildTermsScreen = (ui: Ui, env: AccessScreensEnv): Screen =>
  renderScreen({
    header: ui.screenHeader(en.access.terms.title),
    description: [en.access.terms.intro, en.access.terms.network, en.access.terms.prompt].join(
      "\n\n",
    ),
    keyboard: [legalRow(env.WEBAPP_URL), [cbBtn(en.access.terms.btnAccept, ACCEPT_TERMS)]],
  });

/**
 * Screen 2 (§4.2). Before a launch it says why it interrupts, and keeps saying it after a
 * click on "I've joined": the note comes first, then the flag (§4.5), both between the
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
