import { describe, expect, it } from "vitest";
import * as engine from "./index.js";

describe("@launchbot/sim-engine", () => {
  it("exposes the public API of the engine", () => {
    expect(engine.SIM_ENGINE_VERSION).toBe(1);
    expect(typeof engine.createRng).toBe("function");
    expect(typeof engine.deriveSeed).toBe("function");
    expect(typeof engine.isValidSeed).toBe("function");
    expect(typeof engine.dmath.ln).toBe("function");
    expect(typeof engine.exponential).toBe("function");
    expect(typeof engine.BondingCurve).toBe("function");
    expect(engine.FALLBACK_CURVE_PARAMS.feeRate).toBe(0.01);
    expect(engine.TOKEN_DECIMALS).toBe(6);
    expect(engine.DUST_TOKENS).toBe(1e-6);
  });
});
