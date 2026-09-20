import { en } from "../i18n/en.js";

// Not exported by the package: screens get their headers from `createUi(cluster)`, which binds
// the badge, so that no caller can drop the Devnet badge by mistake.

const withBadge = (title: string, badge: string | null): string =>
  badge === null ? `<b>${title}</b>` : `<b>${title}</b> · ${badge}`;

/**
 * Screen header: bold title (proposal) and cluster badge. `title` and `counter` are trusted
 * HTML from en.ts.
 *
 *     <b>👛 WALLETS · 2/5</b> · 🧪 Devnet
 */
export const screenHeader = (title: string, counter: string | undefined, badge: string | null) =>
  withBadge(counter === undefined ? title : `${title} · ${counter}`, badge);

export const FLOWS = en.flows;
export type FlowName = keyof typeof FLOWS;

const PROGRESS_DONE = "▰";
const PROGRESS_TODO = "▱";

/**
 * Flow header (§5): title with step counter, progress bar, step names.
 *
 *     <b>📊 SIMULATION · STEP 1/3</b> · 🧪 Devnet
 *     ▰▱▱
 *     Token › Dev buy › Recap
 *
 * The summary of the choices already made is the `info` block of each screen.
 */
export function flowHeader(flow: FlowName, step: number, badge: string | null): string {
  const { title, steps } = FLOWS[flow];
  if (!Number.isInteger(step) || step < 1 || step > steps.length) {
    throw new RangeError(`Step of ${flow} must be from 1 to ${steps.length}, got ${step}`);
  }
  return [
    withBadge(`${title} · ${en.common.step(step, steps.length)}`, badge),
    PROGRESS_DONE.repeat(step) + PROGRESS_TODO.repeat(steps.length - step),
    steps.join(" › "),
  ].join("\n");
}
