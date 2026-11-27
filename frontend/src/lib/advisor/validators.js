/**
 * Task #11 (AC-2) — Lightweight client-side validators for the
 * persona question banks. The frontend has no `zod` dependency
 * (and we don't want to add ~30 KB of runtime for a handful of
 * checks) so each validator is a plain function returning
 * `{ ok: true }` or `{ ok: false, error: string }`.
 *
 * The router (AC-1) re-validates server-side via its own per-table
 * column constraints, so these are purely UX hints — fail-closed
 * means: don't submit, show the error inline.
 */

export const ok = () => ({ ok: true });
export const err = (msg) => ({ ok: false, error: msg });

export const required = (v) =>
  String(v ?? '').trim() ? ok() : err('Please provide an answer.');

export const minChars = (n) => (v) =>
  String(v ?? '').trim().length >= n
    ? ok()
    : err(`Please write at least ${n} characters.`);

export const maxChars = (n) => (v) =>
  String(v ?? '').trim().length <= n
    ? ok()
    : err(`Please keep this under ${n} characters.`);

export const oneOf = (options) => (v) => {
  const s = String(v ?? '').trim();
  return options.includes(s) ? ok() : err(`Pick one of: ${options.join(', ')}.`);
};

export const csvNonEmpty = (min = 1) => (v) => {
  const items = String(v ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  return items.length >= min
    ? ok()
    : err(`List at least ${min} comma-separated value${min === 1 ? '' : 's'}.`);
};

export const url = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return ok(); // optional unless paired with required
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:'
      ? ok()
      : err('URL must start with http:// or https://');
  } catch {
    return err('Enter a valid URL (https://…).');
  }
};

export const email = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return ok();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? ok() : err('Enter a valid email.');
};

export const nonNegativeNumber = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return ok();
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? ok() : err('Enter a number ≥ 0.');
};

/** Compose validators left-to-right; first failure wins. */
export const all = (...fns) => (v) => {
  for (const fn of fns) {
    const r = fn(v);
    if (!r.ok) return r;
  }
  return ok();
};
