/**
 * D1026 (#2863) — the words and derivations behind Access (CT13), the shared
 * views (CT17, CT18) and the venture link's page, kept pure so the tests read
 * them without a browser. Every figure comes from D1019's reads
 * (`routes/captable_access.ts`); nothing here decides who may see what.
 *
 * THE LEVELS ARE THE WORKER'S. Each grants read carries `levels`, the
 * Worker's own sentence per level (`LEVEL_SCOPE`), and the tab draws those.
 * `LEVEL_WORDS` is only the order and the label when a read did not answer.
 */

import { NOT_RECORDED } from '../../../lib/absence.js';
import { day, pct, shares } from './capTableModel.js';

export const LEVELS = ['none', 'own_position', 'summary', 'investor', 'full'];
export const LEVEL_WORDS = { none: 'None', own_position: 'Own position', summary: 'Summary', investor: 'Investor', full: 'Full' };
/** CT13's None row, which the Worker's scope map has no entry for (None returns nothing). */
export const NONE_SEES = 'Sees nothing.';
/** A link has no holder, so no Own position (D1019 §6). */
export const LINK_LEVELS = ['summary', 'investor', 'full'];
/** Investor and Full name holders: the founder attests the holders agreed (D1019 §6). */
export const ATTESTED = new Set(['investor', 'full']);
export const ATTESTATION = 'The holders named here agreed to their positions being shared.';
export const LINK_HOURS = { min: 1, max: 2160, default: 168 };
export const LINK_VIEWS = { min: 1, max: 500, default: 25 };
export const SUPPORT_REASON = { min: 10, max: 500 };

export const levelLabel = (l) => LEVEL_WORDS[l] || NOT_RECORDED;

/** The five levels, each with the Worker's sentence when it gave one. */
export function levelRows(scope) {
  return LEVELS.map((id) => ({
    id,
    label: scope?.[id]?.label || LEVEL_WORDS[id],
    sees: id === 'none' ? NONE_SEES : (scope?.[id]?.sees || NOT_RECORDED),
  }));
}

const SOURCE_WORDS = { founder: 'Granted by a founder', side_letter: 'From a signed side letter' };

/** CT13's "Who sees what" rows from the grants read. */
export function grantRows(read) {
  const list = Array.isArray(read?.grants) ? read.grants : [];
  return list.map((g) => ({
    id: g.id,
    who: String(g.name || '').trim() || String(g.holder_ref || '').trim() || NOT_RECORDED,
    holder: g.holder_ref ? String(g.holder_ref) : null,
    userUid: g.user_uid || null,
    role: g.role ? roleWord(g.role) : g.holder_ref ? 'Holder' : NOT_RECORDED,
    level: g.level,
    levelLabel: levelLabel(g.level),
    grantedBy: String(g.granted_by || '').trim() || NOT_RECORDED,
    since: day(g.since),
    lastViewed: g.last_viewed ? day(g.last_viewed) : 'Never',
    // CT13's sub-line: the rights a signed letter gives, and at which level.
    rights: g.source === 'side_letter' ? `Rights: from a signed side letter · ${levelLabel(g.level)} level` : null,
    source: SOURCE_WORDS[g.source] || NOT_RECORDED,
  }));
}

const ROLE_WORDS = { founder: 'Founder', investor: 'Investor', advisor: 'Advisor', partner: 'Operating Partner', admin: 'Admin' };
export const roleWord = (r) => ROLE_WORDS[String(r || '').toLowerCase()] || NOT_RECORDED;

/** Who the venture's own rules let in without a grant (D1019 §3), said once under the table. */
export const DEFAULT_ACCESS = 'You, the owner, see everything. Co-founders see the full table and change nothing here. Advisors see the Summary unless you grant otherwise. Your studio’s admins see the group summary, and the full table only for support, with a reason you read in the log.';
export const COFOUNDER_NOTE = 'You are a co-founder: you read who sees what, and only the owner changes it.';

/** A share link's row. */
export function linkRows(read) {
  const list = Array.isArray(read?.items) ? read.items : [];
  return list.map((l) => {
    const revoked = !!l.revoked_at;
    return {
      id: l.id,
      label: String(l.label || '').trim() || 'Untitled link',
      level: levelLabel(l.level),
      expires: revoked ? 'Revoked' : day(l.expires_at),
      views: `${Number.isFinite(Number(l.view_count)) ? Number(l.view_count) : 0} of ${Number.isFinite(Number(l.view_limit)) ? Number(l.view_limit) : NOT_RECORDED}`,
      lastViewed: l.last_viewed_at ? day(l.last_viewed_at) : 'Never',
      live: !revoked,
      attested: !!l.holders_attested_at,
    };
  });
}

/** "12 Oct 2026 09:14" from a SQL or ISO stamp. */
export function when(s) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/.exec(String(s || ''));
  return m ? `${day(m[1])} ${m[2]}:${m[3]}` : day(s);
}

/** What an open was, in CT13's words. */
export function logWhat(row) {
  const level = levelLabel(row?.level);
  switch (row?.via) {
    case 'support': return `Opened for support: ‘${String(row.reason || '').trim() || NOT_RECORDED}’`;
    case 'link': return `Opened the ${row.link_label ? `${row.link_label} ` : ''}link · ${level}`;
    case 'hq': return 'HQ read the cap table';
    case 'owner':
    case 'member': return 'Opened the cap table';
    default: return row?.level === 'own_position' ? 'Viewed their own position' : `Opened the cap table · ${level}`;
  }
}

