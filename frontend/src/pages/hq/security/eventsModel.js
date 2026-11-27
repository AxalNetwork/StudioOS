/**
 * D4803 (#4803, canvas SE03, SE11b) — the Events workspace's words: a human
 * label for every action the ledger can hold, its outcome as a state, the day
 * groups, and the filter values the server takes. Pure, for the tests.
 *
 * THE RAW ID STAYS. Each row shows its label first and the stored action under
 * it (`gate.totp`, `detail=factor_required`), and the drawer holds the whole
 * row as JSON. A label is a reading aid, never a replacement for the record:
 * an action this file has no word for is drawn from its own id, never hidden
 * and never guessed.
 */

/** activity_logs actions the ledger reads (ACTOR_SIDE_ACTIONS in admin_security.ts). */
const ACTIVITY_LABELS = Object.freeze({
  role_changed: 'Role changed',
  user_toggled: 'Account activated or deactivated',
  kyc_approved_by_admin: 'KYC approved',
  kyc_bypass_granted: 'KYC bypass granted',
  kyc_rejected_by_admin: 'KYC rejected',
  kyc_document_access: 'KYC document viewed',
  kyc_record_access: 'KYC record viewed',
  kyc_queue_access: 'KYC queue viewed',
  partner_profile_access: 'Partner profile viewed',
  kyc_field_shown: 'KYC value shown',
  kyc_renewals_access: 'KYC renewals viewed',
  kyc_audit_access: 'KYC audit viewed',
  kyc_periods_changed: 'KYC periods changed',
  kyc_sent_to_hq: 'KYC case sent to HQ',
  kyc_hq_decided: 'KYC case decided at HQ',
  kyc_case_access: 'KYC case viewed',
  kyc_figures_access: 'KYC figures viewed',
  kyc_case_assigned: 'KYC case assigned',
  kyc_note_added: 'KYC note added',
  kyc_needs_info_by_admin: 'More KYC information requested',
  kyc_recheck_by_admin: 'KYC re-check requested',
  contract_resent: 'Contract resent',
  contract_voided: 'Contract voided',
  hq_branch_support_session: 'Branch support session opened',
  spinout_moderation: 'Spin-out moderated',
});

/** security_events: `<kind>.<factor>`, read with its outcome and detail. */
const SECURITY_KIND = Object.freeze({
  signin: { ok: 'Signed in', refused: 'Sign-in refused' },
  step_up: { ok: 'Step-up verification passed', refused: 'Step-up verification refused' },
  gate: { ok: 'Access check passed', refused: 'Access refused' },
  recovery: { ok: 'Account recovery step passed', refused: 'Account recovery refused' },
});
/** A gate refusal's detail, where it names why. */
const GATE_DETAIL = Object.freeze({
  factor_required: 'Multi-factor authentication required',
  step_up_required: 'Fresh step-up required',
});
const FACTOR_WORD = Object.freeze({
  password: 'password', totp: 'authenticator code', passkey: 'passkey', magic_link: 'email link',
  google: 'Google', recovery_code: 'recovery code',
});

/** `licence_events.event` as a word. */
const LICENCE_LABELS = Object.freeze({
  created: 'Licence created', activated: 'Licence activated', suspended: 'Licence suspended',
  terminated: 'Licence terminated', renewed: 'Licence renewed', reinstated: 'Licence reinstated',
});

