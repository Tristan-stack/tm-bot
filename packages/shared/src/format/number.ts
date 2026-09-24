const groupThousands = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** `1,248` */
export function formatInt(value: number | bigint): string {
  // The grouping regex never inserts a comma between the sign and the first digit.
  return groupThousands((typeof value === "bigint" ? value : BigInt(Math.trunc(value))).toString());
}

/** `1,234.56`: magnitude of a number, grouped, with a fixed number of decimals. */
export function formatMagnitude(value: number, decimals: number): string {
  const [integer = "0", fraction] = Math.abs(value).toFixed(decimals).split(".");
  return fraction === undefined
    ? groupThousands(integer)
    : `${groupThousands(integer)}.${fraction}`;
}

/** `3.000` → `3`, `0.050` → `0.05`. Only for a text that has a decimal point. */
export const trimTrailingZeros = (fixed: string): string => fixed.replace(/\.?0+$/, "");

const BILLIONS = { suffix: "B", value: 1e9 };
const TOKEN_TIERS = [
  { suffix: "", value: 1 },
  { suffix: "K", value: 1e3 },
  { suffix: "M", value: 1e6 },
  BILLIONS,
];

/** `96.66M`: K, M and B with 2 decimals. Under 1,000 the amount is shown as is: `950`, `12.5`. */
export function formatTokenAmount(amount: number): string {
  // First tier whose rounded value stays under 1000: 999,999 is 1.00M, not 1000.00K.
  const tier =
    TOKEN_TIERS.find(({ value }) => Number((amount / value).toFixed(2)) < 1000) ?? BILLIONS;
  const scaled = (amount / tier.value).toFixed(2);
  return tier.suffix === "" ? trimTrailingZeros(scaled) : `${scaled}${tier.suffix}`;
}

/** `formatPct(0.0967)` → `9.67%`, `formatPct(0.152, 1)` → `15.2%`, `formatPct(0.62, 0)` → `62%`. */
export const formatPct = (ratio: number, decimals = 2): string =>
  `${(ratio * 100).toFixed(decimals)}%`;

/** A share of the supply already in percent (`Holder.pctSupply`): `9.67%`, `<0.01%` under 0.01. */
export function formatPctSupply(pct: number): string {
  if (pct > 0 && pct < 0.01) return "<0.01%";
  return `${pct.toFixed(2)}%`;
}

/** `1:32`, `3:00`, `30:00`: m:ss, rounded down. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
