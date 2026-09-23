import type { TokenDraftFields } from "@launchbot/db";
import {
  a,
  cancelBtn,
  cbBtn,
  DEV_BUY_PRESETS_SOL,
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
  webAppBtn,
} from "@launchbot/shared";
import type { OptionalLine, Screen, Ui } from "@launchbot/shared";
import { buildWebAppUrl } from "@launchbot/shared/server";
import { devBuySupplyShare } from "@launchbot/sim-engine";
import type { CurveParams } from "@launchbot/sim-engine";

/**
 * Callback data of the flow (§4.4): `sim:<op>[:<arg>]`, no id since the state is in the
 * session. `open` is the button of the menu (V1-08).
 */
export const SIM_CB = {
  open: encodeCallback("sim", "open"),
  preset: (sol: number) => encodeCallback("sim", "dev", sol),
  custom: encodeCallback("sim", "dev", "c"),
  cancelCustom: encodeCallback("sim", "cc"),
  backToToken: encodeCallback("sim", "bk", "tok"),
  backToDevBuy: encodeCallback("sim", "bk", "dev"),
} as const;

/** What the screens after the Token step need of the draft. */
export type SimTokenView = Pick<TokenDraftFields, "name" | "symbol"> & {
  name: string;
  symbol: string;
};

const { sim } = en;

const tokenLine = (draft: SimTokenView): string =>
  sim.token(escapeHtml(draft.name), formatTicker(draft.symbol));

const devBuyLine = (devBuySol: number | undefined): string =>
  devBuySol === undefined
    ? sim.devBuy.notSelected
    : sim.devBuy.selected(formatSolNumber(devBuySol));

/** Step 2/3 (§6): presets, Custom, Back to the Token screen. */
export function buildDevBuyScreen(
  ui: Ui,
  view: { draft: SimTokenView; devBuySol?: number },
  options: { flags?: OptionalLine[] } = {},
): Screen {
  return renderScreen({
    header: ui.flowHeader({ flow: "SIMULATION", step: 2 }),
    description: sim.devBuy.description,
    info: [tokenLine(view.draft), devBuyLine(view.devBuySol)],
    flags: options.flags,
    keyboard: [
      DEV_BUY_PRESETS_SOL.map((sol) => cbBtn(sim.devBuy.btnPreset(sol), SIM_CB.preset(sol))),
      [cbBtn(sim.devBuy.btnCustom, SIM_CB.custom)],
      [cbBtn(en.btn.back, SIM_CB.backToToken)],
    ],
  });
}

/** The Custom input of step 2 (§4.5): the current choice and the bounds above Cancel. */
export function buildCustomAmountScreen(
  ui: Ui,
  view: { draft: SimTokenView; devBuySol?: number },
  options: { flags?: OptionalLine[] } = {},
): Screen {
  return renderInputScreen({
    header: ui.flowHeader({ flow: "SIMULATION", step: 2 }),
    prompt: sim.custom.prompt,
    rules: [tokenLine(view.draft), devBuyLine(view.devBuySol), sim.custom.rules],
    flags: options.flags,
    keyboard: [[cancelBtn(SIM_CB.cancelCustom)]],
  });
}

/** `5 SOL (≈ 15.2% of supply)`: the share the curve gives (§7.1), never dev buy / supply. */
export function formatDevBuyWithShare(devBuySol: number, curve: CurveParams): string {
  const { share } = devBuySupplyShare(curve, devBuySol);
  return sim.recap.withShare(formatSolNumber(devBuySol), formatPct(share, 1));
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
export function renderTokenRecapBlock(draft: TokenDraftFields & SimTokenView): string {
  const links = LINK_FIELDS.flatMap(([column, label]) => {
    const url = draft[column];
    return url === null ? [] : [a(sim.recap.linkLabels[label], url)];
  });
  return tree(sim.recap.block, [
    sim.recap.title(escapeHtml(draft.name), formatTicker(draft.symbol)),
    ...(draft.description === null ? [] : [escapeHtml(draft.description)]),
    sim.recap.image(draft.imageFileId === null ? en.common.none : sim.recap.imageAdded),
    links.length === 0 ? sim.recap.linksNone : sim.recap.links(links),
  ]);
}

export type RecapView = {
  draft: TokenDraftFields & SimTokenView;
  devBuySol: number;
  /** The curve stored in the Simulation: the Mini App computes the position on the same one. */
  curve: CurveParams;
  simId: string;
  webAppUrl: string;
};

/** Step 3/3 (§6): the recap, the DEMO mention, and the `web_app` button of the Mini App. */
export function buildRecapScreen(ui: Ui, view: RecapView): Screen {
  return renderScreen({
    header: ui.flowHeader({ flow: "SIMULATION", step: 3 }),
    description: sim.recap.description,
    info: [
      renderTokenRecapBlock(view.draft),
      [
        sim.recap.devBuy(formatDevBuyWithShare(view.devBuySol, view.curve)),
        sim.recap.duration(SIM_DURATION_SEC / 60),
      ].join("\n"),
    ].join("\n\n"),
    flags: [sim.demoBanner],
    keyboard: [
      [webAppBtn(sim.recap.btnStart, buildWebAppUrl(`/sim/${view.simId}`, view.webAppUrl))],
      navRow(SIM_CB.backToDevBuy, { menu: true }),
    ],
  });
}
