import { describe, expect, it } from "vitest";
import { TG } from "../constants.js";
import { splitHtmlMessage } from "./split.js";

/** A wallet of the keys message: its lines, each tag closed on its line. */
const walletBlock = (index: number) =>
  [
    `${index}. Wallet ${index} · Created`,
    `Address: <code>${"A".repeat(44)}</code>`,
    `🔑 Private key: <code>${"k".repeat(88)}</code>`,
    `🌱 Seed phrase: <code>${Array.from({ length: 24 }, () => "abandon").join(" ")}</code>`,
  ].join("\n");

const opened = (text: string, tag: string) => text.split(`<${tag}>`).length - 1;
const closed = (text: string, tag: string) => text.split(`</${tag}>`).length - 1;

describe("splitHtmlMessage (V1-43)", () => {
  it("keeps a message that fits as one part, without a part label", () => {
    const parts = splitHtmlMessage(["one", "two"], { header: "<b>TITLE</b>", footer: "end" });

    expect(parts).toEqual(["<b>TITLE</b>\n\none\n\ntwo\n\nend"]);
  });

  it("cuts between blocks, in order, each part framed and within the limit", () => {
    const blocks = Array.from({ length: 12 }, (_, index) => walletBlock(index + 1));
    const header = "<b>🔑 WALLET KEYS</b> · 🧪 Devnet";
    const footer = "⚠️ This message will be deleted in 60 s.";

    const parts = splitHtmlMessage(blocks, { header, footer });

    expect(parts.length).toBeGreaterThan(1);
    parts.forEach((part, index) => {
      expect(part.length).toBeLessThanOrEqual(TG.MESSAGE_MAX_CHARS);
      expect(part.startsWith(`${header}\n\nPart ${index + 1}/${parts.length}\n\n`)).toBe(true);
      expect(part.endsWith(`\n\n${footer}`)).toBe(true);
      expect(opened(part, "code")).toBe(closed(part, "code"));
    });
    // Every wallet whole, once, in order.
    const found = blocks.map((block) => parts.findIndex((part) => part.includes(block)));
    expect(found.every((index) => index !== -1)).toBe(true);
    expect([...found].sort((a, b) => a - b)).toEqual(found);
  });

  it("cuts a block too long between its lines", () => {
    const lines = Array.from({ length: 300 }, (_, index) => `<b>${index}</b> ${"x".repeat(20)}`);

    const parts = splitHtmlMessage([lines.join("\n")], { limit: 1_000 });

    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(1_000);
      expect(opened(part, "b")).toBe(closed(part, "b"));
    }
    expect(parts.join("\n").match(/<b>\d+<\/b>/g)).toHaveLength(300);
  });

  it("truncates a line longer than a message, without a tag or a cut entity", () => {
    const line = `<code>${"&amp;".repeat(400)}</code>`;

    const [part = ""] = splitHtmlMessage([line, "after"], { limit: 500 }).slice(0, 1);

    expect(part.length).toBeLessThanOrEqual(500);
    expect(part).not.toContain("<code>");
    expect(part).toMatch(/(&amp;)+…/);
  });
});
