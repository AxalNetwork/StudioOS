/**
 * D4619 (#4619) — the one formatter for a rate stored as a fraction.
 *
 * The Worker returns rates such as IRR as fractions (`portfolioMetrics.ts`:
 * 0.1 is ten per cent). `formatRate(0.1)` is "10%", `formatRate(-0.25)` is
 * "-25%" and `formatRate(0)` is "0%": zero is a recorded rate. A missing or
 * non-numeric value is `null`, never "0%", so the caller draws its own
 * Not recorded (or "—") state. At most one decimal is shown, and a whole
 * number has none ("12.3%", "10%"). The IRR solver is not changed here.
 */
export function formatRate(fraction) {
  if (fraction === null || fraction === undefined || fraction === '' || typeof fraction === 'boolean') return null;
  const n = Number(fraction);
  if (!Number.isFinite(n)) return null;
  const pct = Math.round(n * 1000) / 10;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`;
}
