import type { TokenDraft, TokenDraftPatch, TokenDraftService } from "@launchbot/db";
import {
  en,
  generateLocalToken,
  hasNameAndTicker,
  missingRequiredFields,
  parseTokenField,
  TOKEN_IMAGE_MAX_BYTES,
  TOKEN_IMAGE_MIME_TYPES,
  TOKEN_INPUT_TIMEOUT_MS,
} from "@launchbot/shared";
import type {
  AiProviders,
  CallbackData,
  OptionalLine,
  Screen,
  TokenFieldError,
  Ui,
} from "@launchbot/shared";
import { consumeRateLimit } from "@launchbot/shared/server";
import type { Message } from "grammy/types";
import type { BotContext, TokenFlow, TokenInputField, TokenStepState } from "../../context.js";
import { tooManyActions } from "../../middleware/rate-limit.js";
import type { InputHandler, InputRouter } from "../../navigation/inputs.js";
import { notify } from "../../navigation/notify.js";
import { blockWithFlag, showScreen } from "../../navigation/show-screen.js";
import type { Block, ShowMode } from "../../navigation/show-screen.js";
import type { CallbackHandler, CallbackRouter } from "../../router/callback-router.js";
import type { AiGenerateService } from "../../services/ai/ai-generate.js";
import type { DataServices } from "../../services/data.js";
import { createAiHooks } from "./ai-hooks.js";
import {
  buildEditChoiceScreen,
  buildFieldInputScreen,
  COLUMN_OF,
  editableFieldOf,
  EMPTY_DRAFT,
  optionalFieldOf,
  renderTokenStep,
  tokenFlowOf,
} from "./screens.js";

/** A draft Continue accepted: the name and the ticker are there (§5). */
export type ReadyTokenDraft = TokenDraft & { name: string; symbol: string };

/**
 * What a flow tells the step (V1-22 for the simulation, V1-37 for the launch): where Back goes,
 * what to show before the block, and what Continue does. The draft id lives in the session of
 * the step, per flow.
 */
export type TokenStepConfig = {
  flow: TokenFlow;
  /** The menu for a simulation, step 2 for a launch: a button that only navigates (§4.4). */
  backData: CallbackData;
  /** LAUNCH: the wallet and the dev buy already chosen (§15). */
  summaryLines?: (ctx: BotContext) => Promise<string[]>;
  onContinue: (ctx: BotContext, draft: ReadyTokenDraft) => Promise<unknown>;
};

/** The extension point of AI Generate (V1-17): its lines on the screen, and its click. */
export type TokenStepAiHooks = {
  extraLines: (
    ctx: BotContext,
    info: { isPremium: boolean },
  ) => Promise<{ infos: string[]; notes: string[] }>;
  onAiGenerate: (ctx: BotContext, flow: TokenFlow) => Promise<unknown>;
};

export type TokenStepDeps = {
  ui: Ui;
  drafts: TokenDraftService;
  data: Pick<DataServices, "hasActivePremium">;
  ai: AiGenerateService;
  providers: AiProviders;
  now?: () => number;
};

export type ShowTokenStepOptions = {
  mode?: ShowMode;
  flags?: OptionalLine[];
  block?: Block;
  /** The draft just written: spares the read the screen would do again. */
  draft?: TokenDraft | null;
};

/** The text of a refused input (§4.5), from the typed error of V1-15. */
export function errorTextOf(error: TokenFieldError): string {
  const t = en.token.errors;
  const { field } = error;
  switch (error.code) {
    case "INVALID_CHARS":
      return t.invalidChars;
    case "HAS_SPACES":
      return t.tickerSpaces;
    case "TOO_MANY_SENTENCES":
      return t.tooManySentences;
    case "NOT_HTTPS":
    case "INVALID_URL":
      return t.invalidUrl;
    case "INVALID_X":
      return t.invalidX;
    case "INVALID_TELEGRAM":
      return t.invalidTelegram;
    case "EMPTY":
      if (field === "name") return t.nameEmpty;
      if (field === "ticker") return t.tickerEmpty;
      return field === "description" ? t.descriptionEmpty : t.linkEmpty;
    case "TOO_LONG": {
      const actual = error.actual ?? 0;
      if (field === "name") return t.nameTooLong(actual);
      if (field === "ticker") return t.tickerTooLong(actual);
      return field === "description" ? t.descriptionTooLong(actual) : t.invalidUrl;
    }
  }
}

const IMAGE_MIME_TYPES: readonly string[] = TOKEN_IMAGE_MIME_TYPES;

/**
 * The `file_id` of an image the user sent (§5): the largest size of a photo, or a document
 * that is a JPG, PNG or WEBP under the limit of `getFile`. `null` for anything else.
 */
