import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { formatImportedSuccessPost } from "@launchbot/shared";
import { createLogger, loadDotenvOnce } from "@launchbot/shared/server";
import { Logger as GramLogger, LogLevel } from "telegram/extensions/Logger.js";
import { StringSession } from "telegram/sessions/index.js";
import { TelegramClient } from "telegram";
import { createTelegramApi } from "./telegram.js";
import {
  parsePostedState,
  parseRugpilotCard,
  serializePostedState,
} from "./success-source-card.js";
import type { PostedState } from "./success-source-card.js";
import {
  publicError,
  readDefaultImageUrl,
  readStoredSession,
  readTelegramApp,
  sessionInstructions,
  sourceMessageFrom,
  stopsSignIn,
} from "./success-source.js";
import type { TelegramApp } from "./success-source.js";

// With TELEGRAM_SESSION set, posts new cards from @rugpilotprofits into CHANNEL_SUCCESS_ID.
// The photo is DEFAULT_TOKEN_IMAGE_URL, never the source channel's image.
// Without it, signs in once and prints a StringSession.
//   pnpm --filter @launchbot/worker success-source

const CHANNEL = "rugpilotprofits";
const LIMIT = 20;
const MAX_PAGES = 5;
const POST_PAUSE_MS = 1_000;
const STATE_PATH = join(dirname(import.meta.dirname), ".success-source-state.json");

const CHANNEL_ID = /^(-100\d+|@[A-Za-z][A-Za-z0-9_]{4,31})$/;
const BOT_TOKEN = /^\d+:[A-Za-z0-9_-]{30,}$/;

function readPostTarget(
  env: Record<string, string | undefined>,
):
  | { ok: true; botToken: string; channelId: string; imageUrl: string }
  | { ok: false; reason: string } {
  const botToken = env["BOT_TOKEN"]?.trim() ?? "";
  const channelId = env["CHANNEL_SUCCESS_ID"]?.trim() ?? "";
  const imageUrl = readDefaultImageUrl(env);
  if (!BOT_TOKEN.test(botToken)) return { ok: false, reason: "BOT_TOKEN is missing or invalid" };
  if (!CHANNEL_ID.test(channelId)) {
    return { ok: false, reason: "CHANNEL_SUCCESS_ID is missing or invalid" };
  }
  if (imageUrl === undefined) {
    return { ok: false, reason: "DEFAULT_TOKEN_IMAGE_URL is missing or invalid" };
  }
  return { ok: true, botToken, channelId, imageUrl };
}

function openClient(session: StringSession, app: TelegramApp): TelegramClient {
  return new TelegramClient(session, app.apiId, app.apiHash, {
    connectionRetries: 2,
    timeout: 10,
    autoReconnect: false,
    useWSS: true,
    baseLogger: new GramLogger(LogLevel.NONE),
  });
}

function loadState(): PostedState | undefined {
  try {
    return parsePostedState(readFileSync(STATE_PATH, "utf8"));
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT") return new Map();
    return undefined;
  }
}

function saveState(posted: PostedState): void {
  writeFileSync(STATE_PATH, serializePostedState(posted));
}

const log = createLogger("worker:success-source");

async function ask(label: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(label)).trim();
  } finally {
    rl.close();
  }
}

function withTimeout<T>(run: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Telegram did not answer. Check the network and try again.")),
      ms,
    );
    run.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error("Sign-in failed"));
      },
    );
  });
}

