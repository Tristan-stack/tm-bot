import { en } from "../i18n/en.js";
import { code, escapeHtml } from "../ui/html.js";

/** What the admin screens show of an account: never more than its names and its Telegram id. */
export type AdminUser = { telegramId: bigint; username: string | null; firstName: string | null };

/** `@username`, else the first name, escaped; `null` for an account that has neither. */
export function adminUserName(user: Omit<AdminUser, "telegramId">): string | null {
  if (user.username !== null) return escapeHtml(`@${user.username}`);
  return user.firstName === null ? null : escapeHtml(user.firstName);
}

/** `@username (ID 123456789)`, the id in <code> for a copy; `ID 123456789` without a name. */
export function adminUserText(user: AdminUser): string {
  const id = code(user.telegramId.toString());
  const name = adminUserName(user);
  return name === null ? en.admin.depositAlert.userId(id) : en.admin.common.user(name, id);
}
