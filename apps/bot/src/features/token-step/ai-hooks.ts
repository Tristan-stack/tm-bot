import type { TokenDraft, TokenDraftPatch } from "@launchbot/db";
import { en, isAiModelAvailable } from "@launchbot/shared";
import type { AiLogo, AiProviders, Ui } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import { InputFile } from "grammy";
import type { BotContext, TokenFlow } from "../../context.js";
import { acknowledge } from "../../navigation/notify.js";
import { showScreen } from "../../navigation/show-screen.js";
import type { AiGenerateService } from "../../services/ai/ai-generate.js";
import { buildGeneratingScreen } from "./screens.js";
import type { ShowTokenStepOptions, TokenStepAiHooks } from "./token-step.js";

const log = createLogger("bot:ai");

/** What the hooks need of the step: given by `createTokenStep` itself, which owns them. */
export type TokenStepForAi = {
  showTokenStep: (
    ctx: BotContext,
    flow: TokenFlow,
    options?: ShowTokenStepOptions,
  ) => Promise<void>;
  applyTokenValues: (
    ctx: BotContext,
    flow: TokenFlow,
    patch: TokenDraftPatch,
  ) => Promise<TokenDraft>;
  loadDraft: (ctx: BotContext, flow: TokenFlow) => Promise<TokenDraft | null>;
  rateLimited: (ctx: BotContext, flow: TokenFlow) => Promise<boolean>;
};

export type AiHooksDeps = {
  ui: Ui;
  ai: AiGenerateService;
  providers: AiProviders;
  step: TokenStepForAi;
};

/**
 * A logo as a Telegram `file_id` (proposal, to confirm in DEC-02): sent to the chat of the
 * user, whose message is deleted at once. `null` when Telegram refused: the image is kept.
 */
async function uploadLogo(ctx: BotContext, logo: AiLogo): Promise<string | null> {
  if (ctx.chatId === undefined) return null;
  try {
    const extension = logo.mimeType.slice("image/".length);
    const sent = await ctx.api.sendPhoto(
      ctx.chatId,
      new InputFile(logo.bytes, `logo.${extension}`),
    );
    const fileId = sent.photo.at(-1)?.file_id ?? null;
    try {
      await ctx.api.deleteMessage(ctx.chatId, sent.message_id);
    } catch {
      // The photo stays in the chat: a cosmetic miss, the file_id is what matters.
    }
    return fileId;
  } catch (error) {
    log.warn({ userId: ctx.from?.id, err: error }, "AI logo not uploaded to Telegram");
    return null;
  }
}

/**
 * AI Generate on the Token screen (V1-17): the quota line for Premium users, the "coming
 * soon" mention for everyone until a text provider exists, and the click — rate limit, then
 * the service, then the screen with the flag of what happened (§4.5).
 */
export function createAiHooks({ ui, ai, providers, step }: AiHooksDeps): TokenStepAiHooks {
  const available = isAiModelAvailable(providers);

  return {
    async extraLines(ctx, { isPremium }) {
      const infos: string[] = [];
      if (isPremium) {
        const { used, limit } = await ai.getQuota(ctx.user.id);
        infos.push(en.token.ai.quota(used, limit));
      }
      return { infos, notes: available ? [] : [en.token.ai.comingSoon] };
    },

    async onAiGenerate(ctx, flow) {
      if (await step.rateLimited(ctx, flow)) return;
      const current = await step.loadDraft(ctx, flow);
      // A provider takes seconds: the spinner stops now, and the screen says what is going on.
      if (available) {
        await acknowledge(ctx);
        await showScreen(ctx, buildGeneratingScreen(ui, flow));
      }

      const result = await ai.generate(ctx.user.id, current);
      switch (result.status) {
        case "NOT_PREMIUM":
          return step.showTokenStep(ctx, flow, { draft: current, block: en.token.ai.premiumOnly });
        case "QUOTA_REACHED":
          return step.showTokenStep(ctx, flow, {
            draft: current,
            block: en.token.ai.quotaReached(result.limit),
          });
        case "OK": {
          const fileId = result.logo === null ? null : await uploadLogo(ctx, result.logo);
          const draft = await step.applyTokenValues(ctx, flow, {
            ...result.token,
            ...(fileId === null ? {} : { imageFileId: fileId }),
          });
          return step.showTokenStep(ctx, flow, {
            draft,
            flags: result.source === "LOCAL_FALLBACK" ? [en.token.ai.fallback] : [],
          });
        }
      }
    },
  };
}
