import type { AiProviders } from "@launchbot/shared";
import { createLogger } from "@launchbot/shared/server";
import type { Env } from "@launchbot/shared/server";

const log = createLogger("bot:ai");

export type AiEnv = Pick<Env, "LLM_API_KEY" | "IMAGE_API_KEY">;

/**
 * The providers of AI Generate for this process (V1-17). None is implemented before DEC-02:
 * a key alone enables nothing, and says so at startup — the variable name only, never its
 * value. The real implementations plug in here without touching the screen or the quota.
 */
export function createAiProviders(env: AiEnv): AiProviders {
  const keys = { LLM_API_KEY: env.LLM_API_KEY, IMAGE_API_KEY: env.IMAGE_API_KEY };
  for (const [variable, value] of Object.entries(keys)) {
    if (value !== undefined && value !== "") {
      log.warn(
        { variable },
        "AI key present but no provider is implemented yet (DEC-02): AI Generate uses the local generator",
      );
    }
  }
  return { text: null, logo: null };
}
