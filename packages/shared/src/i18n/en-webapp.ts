/**
 * Texts of the Mini App, also reachable as `en.webapp`. They live in their own module, which
 * imports nothing, so that the Mini App bundles them without the texts of the bot: `en` is one
 * object, and a bundler cannot drop the parts of an object that are not used.
 *
 * Plain text rendered by React, which escapes it: no HTML here, unlike the texts of the bot.
 */
export const enWebapp = {
  legal: {
    /** `date` is already formatted: `formatDate`. §11.2: "Version 1 · Updated 15 Sep 2026". */
    version: (version: number, date: string) => `Version ${version} · Updated ${date}`,
    // proposed text (D19)
    draft: "Draft — the full text will be published before launch.",
    // Provisional body: the parts planned by §11.2 and §11.3, full text in V1-41.
    terms: {
      title: "Terms of Service",
      // proposed texts (D19)
      parts: [
        "Service",
        "Simulation",
        "Wallets",
        "Subscriptions",
        "Success channel",
        "Content",
        "AI generator",
        "Liability",
        "Changes",
        "Inactive accounts",
        "Contact",
      ],
    },
    privacy: {
      title: "Privacy Policy",
      // proposed texts (D19)
      parts: [
        "Data collected",
        "Purposes",
        "Third-party services",
        "Public data",
        "Security",
        "Retention",
        "Rights and contact",
        "Sale of data",
      ],
    },
  },
  sim: {
    // proposed texts (D19)
    title: "Simulation",
    comingSoon: "The live simulation screen is coming soon.",
  },
  // proposed text (D19)
  notFound: "Page not found.",
} as const;
