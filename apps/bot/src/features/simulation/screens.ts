import type { TokenDraftFields } from "@launchbot/db";
import {
  a,
  BUNDLE_PRESETS_SOL,
  cancelBtn,
  cbBtn,
  en,
  encodeCallback,
  escapeHtml,
  formatPct,
  formatSolNumber,
  formatTicker,
  navRow,
  renderInputScreen,
  renderScreen,
  SIM_DURATION_SEC,
  tree,
} from "@launchbot/shared";
import type { OptionalLine, Screen, SimSpeed, Ui } from "@launchbot/shared";
import { devBuySupplyShare } from "@launchbot/sim-engine";
import type { CurveParams, SimConfig } from "@launchbot/sim-engine";

/** The three sales of §6.1, in percent of the tokens still held. */
export const SELL_PCTS = [25, 50, 100] as const;
export type SellPct = (typeof SELL_PCTS)[number];

/**
 * Callback data of the domain (§4.4): `sim:<op>[:<simId>][:<arg>]`. The flow needs no id, its
 * state is in the session; the buttons of a running simulation name their row (V1-26).
 * `open` is the button of the menu (V1-08).
 */
export const SIM_CB = {
  open: encodeCallback("sim", "open"),
  preset: (sol: number) => encodeCallback("sim", "b", sol),
  custom: encodeCallback("sim", "b", "c"),
  cancelCustom: encodeCallback("sim", "cc"),
  backToToken: encodeCallback("sim", "bk", "tok"),
  backToBundle: encodeCallback("sim", "bk", "b"),
  /** ▶️ Start simulation: the click runs the row the recap was built on (D14, D21). */
  go: (simId: string) => encodeCallback("sim", "go", simId),
  sell: (simId: string, pct: SellPct) => encodeCallback("sim", "sell", simId, pct),
  pause: (simId: string) => encodeCallback("sim", "pause", simId),
  resume: (simId: string) => encodeCallback("sim", "resume", simId),
  speed: (simId: string, speed: SimSpeed) => encodeCallback("sim", "speed", simId, speed),
  again: (simId: string) => encodeCallback("sim", "again", simId),
} as const;

/** What the screens after the Token step need of the draft: Continue accepted it (§5). */
export type ReadyToken = { name: string; symbol: string };

const { sim } = en;

/** `🪙 Moon Otter · $OTTR`: the token on the flow screens and under the pictures (V1-26). */
export const tokenLine = (name: string, ticker: string): string =>
  sim.token(escapeHtml(name), formatTicker(ticker));

/** The choices of step 2: the fixed dev buy, and the bundle or "not selected yet". */
const choiceLines = (bundleSol: number | undefined): string[] => [
  en.token.summaryDevBuy,
  bundleSol === undefined
    ? sim.bundle.notSelected
    : en.token.summaryBundle(formatSolNumber(bundleSol)),
];

/** Step 2/3 (§6, 25/09/2026): the dev buy of 1 SOL, then the bundle: presets, Custom, Back. */
export function buildBundleScreen(
  ui: Ui,
  view: { draft: ReadyToken; bundleSol?: number },
  options: { flags?: OptionalLine[] } = {},
): Screen {
  return renderScreen({
    header: ui.flowHeader({ flow: "SIMULATION", step: 2 }),
    description: sim.bundle.description,
    info: [tokenLine(view.draft.name, view.draft.symbol), ...choiceLines(view.bundleSol)],
    flags: options.flags,
    keyboard: [
      BUNDLE_PRESETS_SOL.map((sol) => cbBtn(sim.bundle.btnPreset(sol), SIM_CB.preset(sol))),
      [cbBtn(sim.bundle.btnCustom, SIM_CB.custom)],
      [cbBtn(en.btn.back, SIM_CB.backToToken)],
    ],
  });
}

