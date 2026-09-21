import { signDataCheckString } from "../auth/init-data.js";

// Built at runtime: a literal in the Telegram token format trips secret scanners.
export const TEST_BOT_TOKEN = `123456789:${"AbC-dEf_9".repeat(4)}`;
export const OTHER_BOT_TOKEN = `987654321:${"ZyX-wVu_1".repeat(4)}`;

/**
 * Test helper: builds the raw initData string Telegram would hand to the Mini App for these
 * fields, signed with `botToken`. `auth_date` defaults to now.
 */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    ...fields,
  });
  params.set("hash", signDataCheckString(params, botToken).toString("hex"));
  return params.toString();
}

/** A `user` field as Telegram serializes it. The id is above 2^31, like recent accounts. */
export const telegramUserField = (user: Record<string, unknown> = {}): string =>
  JSON.stringify({ id: 5_000_000_001, first_name: "Tristan", username: "tristan", ...user });
