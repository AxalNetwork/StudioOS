/**
 * Formatters shared by the board registries.
 *
 * Kept out of the registries so the one rule that matters there — no digit in
 * any string, because every figure must come back from `summary(payload)` —
 * stays easy to read and easy to enforce.
 *
 * TWO MONEY HELPERS, AND THEY ARE NOT INTERCHANGEABLE. Newer stores hold
 * integer cents (`retainers.amount_cents`, migration 208 onward). Two older
 * tables predate that rule and hold REAL dollars: `founder_needs.budget_min` /
 * `.budget_max` and `quotes.price`, both from `sql/t13_t14_t15.sql`. Passing
 * one to the other's formatter is off by a hundred in whichever direction
 * hurts, so they are named for what they take.
 */
const USD = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 0,
});

const isNum = (v) => v !== null && v !== undefined && Number.isFinite(Number(v));

/** A REAL-dollar column (`quotes.price`, `founder_needs.budget_*`). */
export const usd = (dollars) => (isNum(dollars) ? USD.format(Number(dollars)) : null);

/** An integer-cents column. */
export const usdCents = (cents) => (isNum(cents) ? USD.format(Number(cents) / 100) : null);

/** A budget range, either end of which may be missing. */
export function budget(min, max) {
  const lo = usd(min);
  const hi = usd(max);
  if (lo && hi) return lo === hi ? lo : `${lo}–${hi}`;
  return lo || hi || null;
}

/** A stored date, as a date. Null stays null so the cell says "Not recorded". */
export function day(value) {
  if (!value) return null;
  const t = new Date(value);
  return Number.isNaN(t.getTime())
    ? String(value)
    : t.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * `4 clients` / `1 client` — the plural a summary line needs constantly.
 *
 * RETURNS NULL FOR A FIGURE THAT IS NOT THERE, rather than falling back to
 * zero. A caller writing `count(d?.retainer_count ?? 0, 'retainer')` prints
 * "0 retainers" when the field is simply absent from the payload — a count
 * claimed from nothing, which is the one thing a board section may not do.
 * `summary()` drops the null, so the line loses that half instead.
 */
export const count = (n, one, many = `${one}s`) => {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return null;
  const k = Number(n);
  return `${k} ${k === 1 ? one : many}`;
};

/** A stored enum as prose: `right_stage` → `Right stage`. */
export const title = (value) => {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const spaced = text.replace(/[_-]+/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

/** The rows a board section shows. The zone behind it shows the rest. */
export const top = (rows, n = 5) => (Array.isArray(rows) ? rows.slice(0, n) : []);

/** Join the halves of a summary line, dropping the ones with no figure. */
export const summary = (...parts) => {
  const live = parts.filter((p) => p !== null && p !== undefined && p !== '');
  return live.length ? live.join(' · ') : null;
};
