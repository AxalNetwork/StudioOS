/**
 * Cap-table share links, as the Lab Cap Table page issues them (D364). Pure,
 * so node --test runs it.
 *
 * The Worker has minted audience-scoped links since build queue #120
 * (POST /api/captable/scenarios/:uid/share, services/captableShare.ts) and
 * redacts server-side before anything reaches the viewer; no page ever called
 * it. The audience lines below are the Worker's AUDIENCE_SCOPE, word for word
 * — frontend/test/spinout_existing_stores_d364.test.mjs fails if they drift —
 * because the founder must read what a link reveals BEFORE it is minted, and
 * the Worker only returns its scope after.
 *
 * CONSENT. An investor or full link shows named people's positions — other
 * founders', investors' — to whoever holds it. That is their information as
 * much as the founder's, so the page will not mint one until the founder
 * confirms the people named have agreed. A summary link names nobody.
 */

export const CAP_TABLE_AUDIENCES = [
  {
    k: 'summary',
    label: 'Summary',
    sees: [
      'Ownership split by stakeholder group (founders, investors, option pool)',
      'Number of financing rounds completed',
    ],
    hidden: [
      'Individual holders and their stakes',
      'Share counts and price per share',
      'Investment amounts and valuations',
    ],
  },
  {
    k: 'investor',
    label: 'Investor',
    sees: [
      'Full round history with pre-money, investment, and price per share',
      'Every investor and founder position',
      'The option pool as a single line',
      'Liquidation preferences and exit waterfall',
    ],
    hidden: ['Individual employee option grants inside the pool'],
  },
  {
    k: 'full',
    label: 'Full',
    sees: ['Everything the cap-table owner sees, including every individual holder'],
    hidden: [],
  },
];

/** The Worker's bounds (routes/captable.ts SHARE_* constants). */
export const SHARE_DAYS_DEFAULT = 7;
export const SHARE_DAYS_MAX = 90;
export const SHARE_VIEWS_DEFAULT = 25;
export const SHARE_VIEWS_MAX = 500;

/** Whether an audience shows named people's holdings, and so needs consent. */
export function needsHolderConsent(audience) {
  return audience === 'investor' || audience === 'full';
}

export const CONSENT_COPY = 'This link shows named people\'s holdings to anyone who has it, until it expires or is revoked. '
  + 'I confirm that the founders and investors named on this cap table have agreed to their positions being shared with this recipient.';

/**
 * The form → the POST body, or a refusal with our own sentence. Nothing is
 * defaulted silently: the days and views the founder sees are the ones sent,
 * inside the Worker's bounds (which it enforces again).
 */
export function shareRequest({ audience, days, views, consent, label }) {
  if (!CAP_TABLE_AUDIENCES.some((a) => a.k === audience)) {
    return { ok: false, message: 'Choose who the link is for.' };
  }
  const d = Number(days);
  if (!Number.isInteger(d) || d < 1 || d > SHARE_DAYS_MAX) {
    return { ok: false, message: `The link can last 1 to ${SHARE_DAYS_MAX} days.` };
  }
  const v = Number(views);
  if (!Number.isInteger(v) || v < 1 || v > SHARE_VIEWS_MAX) {
    return { ok: false, message: `The link can open 1 to ${SHARE_VIEWS_MAX} times.` };
  }
  if (needsHolderConsent(audience) && consent !== true) {
    return { ok: false, message: 'Confirm the people named have agreed before sharing their positions.' };
  }
  const body = { audience, expires_in_hours: d * 24, view_limit: v };
  const l = String(label ?? '').trim();
  if (l) body.label = l.slice(0, 120);
  return { ok: true, body };
}

/** A listed link's state: withdrawn, used up, expired or live. */
export function capShareState(row, nowMs = Date.now()) {
  if (row?.revoked_at) return 'withdrawn';
  if (Number.isInteger(row?.view_count) && Number.isInteger(row?.view_limit) && row.view_count >= row.view_limit) return 'used_up';
  const raw = String(row?.expires_at || '');
  const t = Date.parse(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`);
  if (Number.isFinite(t) && t <= nowMs) return 'expired';
  return 'live';
}
