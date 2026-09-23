import type { TokenDraftFields } from "@launchbot/db";
import {
  cancelBtn,
  cbBtn,
  en,
  encodeCallback,
  escapeHtml,
  formatLinkForDisplay,
  formatTicker,
  renderInputScreen,
  renderScreen,
  tree,
} from "@launchbot/shared";
import type { Button, CallbackData, OptionalLine, Screen, Ui } from "@launchbot/shared";
import type { TokenFlow, TokenInputField } from "../../context.js";

/** The draft as the screens show it: the seven columns of §13, all nullable. */
export type TokenDraftView = TokenDraftFields;

/** A draft that has never been written: every line shows `—` (proposal). */
export const EMPTY_DRAFT: TokenDraftView = {
  name: null,
  symbol: null,
  description: null,
  imageFileId: null,
  website: null,
  twitter: null,
  telegram: null,
};

/** Name, Ticker, Description: the three fields Edit offers. */
export const EDITABLE_FIELDS = ["name", "ticker", "description"] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];
/** Image and the three links: their own button, and Remove once filled. */
export const OPTIONAL_FIELDS = ["image", "website", "x", "telegram"] as const;
export type OptionalField = (typeof OPTIONAL_FIELDS)[number];

const FLOW_CODE = { SIMULATION: "s", LAUNCH: "l" } as const satisfies Record<TokenFlow, string>;
/** The one place a field is spelled in a callback: the decoders below read this table. */
const FIELD_CODE = {
  name: "n",
  ticker: "t",
  description: "d",
  image: "img",
  website: "web",
  x: "x",
  telegram: "tg",
} as const satisfies Record<TokenInputField, string>;

/** The flow of a `tok:<op>:<flow>` callback, `undefined` for an old button. */
export const tokenFlowOf = (code: string | undefined): TokenFlow | undefined =>
  (Object.keys(FLOW_CODE) as TokenFlow[]).find((flow) => FLOW_CODE[flow] === code);
export const editableFieldOf = (code: string | undefined): EditableField | undefined =>
  EDITABLE_FIELDS.find((field) => FIELD_CODE[field] === code);
export const optionalFieldOf = (code: string | undefined): OptionalField | undefined =>
  OPTIONAL_FIELDS.find((field) => FIELD_CODE[field] === code);
const isOptionalField = (field: TokenInputField): field is OptionalField =>
  (OPTIONAL_FIELDS as readonly string[]).includes(field);

const cb = (op: string, flow: TokenFlow, field?: TokenInputField) =>
  field === undefined
    ? encodeCallback("tok", op, FLOW_CODE[flow])
    : encodeCallback("tok", op, FLOW_CODE[flow], FIELD_CODE[field]);

/**
 * Callback data of the step (§4.4): `tok:<op>:<s|l>[:<field>]`, all under 20 bytes. The
 * router dispatches on the op; each handler reads the flow with `tokenFlowOf`.
 */
export const TOKEN_CB = {
  generate: (flow: TokenFlow) => cb("gen", flow),
  ai: (flow: TokenFlow) => cb("ai", flow),
  edit: (flow: TokenFlow) => cb("ed", flow),
  editField: (flow: TokenFlow, field: EditableField) => cb("ed", flow, field),
  input: (flow: TokenFlow, field: OptionalField) => cb("in", flow, field),
  remove: (flow: TokenFlow, field: OptionalField) => cb("rm", flow, field),
  cancel: (flow: TokenFlow) => cb("cx", flow),
  next: (flow: TokenFlow) => cb("next", flow),
} as const;

/** The step of the Token screen in each flow (§6, §10.1). */
const STEP_OF = { SIMULATION: 1, LAUNCH: 3 } as const satisfies Record<TokenFlow, number>;

export const tokenStepHeader = (ui: Ui, flow: TokenFlow): string =>
  ui.flowHeader({ flow, step: STEP_OF[flow] });

const { token } = en;
const none = en.common.none;

/** A user value, escaped, or `—`. */
const valueOr = (value: string | null, format: (value: string) => string = escapeHtml) =>
  value === null ? none : format(value);

/** The three editable lines of the block. */
const editableLines = (draft: TokenDraftView): string[] => [
  token.name(valueOr(draft.name)),
  token.ticker(valueOr(draft.symbol, formatTicker)),
  token.descriptionLine(valueOr(draft.description)),
];

/** The TOKEN block of §5, with the image and the links. */
export const tokenBlock = (draft: TokenDraftView): string =>
  tree(token.block, [
    ...editableLines(draft),
    token.image(draft.imageFileId === null ? none : token.imageAdded),
    token.website(valueOr(draft.website, (v) => escapeHtml(formatLinkForDisplay("website", v)))),
    token.x(valueOr(draft.twitter, (v) => escapeHtml(formatLinkForDisplay("x", v)))),
    token.telegram(valueOr(draft.telegram, (v) => escapeHtml(formatLinkForDisplay("telegram", v)))),
  ]);