/** An id as words: `kyc_case_assigned` → "Kyc case assigned". The fallback, never a guess. */
export function humanize(raw) {
  const s = String(raw || '').replace(/[._]+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : 'Unnamed action';
}

/** The `detail=…` a security event carries in its target, or null. */
export function detailOf(row) {
  const m = /(?:^|· )detail=([^ ·]+)/.exec(String(row?.target || ''));
  return m ? m[1] : null;
}

/**
 * `{ label, raw }` for one ledger row. `raw` is the stored action with its
 * detail, exactly as the store holds it.
 */
export function eventLabel(row) {
  const action = String(row?.action || '');
  const detail = detailOf(row);
  const raw = detail ? `${action} detail=${detail}` : action;
  if (row?.source === 'security_events') {
    const [kind, factor] = action.split('.');
    const words = SECURITY_KIND[kind];
    if (kind === 'gate' && row.outcome === 'refused' && GATE_DETAIL[detail]) return { label: GATE_DETAIL[detail], raw };
    if (words && words[row.outcome]) {
      const how = FACTOR_WORD[factor];
      return { label: how && kind !== 'gate' ? `${words[row.outcome]} · ${how}` : words[row.outcome], raw };
    }
    return { label: humanize(action), raw };
  }
  if (row?.source === 'impersonation_sessions') {
    const label = row.outcome === 'live' ? 'Support session in progress'
      : row.outcome === 'ended' ? 'Support session ended'
        : row.outcome === 'not closed' ? 'Support session never closed'
          : 'Support session';
    return { label, raw: action || 'impersonate' };
  }
  if (row?.source === 'licence_events') {
    const event = action.replace(/^licence /, '');
    return { label: LICENCE_LABELS[event] || `Licence ${humanize(event).toLowerCase()}`, raw };
  }
  if (row?.source === 'activity_logs' && ACTIVITY_LABELS[action]) return { label: ACTIVITY_LABELS[action], raw };
  if (row?.source === 'admin_audit_log' && action.includes('export')) return { label: 'Export downloaded', raw };
  return { label: humanize(action), raw };
}

/**
 * The outcome as a state from the shared vocabulary, with the word the cell
 * shows. Four stores write after their act, so a row there is the act having
 * happened: "Recorded". Only the security ledger stores a verdict, and only a
 * support session has a state.
 */
export function outcomeState(row) {
  const o = row?.outcome;
  if (o === 'refused') return { state: 'action_required', word: 'Refused' };
  if (row?.source === 'security_events' && o === 'ok') return { state: 'healthy', word: 'Allowed' };
  if (o === 'live') return { state: 'pending', word: 'Live' };
  if (o === 'ended') return { state: 'healthy', word: 'Ended' };
  if (o === 'not closed') return { state: 'unknown', word: 'Not closed' };
  if (o === 'ok') return { state: 'healthy', word: 'Recorded' };
  return { state: 'unknown', word: o ? String(o) : 'Unknown' };
}

/** Where a row came from, in words. */
export const SOURCE_SHORT = Object.freeze({
  security_events: 'Security ledger',
  admin_audit_log: 'Admin log',
  activity_logs: 'Activity log',
  impersonation_sessions: 'Support sessions',
  licence_events: 'Licence events',
});

const ms = (at) => {
  if (!at) return NaN;
  const s = String(at);
  return Date.parse(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
};
const DAY_FMT = { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' };

/** `HH:MM` in UTC, or null. */
export function timeOf(at) {
  const t = ms(at);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(11, 16) : null;
}

/** "Today · Sat 7 Nov", "Fri 6 Nov", in UTC. */
export function dayLabel(at, now = Date.now()) {
  const t = ms(at);
  if (!Number.isFinite(t)) return 'No timestamp';
  const day = new Date(t).toISOString().slice(0, 10);
  const words = new Date(t).toLocaleDateString('en-GB', DAY_FMT).replace(',', '');
  return day === new Date(now).toISOString().slice(0, 10) ? `Today · ${words}` : words;
}

/** Rows in groups of one UTC day, in their order: `[{ day, rows }]`. */
export function byDay(rows, now = Date.now()) {
  const out = [];
  for (const r of rows || []) {
    const d = dayLabel(r.at, now);
    if (!out.length || out[out.length - 1].day !== d) out.push({ day: d, rows: [] });
    out[out.length - 1].rows.push(r);
  }
  return out;
}

/** "6 Nov 18:40 UTC" for Load older's line, or null. */
export function olderThanLine(at) {
  const t = ms(at);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })} ${d.toISOString().slice(11, 16)} UTC`;
}

/** The date ranges the filter offers; each resolves to `{ from, to }` in UTC days. */
export const DATE_RANGES = Object.freeze([
  { key: 'any', label: 'Any time' },
  { key: 'today', label: 'Today' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'custom', label: 'Custom range' },
]);
const isoDay = (t) => new Date(t).toISOString().slice(0, 10);
export function rangeDays(key, now = Date.now(), custom = {}) {
  if (key === 'today') return { from: isoDay(now), to: isoDay(now) };
  if (key === '7d') return { from: isoDay(now - 6 * 86400000), to: isoDay(now) };
  if (key === '30d') return { from: isoDay(now - 29 * 86400000), to: isoDay(now) };
  if (key === 'custom') return { from: custom.from || null, to: custom.to || null };
  return { from: null, to: null };
}

/** The outcomes the server filters on, in words. */
export const OUTCOME_OPTIONS = Object.freeze([
  { key: '', label: 'Any outcome' },
  { key: 'refused', label: 'Refused' },
  { key: 'ok', label: 'Allowed or recorded' },
  { key: 'live', label: 'Support session live' },
  { key: 'ended', label: 'Support session ended' },
  { key: 'not_closed', label: 'Support session never closed' },
]);

/**
 * The query the server takes, from the workspace's controls. Empty values are
 * left out, so an untouched bar asks for exactly what the old ledger did.
 */
export function feedQuery({ q, range, custom, actor, outcome, source }, now = Date.now()) {
  const out = {};
  const s = String(q || '').trim();
  if (s) out.q = s;
  const { from, to } = rangeDays(range, now, custom);
  if (from) out.from = from;
  if (to) out.to = to;
  if (actor) out.actor = String(actor);
  if (outcome) out.outcome = outcome;
  if (source) out.source = source;
  return out;
}

/** How many controls narrow the read, for "Filters · n" on phone. */
export const activeCount = (query) => Object.keys(query || {}).length;

/**
 * The actors a page names, for the Actor filter: accounts and support
 * operators with an id, by label, once each. A network or the platform has no
 * account to filter on.
 */
export function actorOptions(rows) {
  const seen = new Map();
  for (const r of rows || []) {
    const id = r?.actor_identity?.user_id;
    if (id && !seen.has(id)) seen.set(id, r.actor_identity.label || `account ${id}`);
  }
  return [...seen].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
}

/** Rows from more than one page, once each by key, in order. */
export function mergePages(...pages) {
  const seen = new Set();
  const out = [];
  for (const p of pages) for (const r of p || []) if (!seen.has(r.key)) { seen.add(r.key); out.push(r); }
  return out;
}
