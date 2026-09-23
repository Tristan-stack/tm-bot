import { describe, expect, it } from "vitest";
import {
  TOKEN_DESCRIPTION_MAX_CHARS,
  TOKEN_NAME_MAX_BYTES,
  TOKEN_TICKER_MAX_BYTES,
  TOKEN_URL_MAX_LENGTH,
} from "../constants.js";
import { utf8ByteLength } from "../format/text.js";
import {
  countSentences,
  generatedTokenSchema,
  parseTokenField,
  tokenDraftPublicSchema,
  tokenFieldErrorOf,
  tokenNameSchema,
  tokenTickerSchema,
  type TokenField,
  type TokenFieldError,
} from "./fields.js";

const value = (field: TokenField, raw: string): string => {
  const result = parseTokenField(field, raw);
  if (!result.ok) throw new Error(`${field}: ${result.error.code}`);
  return result.value;
};
const error = (field: TokenField, raw: string): TokenFieldError => {
  const result = parseTokenField(field, raw);
  if (result.ok) throw new Error(`${field}: accepted ${JSON.stringify(result.value)}`);
  return result.error;
};

describe("name (§5: 32 bytes)", () => {
  it("accepts 32 bytes and refuses 33", () => {
    expect(value("name", "a".repeat(32))).toBe("a".repeat(32));
    expect(error("name", "a".repeat(33))).toEqual({
      field: "name",
      code: "TOO_LONG",
      max: TOKEN_NAME_MAX_BYTES,
      actual: 33,
      unit: "bytes",
    });
  });

  it("counts emojis in bytes: 🚀 = 4, 👨‍👩‍👧 = 18", () => {
    expect(utf8ByteLength("🚀")).toBe(4);
    expect(utf8ByteLength("👨‍👩‍👧")).toBe(18);
    expect(value("name", "Moon Otter 🚀🚀🚀🚀🚀")).toBe("Moon Otter 🚀🚀🚀🚀🚀"); // 31 bytes
    expect(error("name", "👨‍👩‍👧👨‍👩‍👧")).toMatchObject({ code: "TOO_LONG", actual: 36 });
  });

  it("normalizes spaces and line breaks, keeps the case", () => {
    expect(value("name", "  Moon \n Otter ")).toBe("Moon Otter");
    expect(value("name", "moon\t\totter")).toBe("moon otter");
  });

  it("applies NFC before the measure: a decomposed é is 2 bytes", () => {
    const decomposed = "é";
    expect(utf8ByteLength(decomposed)).toBe(3);
    expect(value("name", decomposed)).toBe("é");
    expect(utf8ByteLength(value("name", decomposed))).toBe(2);
    expect(value("name", decomposed.repeat(16))).toBe("é".repeat(16));
    expect(error("name", decomposed.repeat(17))).toMatchObject({ code: "TOO_LONG", actual: 34 });
  });

  it("keeps HTML characters raw", () => {
    expect(value("name", "Tom & <Jerry>")).toBe("Tom & <Jerry>");
  });

  it.each(["", "   ", "\n\n"])("refuses %j as empty", (raw) => {
    expect(error("name", raw)).toEqual({ field: "name", code: "EMPTY" });
  });

  it("refuses control characters", () => {
    expect(error("name", "Moon\u0007Otter")).toEqual({ field: "name", code: "INVALID_CHARS" });
    expect(error("name", "Moon\u0000")).toMatchObject({ code: "INVALID_CHARS" });
  });
});

describe("ticker (§5: 10 bytes, upper case)", () => {
  it("removes leading $ and upper-cases", () => {
    expect(value("ticker", "$ottr")).toBe("OTTR");
    expect(value("ticker", "$$ottr")).toBe("OTTR");
    expect(value("ticker", " ottr ")).toBe("OTTR");
  });

  it("measures after upper-case and NFC: ΐ grows from 2 to 4 bytes", () => {
    expect(utf8ByteLength("ΐΐΐ")).toBe(6);
    expect(error("ticker", "ΐΐΐ")).toEqual({
      field: "ticker",
      code: "TOO_LONG",
      max: TOKEN_TICKER_MAX_BYTES,
      actual: 12,
      unit: "bytes",
    });
    expect(utf8ByteLength(value("ticker", "ΐΐ"))).toBe(8);
    expect(value("ticker", "straße")).toBe("STRASSE");
  });

  it("accepts 8 bytes of emojis and refuses 12", () => {
    expect(value("ticker", "🚀🚀")).toBe("🚀🚀");
    expect(error("ticker", "🚀🚀🚀")).toMatchObject({ code: "TOO_LONG", actual: 12 });
  });

  it("accepts 10 bytes and refuses 11", () => {
    expect(value("ticker", "abcdefghij")).toBe("ABCDEFGHIJ");
    expect(error("ticker", "abcdefghijk")).toMatchObject({ code: "TOO_LONG", actual: 11 });
  });

  it("refuses spaces, a lone $ and empty inputs", () => {
    expect(error("ticker", "MO ON")).toEqual({ field: "ticker", code: "HAS_SPACES" });
    expect(error("ticker", "$")).toEqual({ field: "ticker", code: "EMPTY" });
    expect(error("ticker", "")).toEqual({ field: "ticker", code: "EMPTY" });
  });
});

