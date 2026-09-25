import { describe, expect, it } from "vitest";
import { getOffer, listOffers, OFFER_CODES, parseOfferCode } from "./offers.js";

describe("offer catalogue (§8.1)", () => {
  it("lists the 4 passes in the order of the offers screen, priced in USD cents", () => {
    expect(
      listOffers().map(({ code, plan, duration, priceUsdCents }) => [
        code,
        plan,
        duration,
        priceUsdCents,
      ]),
    ).toEqual([
      ["C2D", "CLASSIC", "TWO_DAYS", 4_900],
      ["C1M", "CLASSIC", "ONE_MONTH", 16_900],
      ["P2D", "PREMIUM", "TWO_DAYS", 5_900],
      ["P1M", "PREMIUM", "ONE_MONTH", 17_900],
    ]);
  });

  it("lasts exactly 48 h or 30 days, never a calendar month", () => {
    expect(getOffer("CLASSIC", "TWO_DAYS").durationMs).toBe(172_800_000);
    expect(getOffer("PREMIUM", "ONE_MONTH").durationMs).toBe(30 * 86_400_000);
  });

  it("finds an offer by plan and duration", () => {
    expect(getOffer("PREMIUM", "TWO_DAYS").code).toBe("P2D");
  });
});

describe("parseOfferCode", () => {
  it.each(OFFER_CODES)("reads %s", (code) => {
    expect(parseOfferCode(code)?.code).toBe(code);
  });

  it.each(["", "p2d", "P3D", "P2D ", "PREMIUM"])("refuses %j", (code) => {
    expect(parseOfferCode(code)).toBeNull();
  });
});