export function imageFileIdOf(message: Message | undefined): string | null {
  const photo = message?.photo?.at(-1);
  if (photo !== undefined) return photo.file_id;
  const document = message?.document;
  if (
    document !== undefined &&
    document.mime_type !== undefined &&
    IMAGE_MIME_TYPES.includes(document.mime_type) &&
    (document.file_size ?? 0) <= TOKEN_IMAGE_MAX_BYTES
  ) {
    return document.file_id;
  }
  return null;
}

/**
 * The Token step (§5, V1-16): one component, configured per flow. The draft lives in
 * `TokenDraft`, created on the first write; the id of the draft and the "Missing" flag live in
 * the session, per flow; the input a screen waits for is the `pendingInput` of V1-11.
 */
export function createTokenStep({
  ui,
  drafts,
  data,
  ai,
  providers,
  now = Date.now,
}: TokenStepDeps) {
  const configs = new Map<TokenFlow, TokenStepConfig>();

  function configOf(flow: TokenFlow): TokenStepConfig {
    const config = configs.get(flow);
    if (config === undefined) throw new Error(`Token step: flow ${flow} is not registered`);
    return config;
  }

  const stateOf = (ctx: BotContext, flow: TokenFlow): TokenStepState =>
    ((ctx.session.tokenStep ??= {})[flow] ??= {});

  /** The draft of the flow, `null` before the first write or when it is gone. */
  async function loadDraft(ctx: BotContext, flow: TokenFlow): Promise<TokenDraft | null> {
    const id = stateOf(ctx, flow).draftId;
    return id === undefined ? null : drafts.getOwnedDraft(ctx.user.id, id);
  }

  /** Writes the draft (lazy creation, copy on write) and keeps its id in the flow. */
  async function applyTokenValues(
    ctx: BotContext,
    flow: TokenFlow,
    patch: TokenDraftPatch,
  ): Promise<TokenDraft> {
    const state = stateOf(ctx, flow);
    const draft = await drafts.write(ctx.user.id, state.draftId ?? null, patch);
    state.draftId = draft.id;
    // The "Missing" flag follows the fields, and goes once both are there (proposal).
    if (hasNameAndTicker(draft)) delete state.showMissing;
    return draft;
  }

  /** The screen as a render, so a blocked click can add its flag (§4.5). */
  async function tokenRender(
    ctx: BotContext,
    flow: TokenFlow,
    options: ShowTokenStepOptions,
  ): Promise<(flag?: string) => Screen> {
    const config = configOf(flow);
    const [draft, isPremium, summaryLines] = await Promise.all([
      options.draft === undefined ? loadDraft(ctx, flow) : options.draft,
      data.hasActivePremium(ctx.user.id),
      config.summaryLines?.(ctx) ?? Promise.resolve([]),
    ]);
    const view = draft ?? EMPTY_DRAFT;
    const missingFlag =
      stateOf(ctx, flow).showMissing === true
        ? en.token.missing(missingRequiredFields(view).map((field) => en.token.fieldLabels[field]))
        : undefined;
    const extra = await hooks.extraLines(ctx, { isPremium });
    return (flag) =>
      renderTokenStep(ui, {
        flow,
        draft: view,
        isPremium,
        backData: config.backData,
        summaryLines,
        infos: extra.infos,
        flags: [missingFlag, ...(options.flags ?? []), flag],
        notes: extra.notes,
      });
  }

  async function showTokenStep(
    ctx: BotContext,
    flow: TokenFlow,
    options: ShowTokenStepOptions = {},
  ): Promise<void> {
    const render = await tokenRender(ctx, flow, options);
    if (options.block === undefined) {
      await showScreen(ctx, render(), { mode: options.mode });
    } else {
      await blockWithFlag(ctx, options.block, render, { mode: options.mode });
    }
  }

  /**
   * Generate and AI Generate share one limit (D17): `true` when the click was refused, with
   * the alert and the flag already on the screen.
   */
  async function rateLimited(ctx: BotContext, flow: TokenFlow): Promise<boolean> {
    const verdict = consumeRateLimit(Number(ctx.user.telegramId), "generate");
    if (verdict.ok) return false;
    await showTokenStep(ctx, flow, { block: tooManyActions(verdict.retryAfterMs) });
    return true;
  }

  const hooks = createAiHooks({
    ui,
    ai,
    providers,
    step: { showTokenStep, applyTokenValues, loadDraft, rateLimited },
  });

  async function showInput(
    ctx: BotContext,
    flow: TokenFlow,
    field: TokenInputField,
    options: { mode?: ShowMode; flags?: OptionalLine[] } = {},
  ): Promise<void> {
    const draft = (await loadDraft(ctx, flow)) ?? EMPTY_DRAFT;
    await showScreen(ctx, buildFieldInputScreen(ui, flow, field, draft, { flags: options.flags }), {
      mode: options.mode,
      input: { kind: "token_field", flow, field, since: now() },
    });
  }

  /** Generate (§5): a new local token; the image and the links stay. */
  async function generate(ctx: BotContext, flow: TokenFlow): Promise<void> {
    if (await rateLimited(ctx, flow)) return;
    const token = generateLocalToken({ previous: await loadDraft(ctx, flow) });
    const draft = await applyTokenValues(ctx, flow, token);
    await showTokenStep(ctx, flow, { draft });
  }

  /** The Token screen with the "Missing" flag, which stays until the fields are there. */
  function refuse(ctx: BotContext, flow: TokenFlow, draft: TokenDraft | null, mode?: ShowMode) {
    stateOf(ctx, flow).showMissing = true;
    return showTokenStep(ctx, flow, { draft, mode });
  }

  /**
   * The draft of the flow once Continue accepted it, for the steps after the Token screen
   * (V1-22): a draft gone or without name or ticker (a stale button, a purge) shows the Token
   * screen with the "Missing" flag and gives `null`.
   */
  async function requireReadyDraft(
    ctx: BotContext,
    flow: TokenFlow,
    options: { mode?: ShowMode } = {},
  ): Promise<ReadyTokenDraft | null> {
    const draft = await loadDraft(ctx, flow);
    if (hasNameAndTicker(draft)) return draft;
    await refuse(ctx, flow, draft, options.mode);
    return null;
  }

  /** Continue (§5): the alert and the flag while a name or a ticker is missing. */
  async function next(ctx: BotContext, flow: TokenFlow): Promise<void> {
    const draft = await loadDraft(ctx, flow);
    if (!hasNameAndTicker(draft)) {
      await notify(ctx, en.token.missingAlert, { alert: true });
      return refuse(ctx, flow, draft);
    }
    await configOf(flow).onContinue(ctx, draft);
  }

  /** A handler of `tok:<op>:<flow>[:<field>]`: the flow of a registered config, or a stale button. */
  const withFlow =
    (
      run: (ctx: BotContext, flow: TokenFlow, arg: string | undefined) => Promise<unknown>,
    ): CallbackHandler =>
    (ctx, [flowCode, arg]) => {
      const flow = tokenFlowOf(flowCode);
      return flow === undefined || !configs.has(flow)
        ? notify(ctx, en.common.staleButton)
        : run(ctx, flow, arg);
    };

  /** The message that answers an input: a text for six fields, a photo or a file for the image. */
  const input: InputHandler<"token_field"> = async (ctx, pending, text) => {
    const mode = "edit";
    const { flow, field } = pending;
    if (!configs.has(flow)) return;
    if (now() - pending.since > TOKEN_INPUT_TIMEOUT_MS) {
      return showTokenStep(ctx, flow, { flags: [en.token.inputExpired], mode });
    }
    const retry = (flag: string) => showInput(ctx, flow, field, { flags: [flag], mode });

    let value: string;
    if (field === "image") {
      const fileId = imageFileIdOf(ctx.message);
      if (fileId === null) return retry(en.token.errors.notImage);
      value = fileId;
    } else {
      if (text === undefined) return retry(en.token.errors.notText);
      const result = parseTokenField(field, text);
      if (!result.ok) return retry(errorTextOf(result.error));
      value = result.value;
    }
    const draft = await applyTokenValues(ctx, flow, { [COLUMN_OF[field]]: value });
    await showTokenStep(ctx, flow, { mode, draft });
  };

  return {
    /** The flow of a config: called by V1-22 and V1-37 (provisionally by V1-16). */
    registerFlow(config: TokenStepConfig): void {
      configs.set(config.flow, config);
    },
    /** Once per bot: the `tok` domain and the input, whatever flows are registered. */
    mount(router: CallbackRouter, inputs: InputRouter): void {
      inputs.register("token_field", input);
      router.register("tok", {
        gen: withFlow(generate),
        ai: withFlow((ctx, flow) => hooks.onAiGenerate(ctx, flow)),
        ed: withFlow(async (ctx, flow, arg) => {
          if (arg === undefined) {
            const draft = (await loadDraft(ctx, flow)) ?? EMPTY_DRAFT;
            return showScreen(ctx, buildEditChoiceScreen(ui, flow, draft));
          }
          const field = editableFieldOf(arg);
          return field === undefined
            ? notify(ctx, en.common.staleButton)
            : showInput(ctx, flow, field);
        }),
        in: withFlow((ctx, flow, arg) => {
          const field = optionalFieldOf(arg);
          return field === undefined
            ? notify(ctx, en.common.staleButton)
            : showInput(ctx, flow, field);
        }),
        rm: withFlow(async (ctx, flow, arg) => {
          const field = optionalFieldOf(arg);
          if (field === undefined) return notify(ctx, en.common.staleButton);
          const draft = await applyTokenValues(ctx, flow, { [COLUMN_OF[field]]: null });
          return showTokenStep(ctx, flow, { draft });
        }),
        cx: withFlow((ctx, flow) => showTokenStep(ctx, flow)),
        next: withFlow(next),
      });
    },
    showTokenStep,
    applyTokenValues,
    loadDraft,
    requireReadyDraft,
  };
}

export type TokenStep = ReturnType<typeof createTokenStep>;