async function readChannel(
  app: TelegramApp,
  sessionValue: string,
  target: { botToken: string; channelId: string; imageUrl: string },
): Promise<void> {
  const posted = loadState();
  if (posted === undefined) {
    log.error("The posted-id file is unreadable");
    process.exitCode = 1;
    return;
  }
  const secrets = [app.apiHash, sessionValue, target.botToken];
  const client = openClient(new StringSession(sessionValue), app);
  const keepAlive = setInterval(() => undefined, 1_000);
  try {
    stdout.write("Connecting…\n");
    const connected = await withTimeout(client.connect(), 20_000);
    if (!connected) throw new Error("Telegram did not answer. Check the network and try again.");
    if (!(await client.checkAuthorization())) {
      log.error("TELEGRAM_SESSION is not authorized");
      process.exitCode = 1;
      return;
    }
    const fresh: { id: number; text: string }[] = [];
    let offsetId: number | undefined;
    const maxPages = posted.size === 0 ? 1 : MAX_PAGES;
    for (let page = 0; page < maxPages; page += 1) {
      const raw = await client.getMessages(CHANNEL, {
        limit: LIMIT,
        ...(offsetId === undefined ? {} : { offsetId }),
      });
      if (raw.length === 0) break;
      let reachedKnown = false;
      for (const message of raw) {
        const parsedMessage = sourceMessageFrom(message);
        if (parsedMessage === undefined) continue;
        if (posted.has(parsedMessage.id)) {
          reachedKnown = true;
          break;
        }
        fresh.push({ id: parsedMessage.id, text: parsedMessage.text });
      }
      if (reachedKnown) break;
      const oldestRaw = raw[raw.length - 1];
      const oldest = oldestRaw === undefined ? undefined : sourceMessageFrom(oldestRaw);
      if (oldest === undefined || raw.length < LIMIT) break;
      offsetId = oldest.id;
    }
    const api = createTelegramApi(target.botToken);
    let botUrl: string | undefined;
    try {
      const me = await api.getMe();
      if (me.username !== undefined) botUrl = `https://t.me/${me.username}`;
    } catch {
      // The card is posted without the Join line.
    }
    let postedCount = 0;
    for (const message of fresh.reverse()) {
      const card = parseRugpilotCard(message.text);
      if (card === undefined) continue;
      const caption = formatImportedSuccessPost(card, "mainnet-beta", { botUrl });
      const sent = await api.sendPhoto(target.channelId, target.imageUrl, {
        caption,
        parse_mode: "HTML",
      });
      posted.set(message.id, sent.message_id);
      saveState(posted);
      postedCount += 1;
      stdout.write(`Posted $${card.symbol} (#${message.id}) as message ${sent.message_id}\n`);
      await delay(POST_PAUSE_MS);
    }
    if (postedCount === 0) stdout.write("No new card.\n");
  } catch (error) {
    log.error(publicError(error, secrets));
    process.exitCode = 1;
  } finally {
    clearInterval(keepAlive);
    try {
      await client.disconnect();
    } catch {
      // The read already finished, or the client never connected.
    }
  }
}

loadDotenvOnce();

const parsed = readTelegramApp(process.env);
const storedSession = readStoredSession(process.env);
if (!parsed.ok) {
  log.error(parsed.reason);
  process.exitCode = 1;
} else if (storedSession !== undefined) {
  const target = readPostTarget(process.env);
  if (!target.ok) {
    log.error(target.reason);
    process.exitCode = 1;
  } else {
    await readChannel(parsed.app, storedSession, target);
  }
} else {
  const { app } = parsed;
  const secrets = [app.apiHash];
  const session = new StringSession("");
  const client = openClient(session, app);
  // Node 22+ exits while GramJS is still connecting: its socket does not hold the
  // event loop, so the phone prompt never appears (exit 13).
  const keepAlive = setInterval(() => undefined, 1_000);
  try {
    stdout.write("The code is sent only after the phone number.\n");
    const phone = await ask("Phone number (+33…): ");
    if (phone === "") throw new Error("The phone number is empty");
    secrets.push(phone);
    stdout.write("Connecting…\n");
    const connected = await withTimeout(client.connect(), 20_000);
    if (!connected) throw new Error("Telegram did not answer. Check the network and try again.");
    await client.start({
      phoneNumber: phone,
      phoneCode: async (isCodeViaApp) => {
        stdout.write(
          isCodeViaApp === false ? "Code sent by SMS.\n" : "Code sent. Check the Telegram app.\n",
        );
        const code = await ask("Code: ");
        if (code === "") throw new Error("The code is empty");
        secrets.push(code);
        return code;
      },
      password: async (hint) => {
        const label =
          hint !== undefined && hint !== "" ? `2FA password (${hint}): ` : "2FA password: ";
        const password = await ask(label);
        if (password === "") throw new Error("The 2FA password is empty");
        secrets.push(password);
        return password;
      },
      onError: (error) => {
        log.error(publicError(error, secrets));
        return Promise.resolve(stopsSignIn(error));
      },
    });
    const saved = session.save();
    if (saved === "") throw new Error("Sign-in did not return a session");
    stdout.write(sessionInstructions(saved));
  } catch (error) {
    log.error(publicError(error, secrets));
    process.exitCode = 1;
  } finally {
    clearInterval(keepAlive);
    try {
      await client.disconnect();
    } catch {
      // Sign-in already finished, or the client never connected.
    }
  }
}
