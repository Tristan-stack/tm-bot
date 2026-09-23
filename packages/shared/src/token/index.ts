/**
 * Token generator and field rules (§5, V1-15): pure TypeScript, no Node API, so the Mini App
 * can bundle it. The word lists stay private to the generator.
 */
export {
  formatLinkForDisplay,
  formatTicker,
  missingRequiredFields,
  type RequiredTokenField,
} from "./display.js";
export {
  countSentences,
  generatedTokenSchema,
  parseTokenField,
  TOKEN_FIELDS,
  tokenDescriptionSchema,
  tokenDraftPublicSchema,
  tokenFieldErrorOf,
  tokenNameSchema,
  tokenTelegramSchema,
  tokenTickerSchema,
  tokenWebsiteSchema,
  tokenXSchema,
  type FieldResult,
  type GeneratedToken,
  type TokenDraftPublic,
  type TokenField,
  type TokenFieldError,
  type TokenFieldErrorCode,
} from "./fields.js";
export {
  generateLocalToken,
  type GenerateLocalTokenOptions,
  type PreviousToken,
} from "./generator.js";
