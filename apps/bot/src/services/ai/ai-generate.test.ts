import { AI_TEXT_TIMEOUT_MS, generatedTokenSchema } from "@launchbot/shared";
import type { AiProviders, AiTokenLogoProvider, AiTokenTextProvider } from "@launchbot/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeAiQuota, TEST_USER } from "../../test-harness.js";
import { createAiGenerateService, withTimeout } from "./ai-generate.js";

const USER = TEST_USER.id;
const NOON = new Date("2026-09-23T12:00:00Z").getTime();
const OTTER = { name: "Moon Otter", symbol: "OTTR", description: "An otter who loves the stars." };
const PICKLE = {
  name: "Cosmic Pickle",
  symbol: "PCKL",
  description: "A pickle who dreams of orbit.",
};

const textProvider = (generateText: AiTokenTextProvider["generateText"]): AiTokenTextProvider => ({
  id: "fake-text",
  generateText,
});
const logoProvider = (generateLogo: AiTokenLogoProvider["generateLogo"]): AiTokenLogoProvider => ({
  id: "fake-logo",
  generateLogo,
});

function service(
  options: { premium?: boolean; used?: number; providers?: Partial<AiProviders> } = {},
) {
  const quota = fakeAiQuota({ used: options.used });
  const providers: AiProviders = { text: null, logo: null, ...options.providers };
  const ai = createAiGenerateService({
    quota,
    providers,
    hasActivePremium: () => Promise.resolve(options.premium ?? true),
    now: () => NOON,
  });
  return { ai, logos: quota.logos, used: () => quota.used.get(USER) ?? 0 };
}

afterEach(() => vi.useRealTimers());

describe("AI Generate service", () => {
  it("refuses a user without an active Premium, with no row", async () => {
    const { ai, used } = service({ premium: false });

    expect(await ai.generate(USER, OTTER)).toEqual({ status: "NOT_PREMIUM" });
    expect(used()).toBe(0);
  });

  it("counts one TEXT row and answers with the local generator when no provider exists", async () => {
    const { ai, used, logos } = service({ used: 12 });

    const result = await ai.generate(USER, OTTER);

    expect(result).toMatchObject({
      status: "OK",
      source: "LOCAL",
      logo: null,
      used: 13,
      limit: 50,
    });
    if (result.status !== "OK") return;
    expect(result.token.name).not.toBe(OTTER.name);
    expect(result.token.symbol).not.toBe(OTTER.symbol);
    expect(generatedTokenSchema.safeParse(result.token).success).toBe(true);
    expect(used()).toBe(13);
    expect(logos).toEqual([]);
  });

  it("works from a partial, a stored (nullable) or an empty previous draft", async () => {
    const { ai } = service();

    expect((await ai.generate(USER, { name: "Moon Otter" })).status).toBe("OK");
    expect(
      (await ai.generate(USER, { name: null, symbol: "OTTR", description: null })).status,
    ).toBe("OK");
    expect((await ai.generate(USER, null)).status).toBe("OK");
  });

  it("refuses the 51st generation of the day and says when the quota resets", async () => {
    const { ai, used } = service({ used: 50 });

    expect(await ai.generate(USER, OTTER)).toEqual({
      status: "QUOTA_REACHED",
      used: 50,
      limit: 50,
      resetsAt: new Date("2026-09-24T00:00:00Z"),
    });
    expect(used()).toBe(50);
  });

  it("reports the quota of the day", async () => {
    const { ai } = service({ used: 13 });

    expect(await ai.getQuota(USER)).toEqual({
      used: 13,
      limit: 50,
      resetsAt: new Date("2026-09-24T00:00:00Z"),
    });
  });

  it("uses a text provider whose output passes the validators", async () => {
    const generateText = vi.fn(() => Promise.resolve({ ...PICKLE, symbol: "$pckl" }));
    const { ai } = service({ providers: { text: textProvider(generateText) } });

    const result = await ai.generate(USER, OTTER);

    expect(result).toMatchObject({ status: "OK", source: "AI", token: PICKLE });
    expect(generateText).toHaveBeenCalledWith({ previous: OTTER }, expect.any(AbortSignal));
  });

  it("hands the provider a null previous when the draft is incomplete", async () => {
    const generateText = vi.fn(() => Promise.resolve(PICKLE));
    const { ai } = service({ providers: { text: textProvider(generateText) } });

    await ai.generate(USER, { name: "Moon Otter", symbol: null, description: null });

    expect(generateText).toHaveBeenCalledWith({ previous: null }, expect.any(AbortSignal));
  });

  it.each([
    [
      "an invalid output (12-byte ticker)",
      () => Promise.resolve({ ...PICKLE, symbol: "ABCDEFGHIJKL" }),
    ],
    ["an exception", () => Promise.reject(new Error("boom"))],
  ])(
    "falls back on the local generator after %s, and still counts",
    async (_label, generateText) => {
      const { ai, used } = service({ providers: { text: textProvider(generateText) } });

      const result = await ai.generate(USER, OTTER);

      expect(result).toMatchObject({ status: "OK", source: "LOCAL_FALLBACK", used: 1 });
      if (result.status !== "OK") return;
      expect(generatedTokenSchema.safeParse(result.token).success).toBe(true);
      expect(used()).toBe(1);
    },
  );

  it("falls back after the timeout and aborts the provider", async () => {
    vi.useFakeTimers();
    let aborted = false;
    const provider = textProvider(
      (_input, signal) =>
        new Promise((_, reject) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("aborted by the caller"));
          });
        }),
    );
    const { ai } = service({ providers: { text: provider } });

    const pending = ai.generate(USER, OTTER);
    await vi.advanceTimersByTimeAsync(AI_TEXT_TIMEOUT_MS + 1);

    expect(await pending).toMatchObject({ status: "OK", source: "LOCAL_FALLBACK" });
    expect(aborted).toBe(true);
  });

  it("records a LOGO row and returns the logo of the provider", async () => {
    const logo = { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" as const };
    const generateLogo = vi.fn(() => Promise.resolve(logo));
    const { ai, used, logos } = service({
      providers: {
        text: textProvider(() => Promise.resolve(PICKLE)),
        logo: logoProvider(generateLogo),
      },
    });

    const result = await ai.generate(USER, OTTER);

    expect(result).toMatchObject({ status: "OK", source: "AI", logo });
    expect(generateLogo).toHaveBeenCalledWith(PICKLE, expect.any(AbortSignal));
    expect(logos).toEqual([USER]);
    expect(used()).toBe(1);
  });

  it("keeps the current image when the logo provider fails", async () => {
    const { ai, logos } = service({
      providers: { logo: logoProvider(() => Promise.reject(new Error("no logo"))) },
    });

    const result = await ai.generate(USER, OTTER);

    expect(result).toMatchObject({ status: "OK", source: "LOCAL", logo: null });
    expect(logos).toEqual([USER]);
  });
});

describe("withTimeout", () => {
  it("resolves in time and clears its timer", async () => {
    vi.useFakeTimers();
    expect(await withTimeout(() => Promise.resolve(42), 1_000)).toBe(42);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects with the abort reason after the delay", async () => {
    vi.useFakeTimers();
    const pending = withTimeout(() => new Promise<never>(() => undefined), 1_000);
    const outcome = pending.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1_001);
    expect(await outcome).toEqual(new Error("Timed out after 1000 ms"));
  });
});