describe("description (§5: 1 to 3 sentences)", () => {
  it("counts sentences on . ! ? … followed by a space or the end", () => {
    expect(countSentences("One. Two! Three?")).toBe(3);
    expect(countSentences("Wait… really")).toBe(2);
    expect(countSentences("No punctuation at all")).toBe(1);
    expect(countSentences("Visit moon.com today")).toBe(1);
    expect(countSentences("Really?! Yes.")).toBe(2);
  });

  it("accepts 3 sentences and refuses 4", () => {
    expect(value("description", "One. Two. Three.")).toBe("One. Two. Three.");
    expect(error("description", "One. Two. Three. Four.")).toEqual({
      field: "description",
      code: "TOO_MANY_SENTENCES",
      max: 3,
      actual: 4,
      unit: "sentences",
    });
  });

  it("accepts 280 code points and refuses 281", () => {
    expect(value("description", "🚀".repeat(280))).toBe("🚀".repeat(280));
    expect(error("description", "a".repeat(281))).toEqual({
      field: "description",
      code: "TOO_LONG",
      max: TOKEN_DESCRIPTION_MAX_CHARS,
      actual: 281,
      unit: "chars",
    });
  });

  it("joins lines into one paragraph", () => {
    expect(value("description", "An otter.\nWho loves stars.")).toBe("An otter. Who loves stars.");
  });
});

describe("website (§5: https:// URL)", () => {
  it.each([
    ["https://moon.com", "https://moon.com"],
    ["HTTPS://Moon.com/", "https://moon.com"],
    ["https://moon.com/about/", "https://moon.com/about/"],
    ["https://moon.com/?ref=1", "https://moon.com/?ref=1"],
    ["https://moon.com/#top", "https://moon.com/#top"],
    [" https://moon.com ", "https://moon.com"],
  ])("normalizes %s → %s", (raw, expected) => {
    expect(value("website", raw)).toBe(expected);
  });

  it.each(["http://moon.com", "moon.com", "javascript:alert(1)", "ftp://moon.com", "www.moon.com"])(
    "refuses %s: not https",
    (raw) => {
      expect(error("website", raw)).toEqual({ field: "website", code: "NOT_HTTPS" });
    },
  );

  it.each([
    "https://",
    "https://user:pass@moon.com",
    "https://user@moon.com",
    "https://moon com",
    "https://localhost",
    "https://moon",
  ])("refuses %s: invalid URL", (raw) => {
    expect(error("website", raw)).toEqual({ field: "website", code: "INVALID_URL" });
  });

  it("refuses more than 200 characters", () => {
    const long = `https://moon.com/${"a".repeat(184)}`;
    expect(long.length).toBe(201);
    expect(error("website", long)).toEqual({
      field: "website",
      code: "TOO_LONG",
      max: TOKEN_URL_MAX_LENGTH,
      actual: 201,
      unit: "chars",
    });
    expect(value("website", long.slice(0, 200))).toBe(long.slice(0, 200));
  });
});

