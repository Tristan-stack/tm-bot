import { describe, expect, it } from "vitest";
import { formatImportedSuccessPost, parseSolToLamports } from "@launchbot/shared";
import {
  parsePostedState,
  parseRugpilotCard,
  serializePostedState,
} from "./success-source-card.js";

const KHOLE = `
━━━━━━━━━━━━━━━━━━━━


🪙  $KHOLE  |  +154%
🧬  CA:  ANEKW22Usib97oKVPVR5xtk5JrNWwq6XDsq2LR98pump

📊  Invested:  9.501 SOL  ($1.16K)
📈  Sell:  24.133 SOL  ($2.95K)
💰  Profit:  +14.632 SOL  ($1.79K)

👤  Wallet:  GsnbomQqC3QhoL61ZjDvfvjvXFd7seMySxMYxyZHfLZr
🔍  Verify on Solscan

🤖  Join the bot
🔗  🔍 GMGN  ·  ⚡ Axiom  ·  📊 DexScreener  ·  🔭 Solscan
`;

describe("parseRugpilotCard", () => {
  it("reads the ticker, the mint and the two amounts, and drops the wallet", () => {
    const card = parseRugpilotCard(KHOLE);
    expect(card?.symbol).toBe("KHOLE");
    expect(card?.mint).toBe("ANEKW22Usib97oKVPVR5xtk5JrNWwq6XDsq2LR98pump");
    expect(card?.investedLamports).toBe(parseSolToLamports("9.501"));
    expect(card?.soldLamports).toBe(parseSolToLamports("24.133"));
    expect(card?.solUsd).toBeCloseTo(1160 / 9.501);
    if (card === undefined) throw new Error("fixture");
    const caption = formatImportedSuccessPost(card, "mainnet-beta");
    expect(caption).toContain("$KHOLE");
    expect(caption).toContain("ANEKW22Usib97oKVPVR5xtk5JrNWwq6XDsq2LR98pump");
    expect(caption).not.toContain("via @");
    expect(caption).not.toContain("GsnbomQq");
  });

  it("skips a message that is not a card", () => {
    expect(parseRugpilotCard("hello")).toBeUndefined();
    expect(parseRugpilotCard("🪙  $KHOLE  |  +154%")).toBeUndefined();
  });
});

describe("parsePostedState", () => {
  it("round-trips the source message ids", () => {
    const state = new Map([
      [16224, 10],
      [16223, 9],
    ]);
    expect(parsePostedState(serializePostedState(state))).toEqual(state);
    expect(parsePostedState("{")).toBeUndefined();
    expect(parsePostedState('{"posted":{"nope":1}}')).toBeUndefined();
  });
});
