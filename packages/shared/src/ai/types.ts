import type { TOKEN_IMAGE_MIME_TYPES } from "../constants.js";
import type { GeneratedToken } from "../token/fields.js";

/**
 * The providers behind AI Generate (§8.1, V1-17): a LLM for the text, an image API for the
 * logo. Both are chosen by DEC-02; until then every implementation is null and the local
 * generator answers. A provider receives the previous token and nothing else (§11.3).
 */
export type AiTokenTextProvider = {
  readonly id: string;
  /** Must satisfy `generatedTokenSchema`: anything else falls back to the local generator. */
  generateText: (
    input: { previous: GeneratedToken | null },
    signal: AbortSignal,
  ) => Promise<GeneratedToken>;
};

export type AiLogoMimeType = (typeof TOKEN_IMAGE_MIME_TYPES)[number];
export type AiLogo = { bytes: Uint8Array; mimeType: AiLogoMimeType };

export type AiTokenLogoProvider = {
  readonly id: string;
  generateLogo: (token: GeneratedToken, signal: AbortSignal) => Promise<AiLogo>;
};

export type AiProviders = {
  text: AiTokenTextProvider | null;
  logo: AiTokenLogoProvider | null;
};

/**
 * Whether the "coming soon" mention leaves the Token screen (V1-16) and the plans screen
 * (V1-29): a text provider is what makes AI Generate an AI (proposal, a logo alone is not).
 */
export const isAiModelAvailable = (providers: AiProviders): boolean => providers.text !== null;