/** The Custom input of step 2 (§4.5): the current choices and the bounds above Cancel. */
export function buildCustomAmountScreen(
  ui: Ui,
  view: { draft: ReadyToken; bundleSol?: number },
  options: { flags?: OptionalLine[] } = {},
): Screen {
  return renderInputScreen({
    header: ui.flowHeader({ flow: "SIMULATION", step: 2 }),
    prompt: sim.custom.prompt,
    rules: [
      tokenLine(view.draft.name, view.draft.symbol),
      ...choiceLines(view.bundleSol),
      sim.custom.rules,
    ],
    flags: options.flags,
    keyboard: [[cancelBtn(SIM_CB.cancelCustom)]],
  });
}

/** `5 SOL (≈ 15.2% of supply)` */
const withShare = (sol: number, share: number): string =>
  sim.recap.withShare(formatSolNumber(sol), formatPct(share, 1));

/**
 * The buys of a launch (§6, §10.1, decision of 25/09/2026): the dev buy, the bundle and their
 * total, each with the share of the supply the curve gives at t = 0 (§7.1), never amount /
 * supply; the bundle's is what it adds after the dev buy. Shared with the recap of a launch
 * (V1-37). Without a bundle (a simulation made before it, and its Run again), the dev buy alone.
 */
export function renderBuyLines(curve: CurveParams, devBuySol: number, bundleSol: number): string[] {
  const devShare = devBuySupplyShare(curve, devBuySol).share;
  const devLine = sim.recap.devBuy(withShare(devBuySol, devShare));
  if (bundleSol === 0) return [devLine];
  const total = devBuySol + bundleSol;
  const totalShare = devBuySupplyShare(curve, total).share;
  return [
    devLine,
    sim.recap.bundle(withShare(bundleSol, totalShare - devShare)),
    sim.recap.total(withShare(total, totalShare)),
  ];
}

/** The link columns of the draft, in the order of the line, with their label. */
const LINK_FIELDS: readonly [keyof TokenDraftFields, keyof typeof sim.recap.linkLabels][] = [
  ["website", "website"],
  ["twitter", "x"],
  ["telegram", "telegram"],
];

/**
 * The TOKEN block of a recap (§6, §10.1): name · ticker, the description when there is one,
 * the image, the links present in the order Website · X · Telegram, each a link to the
 * stored URL (proposal). Shared with the recap of a launch (V1-37).
 */
export function renderTokenRecapBlock(draft: TokenDraftFields & ReadyToken): string {
  const links = LINK_FIELDS.flatMap(([column, label]) => {
    const url = draft[column];
    return url === null ? [] : [a(sim.recap.linkLabels[label], url)];
  });
  return tree(en.token.block, [
    sim.recap.title(escapeHtml(draft.name), formatTicker(draft.symbol)),
    ...(draft.description === null ? [] : [escapeHtml(draft.description)]),
    en.token.image(draft.imageFileId === null ? en.common.none : sim.recap.imageAdded),
    links.length === 0 ? sim.recap.linksNone : sim.recap.links(links),
  ]);
}

export type RecapView = {
  draft: TokenDraftFields & ReadyToken;
  /** The config stored in the Simulation: the run computes the position on the same curve. */
  config: Pick<SimConfig, "devBuySol" | "bundleSol" | "curve">;
  simId: string;
};

/** Step 3/3 (§6): the recap, the DEMO mention, and the Start button that runs the row (V1-26). */
export function buildRecapScreen(
  ui: Ui,
  view: RecapView,
  options: { flags?: OptionalLine[] } = {},
): Screen {
  return renderScreen({
    header: ui.flowHeader({ flow: "SIMULATION", step: 3 }),
    description: sim.recap.description,
    info: [
      renderTokenRecapBlock(view.draft),
      [
        ...renderBuyLines(view.config.curve, view.config.devBuySol, view.config.bundleSol),
        sim.recap.duration(SIM_DURATION_SEC / 60),
      ].join("\n"),
    ].join("\n\n"),
    flags: [sim.demoBanner, ...(options.flags ?? [])],
    keyboard: [
      [cbBtn(sim.recap.btnStart, SIM_CB.go(view.simId))],
      navRow(SIM_CB.backToBundle, { menu: true }),
    ],
  });
}