export type TokenStepView = {
  flow: TokenFlow;
  draft: TokenDraftView;
  isPremium: boolean;
  /** Where Back goes: the menu for a simulation, step 2 for a launch. */
  backData: CallbackData;
  /** The choices already made, before the block (§15): the wallet and the dev buy of a launch. */
  summaryLines: string[];
  /** Lines of the AI hooks (V1-17): the quota, after the block. */
  infos: string[];
  flags: OptionalLine[];
  /** Lines of the AI hooks (V1-17): the "coming soon" mention, after the flags (§4.5). */
  notes: string[];
};

/**
 * The Token screen (§5). Pure: header, description, summary, TOKEN block, infos, flags, notes,
 * then the keyboard of the mockup. The AI button is locked without an active Premium.
 */
export function renderTokenStep(ui: Ui, view: TokenStepView): Screen {
  const { flow, draft, isPremium, backData, summaryLines, infos, flags, notes } = view;
  const info = [summaryLines.join("\n"), tokenBlock(draft), infos.join("\n")].filter(
    (block) => block !== "",
  );
  return renderScreen({
    header: tokenStepHeader(ui, flow),
    description: token.description,
    info: info.join("\n\n"),
    flags,
    footer: notes.join("\n"),
    keyboard: [
      [
        cbBtn(token.btnGenerate, TOKEN_CB.generate(flow)),
        cbBtn(isPremium ? token.btnAi : token.btnAiLocked, TOKEN_CB.ai(flow)),
      ],
      [cbBtn(token.btnEdit, TOKEN_CB.edit(flow))],
      [
        cbBtn(token.btnImage, TOKEN_CB.input(flow, "image")),
        cbBtn(token.btnWebsite, TOKEN_CB.input(flow, "website")),
      ],
      [
        cbBtn(token.btnX, TOKEN_CB.input(flow, "x")),
        cbBtn(token.btnTelegram, TOKEN_CB.input(flow, "telegram")),
      ],
      [cbBtn(en.btn.back, backData), cbBtn(en.btn.continue, TOKEN_CB.next(flow))],
    ],
  });
}

/** While a provider of AI Generate works (V1-17): no button, the click was answered already. */
export const buildGeneratingScreen = (ui: Ui, flow: TokenFlow): Screen =>
  renderScreen({
    header: tokenStepHeader(ui, flow),
    description: token.ai.generating,
    keyboard: [],
  });

/** Edit (§5): which of the three fields to change. */
export const buildEditChoiceScreen = (ui: Ui, flow: TokenFlow, draft: TokenDraftView): Screen =>
  renderScreen({
    header: tokenStepHeader(ui, flow),
    description: token.edit.description,
    info: tree(token.block, editableLines(draft)),
    keyboard: [
      [
        cbBtn(token.edit.btnName, TOKEN_CB.editField(flow, "name")),
        cbBtn(token.edit.btnTicker, TOKEN_CB.editField(flow, "ticker")),
        cbBtn(token.edit.btnDescription, TOKEN_CB.editField(flow, "description")),
      ],
      [cancelBtn(TOKEN_CB.cancel(flow))],
    ],
  });

/** The column of the draft each input writes (§13). */
export const COLUMN_OF = {
  name: "name",
  ticker: "symbol",
  description: "description",
  image: "imageFileId",
  website: "website",
  x: "twitter",
  telegram: "telegram",
} as const satisfies Record<TokenInputField, keyof TokenDraftView>;

/** What the input screen shows as "Current": the value stored, the ticker with its `$`. */
function currentOf(field: TokenInputField, draft: TokenDraftView): string | null {
  const value = draft[COLUMN_OF[field]];
  if (value === null) return null;
  if (field === "ticker") return formatTicker(value);
  if (field === "image") return token.imageAdded;
  return value;
}

/**
 * The input of one field (§4.5): the prompt, the current value, the rule, the error of the
 * last try, and Cancel — with Remove for an optional field that is filled.
 */
export function buildFieldInputScreen(
  ui: Ui,
  flow: TokenFlow,
  field: TokenInputField,
  draft: TokenDraftView,
  options: { flags?: OptionalLine[] } = {},
): Screen {
  const texts = token.inputs[field];
  const remove: Button[] =
    isOptionalField(field) && draft[COLUMN_OF[field]] !== null
      ? [cbBtn(token.btnRemove, TOKEN_CB.remove(flow, field))]
      : [];
  return renderInputScreen({
    header: tokenStepHeader(ui, flow),
    prompt: texts.prompt,
    current: currentOf(field, draft),
    rules: [texts.rules],
    flags: options.flags,
    keyboard: [[...remove, cancelBtn(TOKEN_CB.cancel(flow))]],
  });
}
