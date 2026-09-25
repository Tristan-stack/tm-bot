import { en } from "../i18n/en.js";

// Not exported by the package: screens get their headers from `createUi(cluster)`, like the
// other helpers of a screen. No header names the network (D24).

/**
 * Screen header: bold title (proposal). `title` and `counter` are trusted HTML from en.ts.
 *
 *     <b>👛 WALLETS · 2/5</b>
 */
export const screenHeader = (title: string, counter: string | undefined): string =>
  `<b>${counter === undefined ? title : `${title} · ${counter}`}</b>`;

export const FLOWS = en.flows;
export type FlowName = keyof typeof FLOWS;

const PROGRESS_DONE = "▰";
const PROGRESS_TODO = "▱";

/** `▰▰▰▱▱▱▱▱▱▱`: `done` of `total` segments, clamped. */
export function progressBar(done: number, total: number): string {
  const filled = Math.min(total, Math.max(0, Math.round(done)));
  return PROGRESS_DONE.repeat(filled) + PROGRESS_TODO.repeat(total - filled);
}

/**
 * Flow header (§5): title with step counter, progress bar, step names.
 *
 *     <b>📊 SIMULATION · STEP 1/3</b>
 *     ▰▱▱
 *     Token › Dev buy › Recap
 *
 * The summary of the choices already made is the `info` block of each screen.
 */
export function flowHeader(flow: FlowName, step: number): string {
  const { title, steps } = FLOWS[flow];
  if (!Number.isInteger(step) || step < 1 || step > steps.length) {
    throw new RangeError(`Step of ${flow} must be from 1 to ${steps.length}, got ${step}`);
  }
  return [
    `<b>${title} · ${en.common.step(step, steps.length)}</b>`,
    progressBar(step, steps.length),
    steps.join(" › "),
  ].join("\n");
}