describe("X (§5: handle or URL, normalized)", () => {
  it.each([
    "moonotter",
    "@moonotter",
    "x.com/moonotter",
    "x.com/moonotter/",
    "www.x.com/moonotter",
    "mobile.twitter.com/moonotter",
    "twitter.com/moonotter",
    "https://twitter.com/moonotter?s=21",
    "https://x.com/moonotter#tweets",
    "http://x.com/moonotter",
    "X.com/moonotter",
  ])("normalizes %s → https://x.com/moonotter", (raw) => {
    expect(value("x", raw)).toBe("https://x.com/moonotter");
  });

  it("keeps the case of the handle", () => {
    expect(value("x", "@MoonOtter")).toBe("https://x.com/MoonOtter");
  });

  it("accepts a community", () => {
    expect(value("x", "https://x.com/i/communities/1234567890")).toBe(
      "https://x.com/i/communities/1234567890",
    );
    expect(value("x", "x.com/i/communities/12/")).toBe("https://x.com/i/communities/12");
  });

  it.each([
    "x.com/home",
    "@home",
    "https://x.com/i/communities/abc",
    "https://x.com/i/communities",
    "a".repeat(16),
    "moon otter",
    "moon-otter",
    "x.com/moonotter/status/1",
    "https://example.com/moonotter",
    "javascript:alert(1)",
    "x.com",
  ])("refuses %s", (raw) => {
    expect(error("x", raw)).toEqual({ field: "x", code: "INVALID_X" });
  });

  it("refuses an empty input as empty", () => {
    expect(error("x", " ")).toEqual({ field: "x", code: "EMPTY" });
  });
});

describe("Telegram (§5: t.me link, normalized)", () => {
  it.each([
    "t.me/moonotter",
    "https://t.me/moonotter/",
    "https://telegram.me/moonotter",
    "telegram.dog/moonotter",
    "www.t.me/moonotter",
    "@moonotter",
    "T.ME/moonotter",
  ])("normalizes %s → https://t.me/moonotter", (raw) => {
    expect(value("telegram", raw)).toBe("https://t.me/moonotter");
  });

  it("converts invitations", () => {
    expect(value("telegram", "t.me/joinchat/AbCdEfGhIjKlMnOp")).toBe(
      "https://t.me/+AbCdEfGhIjKlMnOp",
    );
    expect(value("telegram", "https://t.me/+AbCdEfGhIjKlMnOp-_")).toBe(
      "https://t.me/+AbCdEfGhIjKlMnOp-_",
    );
  });

  it.each([
    "t.me/abc",
    "@abc",
    "t.me/_moonotter",
    "t.me/moonotter_",
    "t.me/1moonotter",
    `t.me/a${"b".repeat(32)}`,
    "t.me/moonotter/123",
    "t.me/+short",
    "t.me/joinchat",
    "https://example.com/moonotter",
    "moonotter",
    "t.me",
  ])("refuses %s", (raw) => {
    expect(error("telegram", raw)).toEqual({ field: "telegram", code: "INVALID_TELEGRAM" });
  });
});

describe("zod schemas", () => {
  it("transform to the normalized value", () => {
    expect(tokenTickerSchema.parse("$ottr")).toBe("OTTR");
    expect(tokenNameSchema.parse(" Moon  Otter ")).toBe("Moon Otter");
  });

  it("carry the typed error in the issue params", () => {
    const result = tokenTickerSchema.safeParse("MO ON");
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.message).toBe("HAS_SPACES");
    expect(tokenFieldErrorOf(result.error)).toEqual({ field: "ticker", code: "HAS_SPACES" });
  });

  it("generatedTokenSchema accepts a valid token as is and names the faulty field", () => {
    const token = { name: "Moon Otter", symbol: "OTTR", description: "An otter." };
    expect(generatedTokenSchema.parse(token)).toEqual(token);
    const result = generatedTokenSchema.safeParse({ ...token, symbol: "$ottr" });
    expect(result.success && result.data.symbol).toBe("OTTR");
    const bad = generatedTokenSchema.safeParse({ ...token, name: "a".repeat(33) });
    expect(bad.success).toBe(false);
    if (bad.success) return;
    expect(tokenFieldErrorOf(bad.error)).toMatchObject({ field: "name", code: "TOO_LONG" });
    expect(bad.error.issues[0]?.path).toEqual(["name"]);
  });

  it("tokenDraftPublicSchema describes the Mini App draft", () => {
    const draft = {
      name: "Moon Otter",
      symbol: "OTTR",
      description: null,
      website: null,
      twitter: "https://x.com/moonotter",
      telegram: null,
      hasImage: false,
    };
    expect(tokenDraftPublicSchema.parse(draft)).toEqual(draft);
    expect(tokenDraftPublicSchema.safeParse({ ...draft, hasImage: "yes" }).success).toBe(false);
  });
});