export function logRows(read) {
  const list = Array.isArray(read?.items) ? read.items : [];
  return list.map((r) => ({
    id: r.id,
    when: when(r.opened_at),
    who: String(r.who || '').trim() || NOT_RECORDED,
    venture: r.venture != null ? String(r.venture || '').trim() || NOT_RECORDED : null,
    what: logWhat(r),
  }));
}

/** New link's checks, before the Worker's: a level, an expiry and a view cap in range, and the attestation where it is due. */
export function linkProblems(f) {
  const out = [];
  if (!LINK_LEVELS.includes(f?.level)) out.push('Choose what the link shows.');
  const h = Number(f?.hours);
  if (!Number.isInteger(h) || h < LINK_HOURS.min || h > LINK_HOURS.max) out.push(`A link expires in ${LINK_HOURS.min} to ${LINK_HOURS.max} hours.`);
  const v = Number(f?.views);
  if (!Number.isInteger(v) || v < LINK_VIEWS.min || v > LINK_VIEWS.max) out.push(`A link allows ${LINK_VIEWS.min} to ${LINK_VIEWS.max} views.`);
  if (ATTESTED.has(f?.level) && f?.agreed !== true) out.push('Confirm the holders named agreed, for an Investor or Full link.');
  return out;
}

export const linkBody = (f) => ({
  level: f.level,
  ...(String(f.label || '').trim() ? { label: String(f.label).trim().slice(0, 120) } : {}),
  expires_in_hours: Number(f.hours),
  view_limit: Number(f.views),
  ...(ATTESTED.has(f.level) ? { holders_agreed: f.agreed === true } : {}),
});

/** The support reason's check: the Worker's bounds, said before it refuses. */
export function supportProblem(reason) {
  const n = String(reason || '').trim().length;
  if (n < SUPPORT_REASON.min) return `Say why you are opening it, in at least ${SUPPORT_REASON.min} characters. The founder sees it.`;
  if (n > SUPPORT_REASON.max) return `Keep the reason to ${SUPPORT_REASON.max} characters.`;
  return null;
}

// ─────────────────────────────────────────────── the views (CT17, CT18, the link)

/** The line under a shared view's title, from how the reader came to see it. */
export function sharedLine(read, venture = 'this venture') {
  const level = levelLabel(read?.level);
  switch (read?.via) {
    case 'grant':
    case 'member': return read?.read_only === false ? `${venture} · ${level} level.` : `Shared with you at ${level} level. You can read it; you cannot change it.`;
    case 'studio': return `${venture} · group summary. You see your studio’s companies only.`;
    case 'support': return `${venture} · opened for support. Read only. The founder sees why.`;
    case 'hq': return 'HQ reads every company’s cap table and edits none.';
    case 'link': return `Shared by link at ${level} level.`;
    default: return `${venture} · ${level} level.`;
  }
}

/** One ledger row, at the level the Worker sent it. */
const ledgerRow = (h) => ({
  holder: String(h?.holder || '').trim() || NOT_RECORDED,
  group: GROUP[h?.type] || 'Other',
  shares: shares(typeof h?.shares === 'number' ? h.shares : null),
  pct: pct(typeof h?.pct === 'number' ? h.pct : null),
});
const GROUP = { founder: 'Founder', preferred: 'Investor', safe: 'Investor', option_pool: 'Option pool', common: 'Common' };

/**
 * A view the Worker sent, in the shape a page draws. Summary: the split by
 * group and the rounds. Investor and Full: the positions after the last round
 * and the rounds. Own position: the reader's rows and instruments. Nothing
 * saved: the Worker's own sentence, never an empty table.
 */
export function sharedView(read) {
  const v = read?.view;
  if (!v) return { kind: 'none', reason: 'The view could not be read.' };
  if (v.recorded === false) return { kind: 'none', reason: v.reason || 'No cap table is saved for this venture yet.' };
  const split = Array.isArray(v.summary) ? v.summary.map((g) => ({ group: g.group, pct: pct(g.pct) })) : [];
  if (v.level === 'own_position') {
    return {
      kind: 'own', holder: v.holder, split, disclosure: v.disclosure || null,
      rows: (v.position || []).map(ledgerRow),
      instruments: (v.instruments || []).map((i) => ({ type: i.instrument === 'note' ? 'Convertible note' : 'SAFE', basis: i.basis === 'post_money' ? 'Post-money' : i.basis === 'pre_money' ? 'Pre-money' : NOT_RECORDED, signed: day(i.issue_date) })),
      documents: (v.documents || []).map((d) => ({ title: d.title || NOT_RECORDED, status: d.status || NOT_RECORDED })),
    };
  }
  if (v.audience === 'summary') {
    return { kind: 'summary', split, rounds: Number.isFinite(Number(v.rounds_completed)) ? Number(v.rounds_completed) : null, disclosure: v.disclosure || null };
  }
  const rounds = Array.isArray(v.rounds) ? v.rounds : [];
  const ledger = rounds.length ? rounds[rounds.length - 1]?.ledger : v.founding;
  return {
    kind: v.audience === 'full' ? 'full' : 'investor',
    name: v.scenario_name || null,
    rows: (Array.isArray(ledger) ? ledger : []).map(ledgerRow),
    rounds: rounds.map((r) => ({ name: String(r?.name || 'Round'), price: typeof r?.price_per_share === 'number' ? `$${r.price_per_share.toFixed(2)} a share` : NOT_RECORDED })),
    disclosure: v.disclosure || null,
  };
}
