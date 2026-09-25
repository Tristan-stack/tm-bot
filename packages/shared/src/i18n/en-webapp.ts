/**
 * Texts of the Mini App, also reachable as `en.webapp`. They live in their own module, which
 * imports nothing, so that the Mini App bundles them without the texts of the bot: `en` is one
 * object, and a bundler cannot drop the parts of an object that are not used.
 *
 * Plain text rendered by React, which escapes it: no HTML here, unlike the texts of the bot.
 */
export const enWebapp = {
  // proposed text (D19)
  notFound: "Page not found.",
} as const;
