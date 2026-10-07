/**
 * D636 (#1394) — the Brand page's site address and saved templates, the Ops
 * canvas's sp-brand screen. Pure: `components/brand/BrandAddressPanel.jsx` and
 * `components/brand/SavedTemplatesPanel.jsx` draw what these return.
 *
 * The rules mirror `routes/brand.ts` (`cleanSlug`, `RESERVED_SITE_SLUGS`,
 * `MAX_CUSTOM_TEMPLATES`), which checks them again on every write. They exist
 * here so a form that can only be refused is not sent, and so the screen can
 * say the rule before the founder types.
 */

/** The public host every address hangs off. */
export const SITE_HOST = 'axal.vc';
/** The canvas's rule line, word for word. */
export const ADDRESS_RULES = '1 to 48 lowercase letters, digits and hyphens. Reserved words are refused.';
/** The canvas's warning before an address change. */
export const ADDRESS_WARNING = 'Old links stop working after a change.';
/** The cap on saved templates, across all of a founder's projects. */
export const TEMPLATE_LIMIT = 50;

const ADDRESS_RE = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;
export const RESERVED_SITE_ADDRESSES = new Set(['api', 'app', 'admin', 'axal', 'assets', 'landing', 'login', 'preview', 'register', 'static', 'www']);

/** The Worker's sentences for the site address, by its codes (`SITE_ADDRESS_REFUSALS`). */
export const ADDRESS_REFUSALS = {
  address_invalid: 'An address is 1 to 48 lowercase letters, digits and hyphens, with no hyphen at either end.',
  address_reserved: 'That address is reserved. Choose another.',
  address_taken: 'That address is already taken.',
};

/** "axal.vc/p/acme", or "axal.vc/p/acme/pricing" for a page other than home. */
export function siteUrl(slug) {
  return `${SITE_HOST}/p/${slug}`;
}
export function pageUrl(siteSlug, pageSlug) {
  return `${SITE_HOST}/p/${siteSlug}/${pageSlug}`;
}

/**
 * The address as typed, checked the way the Worker will: `{ ok, slug }` or
 * `{ ok: false, code, message }`. Trims and lowercases first, as the Worker does.
 */
export function checkAddress(text) {
  const slug = String(text ?? '').trim().toLowerCase();
  if (!ADDRESS_RE.test(slug)) return { ok: false, code: 'address_invalid', message: ADDRESS_REFUSALS.address_invalid };
  if (RESERVED_SITE_ADDRESSES.has(slug)) return { ok: false, code: 'address_reserved', message: ADDRESS_REFUSALS.address_reserved };
  return { ok: true, slug };
}

/**
 * A refusal from the Worker as the sentence to show. `request()` puts the
 * Worker's own sentence on `e.message` and its code on `e.code` (D258).
 */
const CODE_SHAPE = /^[a-z][a-z0-9_]*$/;
export function refusalLine(err, fallback) {
  const msg = typeof err?.message === 'string' ? err.message.trim() : '';
  if (msg && !CODE_SHAPE.test(msg)) return msg;
  const code = typeof err?.code === 'string' ? err.code : null;
  if (code && ADDRESS_REFUSALS[code]) return ADDRESS_REFUSALS[code];
  return fallback;
}

/**
 * One page's availability verdict, from the Worker's
 * `GET …/page-slug-available` answer: `{ label, tone, message }`.
 * An answer that could not be read is "Not checked", never "Available".
 */
export function availabilityOf(answer) {
  if (!answer || answer.status === 'unreadable') {
    return { label: 'Not checked', tone: 'grey', message: 'Availability could not be checked just now.' };
  }
  if (answer.status === 'checking') return { label: 'Checking…', tone: 'grey', message: null };
  const a = answer.data || {};
  if (a.available) return { label: 'Available', tone: 'ok', message: null };
  if (a.reason === 'taken') return { label: 'Taken', tone: 'bad', message: a.message || 'You already have a page at that address.' };
  if (a.reason === 'reserved') return { label: 'Reserved', tone: 'bad', message: a.message || 'That address is reserved.' };
  return { label: 'Not allowed', tone: 'bad', message: a.message || ADDRESS_REFUSALS.address_invalid };
}

/** "[n] of 50", the canvas's count line, and whether another can be saved. */
export function templateCount(templates, limit = TEMPLATE_LIMIT) {
  const n = Array.isArray(templates) ? templates.length : 0;
  return { line: `${n} of ${limit}`, full: n >= limit };
}

/** Where a template came from: "from Acme", or the stated absence. */
export function templateFrom(t) {
  if (t?.project?.name) return `from ${t.project.name}`;
  return 'Project not recorded: saved before templates kept their project';
}

/** The day part of a stored time ("2026-10-07 12:00:00" or ISO), or ''. */
export const dayOf = (v) => (typeof v === 'string' && v.length >= 10 ? v.slice(0, 10) : '');
