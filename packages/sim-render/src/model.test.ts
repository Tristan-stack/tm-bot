import { createSimulation } from "@launchbot/sim-engine";
import type { Position } from "@launchbot/sim-engine";
import { simConfig } from "@launchbot/sim-engine/test-helpers";
import { describe, expect, it } from "vitest";
import {
  axisScale,
  buildPnlCardModel,
  buildPositionView,
  chartUnit,
  formatSignedPct,
  formatSignedSol,
} from "./model.js";

const position = (overrides: Partial<Position> = {}): Position => ({
  tokens: 0,
  solIn: 3,
  solOut: 4.28,
  valueIfSoldNow: 0,
  pnlSol: 1.28,
  pnlPct: (1.28 / 3) * 100,
  ...overrides,
});

const token = { name: "Moon Otter", ticker: "OTTR" };
const priced = { solUsdPrice: 103.36 };

describe("chartUnit and axisScale", () => {
  it("draws the market cap in USD with a price, in SOL without", () => {
    const config = simConfig({ solUsdPrice: 150 });
    expect(chartUnit(config)).toBe("USD");
    expect(axisScale(config)).toBe(config.curve.totalSupply * 150);
    const unpriced = simConfig({ solUsdPrice: null });
    expect(chartUnit(unpriced)).toBe("SOL");
    expect(axisScale(unpriced)).toBe(unpriced.curve.totalSupply);
  });
});

describe("signed formatters", () => {
  it("puts the sign after the rounding, never on a zero", () => {
    expect(formatSignedSol(1.28)).toBe("+1.280 SOL");
    expect(formatSignedSol(-0.54)).toBe("-0.540 SOL");
    expect(formatSignedSol(-0.0004)).toBe("0.000 SOL");
    expect(formatSignedPct(42.666)).toBe("+42.7%");
    expect(formatSignedPct(-12.44)).toBe("-12.4%");
    expect(formatSignedPct(-0.04)).toBe("0.0%");
  });
});

describe("buildPositionView", () => {
  it("formats the tokens, the value if sold now and the PnL of the engine", () => {
    const config = simConfig({ solUsdPrice: 103.36 });
    const view = buildPositionView(
      position({
        tokens: 96_660_000,
        solOut: 1.234,
        valueIfSoldNow: 3.412,
        pnlSol: 0.412,
        pnlPct: 13.73,
      }),
      config,
      "OTTR",
    );

    expect(view.holdText).toBe("96.66M OTTR (9.67%)");
    expect(view.valueText).toBe("≈ 3.412 SOL ($352.66)");
    expect(view.pnlText).toBe("+0.412 SOL (+13.7%)");
    expect(view.soldText).toBe("1.234 SOL");
  });

  it("omits the USD without a price, and the sold line before a sale", () => {
    const view = buildPositionView(
      position({ tokens: 10, solOut: 0, valueIfSoldNow: 2.5, pnlSol: -0.5, pnlPct: -16.7 }),
      simConfig({ solUsdPrice: null }),
      "OTTR",
    );

    expect(view.valueText).toBe("≈ 2.500 SOL");
    expect(view.valueText).not.toContain("$");
    expect(view.soldText).toBeNull();
  });
});

describe("buildPnlCardModel", () => {
  it("renders the example of the mock-up, in whole dollars for the caption", () => {
    const card = buildPnlCardModel({ token, position: position(), config: priced });

    expect(card).toEqual({
      tickerText: "$OTTR",
      ticker: "OTTR",
      pnlSolBig: "+1.280",
      pnlPctText: "+42.7%",
      investedText: "3.000",
      positionSolText: "4.280",
      usd: { invested: "$310", position: "$442", pnl: "$132" },
      tone: "positive",
    });
  });

  it("values the rest as sold", () => {
    const card = buildPnlCardModel({
      token,
      position: position({ tokens: 62, solOut: 1, valueIfSoldNow: 2.1, pnlSol: 0.1, pnlPct: 3.33 }),
      config: priced,
    });
    expect(card.positionSolText).toBe("3.100");
    expect(card.pnlSolBig).toBe("+0.100");
    expect(card.usd).toEqual({ invested: "$310", position: "$320", pnl: "$10" });
  });

  it("omits the USD without a price, and colors a loss red with a signed dollar amount", () => {
    const loss = position({ solOut: 2.46, pnlSol: -0.54, pnlPct: -18 });
    const card = buildPnlCardModel({ token, position: loss, config: { solUsdPrice: null } });
    expect(card.pnlSolBig).toBe("-0.540");
    expect(card.usd).toBeNull();
    expect(card.tone).toBe("negative");

    const usd = buildPnlCardModel({ token, position: loss, config: priced });
    expect(usd.usd).toEqual({ invested: "$310", position: "$254", pnl: "-$56" });
  });

  it("adds up on screen: Invested + PnL = Position, after rounding each to 3 decimals", () => {
    const card = buildPnlCardModel({
      token,
      position: position({ solIn: 3.0004, solOut: 4.2789, pnlSol: 1.2785, pnlPct: 42.6 }),
      config: { solUsdPrice: null },
    });
    expect(card.investedText).toBe("3.000");
    expect(card.positionSolText).toBe("4.279");
    expect(card.pnlSolBig).toBe("+1.279");
  });

  it("follows the real engine: a Sell 100% is worth what the sale gave", () => {
    const config = simConfig();
    const sold = createSimulation(config);
    sold.devBuy();
    sold.step(10);
    const sale = sold.sellDev(1).event;
    const closed = buildPnlCardModel({ position: sold.position(), config, token });
    expect(sold.endReason()).toBe("position_closed");
    expect(closed.positionSolText).toBe(sale.sol.toFixed(3));
    expect(closed.investedText).toBe("3.000");
  });
});
