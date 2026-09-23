import { nextUtcMidnight } from "@launchbot/db";
import type { AiQuotaStore } from "@launchbot/db";
import {
  AI_LOGO_TIMEOUT_MS,
  AI_TEXT_TIMEOUT_MS,
  generatedTokenSchema,
  generateLocalToken,
} from "@launchbot/shared";
import type { AiLogo, AiProviders, GeneratedToken, PreviousToken } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";

const log = createLogger("bot:ai");

export type AiGenerateQuota = { used: number; limit: number; resetsAt: Date };

/** Where the text came from: a provider, the local generator by design, or as a fallback. */
export type AiGenerateSource = "AI" | "LOCAL" | "LOCAL_FALLBACK";

export type AiGenerateResult =
  | { status: "NOT_PREMIUM" }
  | ({ status: "QUOTA_REACHED" } & AiGenerateQuota)
  | {
      status: "OK";
      token: GeneratedToken;
      /** From the logo provider, `null` without one or when it failed. */
      logo: AiLogo | null;
      source: AiGenerateSource;
      used: number;
      limit: number;
    };

export type AiGenerateDeps = {
  quota: AiQuotaStore;
  providers: AiProviders;
  hasActivePremium: (userId: string) => Promise<boolean>;
  now?: () => number;
};

export type AiGenerateService = {
  /**
   * One click on AI Generate (§5, §8.1): Premium checked again, one generation reserved on
   * the quota, then the text from the provider or the local generator. A provider that
   * fails, times out or answers something the validators refuse is replaced by the local
   * generator; the click still counts (proposal). `previous` is the draft as stored.
   */
  generate: (userId: string, previous: PreviousToken | null) => Promise<AiGenerateResult>;
  getQuota: (userId: string) => Promise<AiGenerateQuota>;
};

/** The reason of an abort as an Error: `AbortSignal.reason` is typed `any`. */
const abortReason = (signal: AbortSignal): Error =>
  signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason));

/**
 * Runs a provider call with an abort signal that fires after `ms`. Hand-rolled rather than
 * `AbortSignal.timeout`, so the tests can drive it with fake timers.
 */
export async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Timed out after ${ms} ms`)), ms);
  try {
    return await Promise.race([
      run(controller.signal),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () => reject(abortReason(controller.signal)));
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** The previous token as a provider receives it: complete and valid, or nothing. */
function completeOf(previous: PreviousToken | null): GeneratedToken | null {
  const parsed = generatedTokenSchema.safeParse(previous);
  return parsed.success ? parsed.data : null;
}

export function createAiGenerateService(deps: AiGenerateDeps): AiGenerateService {
  const { quota, providers, hasActivePremium, now = Date.now } = deps;

  /** The text: a provider output that passes the validators of V1-15, or the local generator. */
  async function textOf(
    previous: PreviousToken | null,
  ): Promise<{ token: GeneratedToken; source: AiGenerateSource }> {
    const local = () => generateLocalToken({ previous });
    const provider = providers.text;
    if (provider === null) return { token: local(), source: "LOCAL" };
    try {
      const output = await withTimeout(
        (signal) => provider.generateText({ previous: completeOf(previous) }, signal),
        AI_TEXT_TIMEOUT_MS,
      );
      const parsed = generatedTokenSchema.safeParse(output);
      if (!parsed.success) throw new Error("Provider output refused by the token validators");
      return { token: parsed.data, source: "AI" };
    } catch (error) {
      // The message of a provider error could quote its request: name and message only, scrubbed.
      log.warn({ provider: provider.id, err: error }, "AI text provider failed, local fallback");
      return { token: local(), source: "LOCAL_FALLBACK" };
    }
  }

  /** The logo, recorded as it is asked for: the row does not wait for the provider. */
  async function logoOf(userId: string, token: GeneratedToken): Promise<AiLogo | null> {
    const provider = providers.logo;
    if (provider === null) return null;
    try {
      const [, logo] = await Promise.all([
        quota.recordLogo(userId),
        withTimeout((signal) => provider.generateLogo(token, signal), AI_LOGO_TIMEOUT_MS),
      ]);
      return logo;
    } catch (error) {
      log.warn({ provider: provider.id, err: error }, "AI logo provider failed, image kept");
      return null;
    }
  }

  return {
    async generate(userId, previous) {
      if (!(await hasActivePremium(userId))) return { status: "NOT_PREMIUM" };
      const at = new Date(now());
      const reserved = await quota.reserveText(userId, at);
      if (!reserved.ok) {
        return {
          status: "QUOTA_REACHED",
          used: reserved.used,
          limit: quota.limit,
          resetsAt: nextUtcMidnight(at),
        };
      }
      const { token, source } = await textOf(previous);
      const logo = await logoOf(userId, token);
      return { status: "OK", token, logo, source, used: reserved.used, limit: quota.limit };
    },

    async getQuota(userId) {
      const at = new Date(now());
      return {
        used: await quota.countText(userId, at),
        limit: quota.limit,
        resetsAt: nextUtcMidnight(at),
      };
    },
  };
}
