import { describe, expect, it } from "vitest";
import {
  CALLBACK_DOMAINS,
  CallbackDataError,
  decodeCallback,
  encodeCallback,
  NAV_HOME,
} from "./callback.js";
import { utf8ByteLength } from "./format/text.js";

const CUID = "cjld2cjxh0000qzrmn831i7rn";

describe("encodeCallback", () => {
  it("joins domain, action and arguments", () => {
    expect(encodeCallback("nav", "home")).toBe("nav:home");
    expect(NAV_HOME).toBe("nav:home");
    expect(encodeCallback("sub", "buy", "PREMIUM", "TWO_DAYS")).toBe("sub:buy:PREMIUM:TWO_DAYS");
    expect(encodeCallback("wal", "page", 2)).toBe("wal:page:2");
    expect(encodeCallback("adm", "user", 123456789n)).toBe("adm:user:123456789");
  });

  it("matches the sizes of the ticket examples", () => {
    expect(utf8ByteLength(encodeCallback("wal", "del", CUID))).toBe(33);
    expect(utf8ByteLength(encodeCallback("sub", "buy", "PREMIUM", "TWO_DAYS"))).toBe(24);
  });

  it.each(CALLBACK_DOMAINS)("accepts the %s domain", (domain) => {
    expect(decodeCallback(encodeCallback(domain, "open"))).toEqual({
      domain,
      action: "open",
      args: [],
    });
  });

  it("refuses a domain outside the union", () => {
    // @ts-expect-error "stats" is not a CallbackDomain
    expect(() => encodeCallback("stats", "open")).toThrow(CallbackDataError);
  });

  it("accepts 64 bytes and refuses 65", () => {
    const arg = "a".repeat(64 - "wal:del:".length);

    expect(utf8ByteLength(encodeCallback("wal", "del", arg))).toBe(64);
    expect(() => encodeCallback("wal", "del", `${arg}a`)).toThrow(CallbackDataError);
  });

  it.each(["a:b", "", "with space", "émoji", "🚀", "a.b", "-1.5"])(
    "refuses the argument %j",
    (arg) => {
      expect(() => encodeCallback("wal", "del", arg)).toThrow(CallbackDataError);
    },
  );

  it("refuses an invalid action and never echoes the faulty part", () => {
    expect(() => encodeCallback("wal", "")).toThrow(CallbackDataError);
    try {
      encodeCallback("wal", "imp", "secret key!");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CallbackDataError);
      expect(String(error)).not.toContain("secret");
    }
  });
});

describe("decodeCallback", () => {
  it("round-trips", () => {
    const data = encodeCallback("wal", "del", CUID);

    expect(decodeCallback(data)).toEqual({ domain: "wal", action: "del", args: [CUID] });
    expect(decodeCallback("sub:buy:PREMIUM:TWO_DAYS")).toEqual({
      domain: "sub",
      action: "buy",
      args: ["PREMIUM", "TWO_DAYS"],
    });
  });

  it.each([
    "",
    "wal",
    "wal:",
    "stats:open",
    "WAL:del",
    "wal:del:",
    "wal::x",
    "wal:del:a b",
    `wal:del:${"a".repeat(64)}`,
    "some legacy payload",
  ])("returns null for %j", (data) => {
    expect(decodeCallback(data)).toBeNull();
  });
});
