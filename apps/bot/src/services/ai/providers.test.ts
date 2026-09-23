import { captureLogs, setLogDestination } from "@launchbot/shared/server";
import { afterEach, describe, expect, it } from "vitest";
import { createAiProviders } from "./providers.js";

afterEach(() => setLogDestination(undefined));

describe("createAiProviders", () => {
  it("has no provider without keys, and says nothing", () => {
    const lines = captureLogs();

    expect(createAiProviders({ LLM_API_KEY: undefined, IMAGE_API_KEY: undefined })).toEqual({
      text: null,
      logo: null,
    });
    expect(lines).toEqual([]);
  });

  it("still has no provider with keys, and warns once per key without its value", () => {
    const lines = captureLogs();

    const providers = createAiProviders({
      LLM_API_KEY: "sk-live-1234567890abcdef",
      IMAGE_API_KEY: "img-live-0987654321fedcba",
    });

    expect(providers).toEqual({ text: null, logo: null });
    expect(lines).toHaveLength(2);
    const text = lines.join("");
    expect(text).toContain("LLM_API_KEY");
    expect(text).toContain("IMAGE_API_KEY");
    expect(text).toContain("no provider is implemented yet");
    expect(text).not.toContain("sk-live-1234567890abcdef");
    expect(text).not.toContain("img-live-0987654321fedcba");
  });

  it("treats an empty key as absent", () => {
    const lines = captureLogs();

    createAiProviders({ LLM_API_KEY: "", IMAGE_API_KEY: undefined });

    expect(lines).toEqual([]);
  });
});
