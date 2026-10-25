/**
 * D987 (#2778) — HQ's Program grants page as pure functions over D982's reads
 * (`GET /api/admin/program-grants`, `/licences/:uid`, `/defaults`), D983's
 * requests (`/requests`) and D986's partner deal types. No React here, so
 * `node --test` loads it alone.
 *
 * THE WORDS ARE THE CANVAS'S (GR1–GR15) where the store holds what they say,
 * and the store's where the canvas says more than it holds:
 *   - a granted program the Worker does not count in force says what it waits
 *     on (the licence, the schedule, its start), never just "Granted";
 *   - a draft (D956: a proposal approved for one studio) reads "Draft";
 *   - "Requests by month" draws what D983 counts: approved, declined,
 *     withdrawn and still waiting (the store does not split an approval by
 *     its terms);
 *   - "In use" waits on the studios' program figures (#3061).
 * A term nobody set reads "Not recorded"; a failed read is Unreadable; neither
 * is ever a zero.
 */
import { PROGRAMS, statusWord, kindWord } from '../../../lib/programGrants.js';
import { NOT_RECORDED } from '../../../lib/absence.js';

export const GRANTS_PATH = '/admin/licences/programs';
export const REQUESTS_PATH = `${GRANTS_PATH}/requests`;
export const DEFAULTS_PATH = `${GRANTS_PATH}/defaults`;
export const studioPath = (uid) => `${GRANTS_PATH}/studio/${encodeURIComponent(uid)}`;
export { NOT_RECORDED };
export const UNREADABLE = 'Unreadable';
export const REASON_MIN = 10;
export const IN_USE_WAIT = 'This studio has not reported program figures yet.';

/** The page's tabs (GR1). History waits for a read across studios; each studio's history is on its page. */
export const TABS = [
  { key: 'grid', label: 'Grid', path: GRANTS_PATH },
  { key: 'requests', label: 'Requests', path: REQUESTS_PATH },
  { key: 'defaults', label: 'Default terms', path: DEFAULTS_PATH },
];

/** Which tab or page an address is. */
export function viewOf(pathname) {
  const p = String(pathname || '').replace(/\/+$/, '');
  if (p === REQUESTS_PATH) return { view: 'requests' };
  if (p === DEFAULTS_PATH) return { view: 'defaults' };
  const m = p.match(/^\/admin\/licences\/programs\/studio\/([^/]+)$/);
  if (m) return { view: 'studio', uid: decodeURIComponent(m[1]) };
  return { view: 'grid' };
}

// ---------------------------------------------------------------- words

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2027-10-31" or a D1 stamp → "31 Oct 2027", read in UTC (D1 stamps are UTC). */
export function dayWord(v, { year = true } = {}) {
  if (!v) return null;
  const s = String(v).trim();
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : /(?:Z|[+-]\d{2}:?\d{2})$/i.test(s) ? s : `${s.replace(' ', 'T')}Z`);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year ? ` ${d.getUTCFullYear()}` : ''}`;
}
export const daysSince = (v, now) => {
  const ms = Date.parse(String(v || '').replace(' ', 'T') + (/[zZ]|[+-]\d{2}:?\d{2}$/.test(String(v || '')) ? '' : 'Z'));
  return Number.isFinite(ms) ? Math.max(0, Math.floor((now - ms) / 86_400_000)) : null;
};
export const dayCount = (n) => (n == null ? NOT_RECORDED : `${n} ${n === 1 ? 'day' : 'days'}`);

/** Money from cents and a currency, never a guessed currency. */
export function money(cents, currency) {
  if (cents == null || currency == null) return null;
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: String(currency).toUpperCase(), maximumFractionDigits: Number(cents) % 100 ? 2 : 0 }).format(Number(cents) / 100);
  } catch { return `${(Number(cents) / 100).toLocaleString('en-US')} ${currency}`; }
}
const pct = (bps) => `${(Number(bps) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;

/** Each term's label (GR4's eyebrows and GR6's rows) and how its value reads. */
export const TERMS = {
  starts_on: { label: 'Starts', group: 'Period', kind: 'date' },
  ends_on: { label: 'Ends', group: 'Period', kind: 'date' },
  ends_with_licence: { label: 'Ends with the licence', group: 'Period', kind: 'flag' },
  capacity_cap: { label: 'People at once', group: 'Capacity', kind: 'count' },
  capacity_uncapped: { label: 'No cap', group: 'Capacity', kind: 'flag' },
  cohorts_per_year: { label: 'Cohorts a year', group: 'Capacity', kind: 'count' },
  credits_per_quarter: { label: 'Credits a quarter', group: 'Credits', kind: 'count' },
  fee_cents: { label: 'Program fee a year', group: 'Money', kind: 'cents' },
  currency: { label: 'Currency', group: 'Money', kind: 'currency' },
  hq_share_bps: { label: 'HQ share', group: 'Money', kind: 'bps' },
  hq_approves_each_cohort: { label: 'HQ approves each cohort', group: 'HQ approval', kind: 'flag' },
  hq_approval_above_cents: { label: 'HQ approves custom terms above', group: 'HQ approval', kind: 'cents' },
  playbook: { label: 'Playbook', group: 'Playbook', kind: 'enum', values: { as_written: 'Follow HQ’s playbook as written', may_adapt: 'May adapt HQ’s playbook' } },
  brand: { label: 'Brand', group: 'Brand', kind: 'enum', values: { axal: 'Run as an Axal VC program', studio: 'Run under the studio’s brand' } },
  reporting: { label: 'Reporting', group: 'Reporting', kind: 'enum', values: { monthly: 'Program figures to HQ monthly', quarterly: 'Program figures to HQ quarterly', yearly: 'Program figures to HQ yearly' } },
  requires_signed_schedule: { label: 'Starts only when the schedule is signed', group: 'Contract', kind: 'flag' },
};
export const TERM_ORDER = Object.keys(TERMS);

/** One term's value in words; null is "Not recorded". `terms` gives the currency for money. */
export function termWord(key, value, terms = {}) {
  const t = TERMS[key];
  if (value == null || value === '') return NOT_RECORDED;
  if (!t) return String(value);
  switch (t.kind) {
    case 'date': return dayWord(value) || NOT_RECORDED;
    case 'flag': return Number(value) === 1 ? 'On' : 'Off';
    case 'cents': return money(value, terms.currency) || `${(Number(value) / 100).toLocaleString('en-US')} (currency not recorded)`;
    case 'bps': return pct(value);
    case 'enum': return t.values[value] || String(value);
    default: return Number(value).toLocaleString('en-US');
  }
}

/** The defaultable keys a grant's terms differ from its program's defaults on ("own terms"). */
export function changedKeys(terms, defaults) {
  if (!terms || !defaults) return [];
  return Object.keys(defaults).filter((k) => k in terms && (terms[k] ?? null) !== (defaults[k] ?? null));
}

// ---------------------------------------------------------------- cells (GR1)

const WAIT_WORDS = {
  licence_active: 'the licence to be active',
  schedule_signed: 'the schedule to be signed',
  start_date: 'its start date',
  ended_by_date: 'its end date has passed',
};
export const waitingWord = (list) => (list || []).map((w) => WAIT_WORDS[w] || String(w).replace(/_/g, ' ')).join(' and ');

/**
 * One grid cell. `grant` is D982's presented grant or undefined; `request` an
 * open request for it; `frozen` a suspended licence. Returns
 * { kind, pill, sub, tip, canGrant }.
 */
export function cellOf({ program, grant, request, defaults, studio, frozen }) {
  const who = `${studio}, ${program.name}`;
  if (program.grant === 'hq') return { kind: 'hq', pill: '⌂ HQ only', sub: null, tip: `${who}, HQ only` };
  if (program.grant === 'notready') return { kind: 'notready', pill: program.note || 'Not ready to grant', sub: null, tip: `${who}, not ready to grant` };
  if (request && (!grant || grant.state === 'ended')) {
    return { kind: 'requested', pill: `◷ Requested ${dayWord(request.created_at, { year: false }) || ''}`.trim(), sub: null, tip: `${who}, requested ${dayWord(request.created_at) || ''}`.trim() };
  }
  if (!grant) {
    const can = !frozen && defaults?.grantable !== false;
    return { kind: 'none', pill: null, sub: null, tip: `${who}, not granted${can ? '. Enter grants it.' : ''}`, canGrant: can };
  }
  const end = dayWord(grant.effective_end);
  if (grant.state === 'draft') return { kind: 'draft', pill: '✎ Draft', sub: 'to finish', tip: `${who}, a draft HQ approved for this studio; grant it to finish it` };
  if (grant.state === 'paused') return { kind: 'paused', pill: `‖ Paused ${dayWord(grant.paused_at, { year: false }) || ''}`.trim(), sub: null, tip: `${who}, paused ${dayWord(grant.paused_at) || ''}`.trim() };
  if (grant.state === 'ended') {
    const can = !frozen && defaults?.grantable !== false;
    return { kind: 'ended', pill: null, sub: `Ended ${dayWord(grant.ended_at, { year: false }) || ''}`.trim(), tip: `${who}, ended ${dayWord(grant.ended_at) || ''}`.trim(), canGrant: can };
  }
  const own = changedKeys(grant.terms, defaults?.terms);
  const period = end ? `to ${end}` : 'no end recorded';
  if (!grant.in_force) {
    return { kind: own.length ? 'own' : 'granted', pill: '✓ Granted', sub: `waiting on ${waitingWord(grant.waiting_on)}`, tip: `${who}, granted, waiting on ${waitingWord(grant.waiting_on)}`, waiting: true };
  }
  if (own.length) {
    const changed = own.map((k) => `${TERMS[k]?.label || k} ${termWord(k, defaults.terms[k], defaults.terms)} → ${termWord(k, grant.terms[k], grant.terms)}`).join('; ');
    return { kind: 'own', pill: '✓ Granted', sub: `own terms · ${period}`, tip: `${who}, granted on its own terms. Changed: ${changed}` };
  }
  return { kind: 'granted', pill: '✓ Granted', sub: period, tip: `${who}, granted ${period}` };
}

/** Open requests by "licence uid|program key", the oldest per pair. */
export function openRequestsByCell(items) {
  const out = new Map();
  for (const r of items || []) {
    if (r.status !== 'open' || !r.licence?.uid || !r.program_key) continue;
    const k = `${r.licence.uid}|${r.program_key}`;
    if (!out.has(k)) out.set(k, r);
  }
  return out;
}

/** The grid's rows from the grid read (GR1), each with its nine cells. */
export function gridRows(grid, requests) {
  const defaults = new Map((grid?.programs || []).map((p) => [p.program_key, p]));
  const open = openRequestsByCell(requests);
  return (grid?.licences || []).map((l) => {
    const frozen = l.status === 'suspended';
    return {
      uid: l.uid,
      ref: l.licence_ref || NOT_RECORDED,
      name: l.brand_name || NOT_RECORDED,
      kind: kindWord(l.kind),
      status: l.status,
      statusWord: statusWord(l.status),
      frozen,
      note: frozen ? 'Suspended. Program changes are frozen until HQ lifts the suspension.'
        : l.status === 'pending_activation' ? 'Grants start when the licence is active.' : null,
      cells: PROGRAMS.map((p) => ({
        program: p,
        grant: l.grants?.[p.key],
        ...cellOf({ program: p, grant: l.grants?.[p.key], request: open.get(`${l.uid}|${p.key}`), defaults: defaults.get(p.key), studio: l.brand_name || l.licence_ref || 'This studio', frozen }),
      })),
    };
  });
}

// ---------------------------------------------------------------- tiles (GR1)

const STATUS_SUB = ['active', 'suspended', 'pending_activation'];
/** The four tiles. Each is { value, sub, flag } or { unreadable, reason }. */
export function tilesOf(grid, requestsRead, now) {
  if (!grid) return null;
  const licences = grid.licences || [];
  const by = (s) => licences.filter((l) => l.status === s).length;
  const all = licences.flatMap((l) => Object.values(l.grants || {}));
  const defaults = new Map((grid.programs || []).map((p) => [p.program_key, p.terms]));
  const inForce = all.filter((g) => g.in_force);
  const own = inForce.filter((g) => changedKeys(g.terms, defaults.get(g.program_key)).length > 0).length;
  const programs = new Set(inForce.map((g) => g.program_key)).size;
  const t = grid.tiles || {};
  const open = (requestsRead?.status === 'ready' ? requestsRead.data?.items || [] : []).filter((r) => r.status === 'open');
  const oldest = open.length ? open.reduce((a, b) => (String(a.created_at) < String(b.created_at) ? a : b)) : null;
  const ending = all.filter((g) => g.state !== 'ended' && g.effective_end && g.effective_end >= new Date(now).toISOString().slice(0, 10))
    .sort((a, b) => String(a.effective_end).localeCompare(String(b.effective_end)))[0];
  const name = (uid) => licences.find((l) => l.uid === uid)?.brand_name || NOT_RECORDED;
  const programName = (k) => PROGRAMS.find((p) => p.key === k)?.name || k;
  return [
    { key: 'studios', label: 'Studios with a licence', value: licences.length, sub: `${by('active')} active · ${by('suspended')} suspended · ${by('pending_activation')} pending activation` },
    { key: 'in-force', label: 'Grants in force', value: t.in_force, sub: `across ${programs} ${programs === 1 ? 'program' : 'programs'} · ${own} on their own terms` },
    t.requests_waiting == null
      ? { key: 'requests', label: 'Requests waiting', unreadable: true, reason: t.requests_waiting_reason || 'Program requests could not be read.' }
      : {
        key: 'requests', label: 'Requests waiting', value: t.requests_waiting,
        sub: oldest ? `oldest ${dayCount(daysSince(oldest.created_at, now))}` : t.requests_waiting ? 'the oldest could not be read' : 'none waiting',
        flag: open.some((r) => r.sla === 'past') ? 'Past response time' : null,
      },
    { key: 'ending', label: 'Ending in 90 days', value: t.ending_in_90_days, sub: t.ending_in_90_days && ending ? `${programName(ending.program_key)} · ${name(ending.licence_uid)} · ends ${dayWord(ending.effective_end)}` : 'none in the next 90 days' },
  ].map((x) => ({ ...x, statuses: x.key === 'studios' ? STATUS_SUB : undefined }));
}

// ---------------------------------------------------------------- charts (GR1)

export const HOLDING_SERIES = [
  { key: 'granted', label: 'Granted', tone: 'violet' },
  { key: 'own', label: 'Granted, own terms', tone: 'sky' },
  { key: 'requested', label: 'Requested', tone: 'amber' },
  { key: 'paused', label: 'Paused', tone: 'emerald' },
];
/** "Studios holding each program": the grantable programs, each studio counted once. */
export function holdingRows(grid, requests) {
  const licences = grid?.licences || [];
  const defaults = new Map((grid?.programs || []).map((p) => [p.program_key, p.terms]));
  const open = openRequestsByCell(requests);
  return PROGRAMS.filter((p) => p.grant === 'yes').map((p) => {
    const c = { granted: 0, own: 0, requested: 0, paused: 0 };
    for (const l of licences) {
      const g = l.grants?.[p.key];
      if (g?.state === 'granted') c[changedKeys(g.terms, defaults.get(p.key)).length ? 'own' : 'granted'] += 1;
      else if (g?.state === 'paused') c.paused += 1;
      else if (open.has(`${l.uid}|${p.key}`)) c.requested += 1;
    }
    return { key: p.key, label: p.name, ...c, total: c.granted + c.own + c.requested + c.paused, of: licences.length };
  });
}

export const MONTH_SERIES = [
  { key: 'approved', label: 'Approved', tone: 'violet' },
  { key: 'declined', label: 'Declined', tone: 'amber' },
  { key: 'withdrawn', label: 'Withdrawn', tone: 'muted' },
  { key: 'waiting', label: 'Still waiting', tone: 'sky' },
];
export function monthWord(ym) {
  const [y, m] = String(ym).split('-').map(Number);
  return Number.isFinite(m) ? `${MONTHS[m - 1]}${y ? ` ${y}` : ''}` : String(ym);
}

// ---------------------------------------------------------------- one studio (GR3)

/** A grant's period: "1 Nov 2024 → licence end", "→ 31 Oct 2027", or not recorded. */
export function periodOf(grant, licence) {
  if (!grant) return '—';
  const t = grant.terms || {};
  const from = dayWord(t.starts_on) || 'Start not recorded';
  const to = t.ends_on ? dayWord(t.ends_on) : Number(t.ends_with_licence) === 1 ? `licence end${licence?.renews_on ? ` (${dayWord(licence.renews_on)})` : ''}` : 'end not recorded';
  return `${from} → ${to}`;
}

/** The two lines of "Key terms" for a grant, from the terms that apply to its program. */
export function keyTerms(terms) {
  const t = terms || {};
  const lines = [];
  if ('cohorts_per_year' in t && t.cohorts_per_year != null) lines.push(`${t.cohorts_per_year} cohorts a year`);
  if ('capacity_uncapped' in t && Number(t.capacity_uncapped) === 1) lines.push('No cap');
  else if ('capacity_cap' in t && t.capacity_cap != null) lines.push(`Up to ${t.capacity_cap} at a time`);
  if ('credits_per_quarter' in t && t.credits_per_quarter != null) lines.push(`${t.credits_per_quarter} credits a quarter`);
  if ('hq_share_bps' in t && t.hq_share_bps != null) lines.push(`${pct(t.hq_share_bps)} to HQ`);
  if ('hq_approves_each_cohort' in t && Number(t.hq_approves_each_cohort) === 1) lines.push('HQ approves each cohort');
  if (!lines.length && t.fee_cents != null) lines.push(`Program fee ${termWord('fee_cents', t.fee_cents, t)} a year`);
  return lines.length ? lines : ['Terms not recorded'];
}

export function scheduleWord(grant) {
  if (!grant || grant.state === 'ended' || grant.state === 'draft') return '—';
  const s = grant.schedule?.status;
  if (s === 'signed') return `Signed ${dayWord(grant.schedule.signed_at, { year: false }) || ''}`.trim();
  if (s === 'sent') return 'Sent · waiting to be signed';
  if (Number(grant.terms?.requires_signed_schedule) === 0) return 'Not required';
  return 'Not sent';
}

/** GR3's rows: the nine programs in catalogue order against this studio's grants and requests. */
export function studioRows(read, defaultsList, requests) {
  const grants = new Map((read?.grants || []).map((g) => [g.program_key, g]));
  const defaults = new Map((defaultsList || []).map((d) => [d.program_key, d]));
  const open = openRequestsByCell(requests);
  const licence = read?.licence;
  const frozen = licence?.status === 'suspended';
  return PROGRAMS.map((p) => {
    const g = grants.get(p.key);
    const d = defaults.get(p.key);
    const request = licence ? open.get(`${licence.uid}|${p.key}`) : undefined;
    const cell = cellOf({ program: p, grant: g, request, defaults: d, studio: licence?.brand_name || 'This studio', frozen });
    const live = g && g.state !== 'ended';
    const changed = live ? changedKeys(g.terms, d?.terms) : [];
    return {
      program: p, grant: g, request, cell, changed,
      grantWord: p.grant === 'hq' ? '⌂ HQ only' : p.grant === 'notready' ? '– Not ready to grant'
        : cell.kind === 'requested' ? cell.pill : !g || g.state === 'ended' ? '○ Not granted'
          : g.state === 'draft' ? '✎ Draft' : g.state === 'paused' ? '‖ Paused' : changed.length ? '✓ Granted, own terms' : '✓ Granted',
      period: live ? periodOf(g, licence) : '—',
      terms: p.grant === 'hq' ? ['Runs in HQ › Platform.'] : p.grant === 'notready' ? [`${p.note || 'Not ready'}.`]
        : cell.kind === 'requested' ? ['Waiting for HQ’s answer.'] : live ? keyTerms(g.terms) : ['Default terms apply if granted.'],
      schedule: p.grant === 'yes' ? scheduleWord(g) : '—',
      inUse: live && g.state !== 'draft' ? { text: NOT_RECORDED, reason: IN_USE_WAIT } : null,
      actions: actionsOf(p, g, cell, frozen),
    };
  });
}

/** What a row's menu offers (GR3's ⋯), each with why not when the licence is frozen. */
export function actionsOf(program, grant, cell, frozen) {
  if (program.grant !== 'yes') return [];
  if (cell.kind === 'requested') return [{ key: 'answer', label: 'Answer' }];
  if (!grant || grant.state === 'ended') return [{ key: 'grant', label: 'Grant', disabled: frozen }];
  if (grant.state === 'draft') return [{ key: 'grant', label: 'Finish grant', disabled: frozen }];
  const out = [];
  if (grant.state === 'granted') out.push({ key: 'change', label: 'Change terms', disabled: frozen }, { key: 'pause', label: 'Pause' });
  if (grant.state === 'paused') out.push({ key: 'resume', label: 'Resume', disabled: frozen });
  out.push({ key: 'end', label: 'End' });
  if (grant.state === 'granted' && grant.schedule?.status !== 'signed' && Number(grant.terms?.requires_signed_schedule) !== 0) {
    out.push({ key: 'schedule', label: grant.schedule?.status === 'sent' ? 'Send schedule again' : 'Send schedule', disabled: frozen });
  }
  out.push({ key: 'history', label: 'View history' });
  return out;
}

export const FROZEN_LINE = 'This studio’s licence is suspended, so program changes are frozen until HQ lifts it.';

/** GR3's tiles. */
export function studioTiles(rows, requests, licenceUid, now) {
  const grantable = rows.filter((r) => r.program.grant === 'yes');
  const granted = grantable.filter((r) => r.grant && (r.grant.state === 'granted' || r.grant.state === 'paused'));
  const own = granted.filter((r) => r.changed.length);
  const waiting = (requests || []).filter((r) => r.status === 'open' && r.licence?.uid === licenceUid);
  const fees = new Map();
  let unrecorded = 0;
  for (const r of granted.filter((x) => x.grant.state === 'granted')) {
    const { fee_cents: f, currency: c } = r.grant.terms || {};
    if (f == null || c == null) { unrecorded += 1; continue; }
    fees.set(c, (fees.get(c) || 0) + Number(f));
  }
  const oldest = waiting.length ? waiting.reduce((a, b) => (String(a.created_at) < String(b.created_at) ? a : b)) : null;
  return [
    { key: 'granted', label: 'Programs granted', value: granted.length, sub: `of ${grantable.length} HQ can grant` },
    { key: 'own', label: 'On their own terms', value: own.length, sub: own.length ? own.map((r) => r.program.name).join(', ') : 'all on default terms' },
    { key: 'requests', label: 'Requests waiting', value: waiting.length, sub: oldest ? `${oldest.program_name || oldest.program_key} · ${dayCount(daysSince(oldest.created_at, now))}` : 'none waiting', flag: waiting.some((r) => r.sla === 'past') ? 'Past response time' : null },
    fees.size
      ? { key: 'fees', label: 'Program fees a year', value: [...fees].map(([c, cents]) => money(cents, c)).join(' + '), sub: unrecorded ? `from the grant terms · ${unrecorded} without a fee recorded` : 'from the grant terms' }
      : { key: 'fees', label: 'Program fees a year', value: granted.length ? NOT_RECORDED : '—', sub: granted.length ? 'No grant records a fee and a currency.' : 'nothing granted' },
  ];
}

const HISTORY_WORDS = {
  granted: 'granted', regranted: 'granted again', terms_changed: 'terms changed', paused: 'paused', resumed: 'resumed', ended: 'ended',
  schedule_sent: 'schedule sent for signature', schedule_signed: 'schedule signed', draft_opened: 'draft opened',
  request_approved: 'request approved', request_declined: 'request declined', deal_types_changed: 'partner deal types changed',
};
/** One "Recent changes" row (GR3). */
export function historyRow(e) {
  const name = PROGRAMS.find((p) => p.key === e.program_key)?.name || e.program_key || 'Programs';
  const changed = (e.changed || []).filter((c) => c && c.key && c.key !== 'state')
    .map((c) => `${TERMS[c.key]?.label || c.key} ${termWord(c.key, c.before)} → ${termWord(c.key, c.after)}`);
  return {
    id: e.id,
    when: `${dayWord(e.at) || 'Date not recorded'} · by ${e.actor_name || 'HQ'}`,
    what: `${name}: ${HISTORY_WORDS[e.action] || String(e.action || 'changed').replace(/_/g, ' ')}${changed.length ? ` · ${changed.join('; ')}` : ''}`,
    reason: e.reason ? `Reason: ${e.reason}` : null,
  };
}

// ---------------------------------------------------------------- the lightbox (GR4)

/** The term keys a program's grant carries, in GR4's order. */
export function termKeysFor(defaults) {
  const applies = new Set(defaults?.applies || []);
  return TERM_ORDER.filter((k) => applies.has(k));
}

/** A term's form value → what the Worker takes (null clears it). */
export function termInput(key, raw) {
  const t = TERMS[key];
  if (raw === '' || raw == null) return null;
  if (t.kind === 'flag') return raw === true || raw === 1 || raw === '1' ? 1 : 0;
  if (t.kind === 'cents') { const n = Math.round(Number(raw) * 100); return Number.isFinite(n) ? n : raw; }
  if (t.kind === 'bps') { const n = Math.round(Number(raw) * 100); return Number.isFinite(n) ? n : raw; }
  if (t.kind === 'count') { const n = Number(raw); return Number.isFinite(n) ? n : raw; }
  if (t.kind === 'currency') return String(raw).toUpperCase();
  return raw;
}
/** A stored term → the form's value. */
export function termField(key, value) {
  const t = TERMS[key];
  if (value == null) return '';
  if (t.kind === 'cents' || t.kind === 'bps') return String(Number(value) / 100);
  if (t.kind === 'flag') return Number(value) === 1 ? '1' : '0';
  return String(value);
}

/** What a grant write sends: only the terms that differ from where the form started. */
export function termsPayload(keys, form, start) {
  const out = {};
  for (const k of keys) {
    const v = termInput(k, form[k]);
    if ((v ?? null) !== (start[k] ?? null)) out[k] = v;
  }
  return out;
}

/** GR4's live sentence, from the terms as they stand in the form. */
export function liveSentence({ studio, program, terms, licence }) {
  const t = terms || {};
  const from = t.starts_on ? dayWord(t.starts_on) : 'its start date (not recorded)';
  const to = t.ends_on ? dayWord(t.ends_on) : Number(t.ends_with_licence) === 1 ? 'the end of its licence' : 'an end HQ has not recorded';
  const parts = [`${studio || 'This studio'} may run ${program} from ${from} to ${to}`];
  if (Number(t.capacity_uncapped) === 1) parts.push('with no cap on people at once');
  else if (t.capacity_cap != null) parts.push(`for up to ${Number(t.capacity_cap).toLocaleString('en-US')} at a time`);
  const fee = t.fee_cents != null ? money(t.fee_cents, t.currency) : null;
  parts.push(fee ? `paying HQ ${fee} a year` : 'with no program fee recorded');
  const start = licence?.status && licence.status !== 'active' ? ' It starts when the licence is active.' : '';
  const sched = Number(t.requires_signed_schedule) === 0 ? '' : ' It starts when the program schedule is signed.';
  return `${parts.join(', ')}.${start}${sched}`;
}

// ---------------------------------------------------------------- requests (GR5)

const SLA_WORDS = { past: 'Past response time', due_soon: 'Response due soon', ok: 'Within response time' };
export function requestRow(r, now) {
  const open = r.status === 'open';
  const asked = r.request || {};
  const theirNote = r.note || (asked.term ? `${TERMS[asked.term]?.label || asked.term} to ${asked.asked ?? NOT_RECORDED}` : null);
  return {
    uid: r.uid,
    studio: r.licence?.brand_name || 'Licence not found in the ledger',
    ref: r.licence?.licence_ref || null,
    licenceUid: r.licence?.uid || null,
    program: r.program_name || r.program_key || NOT_RECORDED,
    programKey: r.program_key,
    asksFor: r.asks_for || r.kind,
    kind: r.kind,
    sent: dayWord(r.created_at, { year: false }) || NOT_RECORDED,
    sentFull: dayWord(r.created_at) || NOT_RECORDED,
    waiting: open ? dayCount(daysSince(r.created_at, now)) : '—',
    sla: open ? r.sla : null,
    slaWord: open && r.sla ? SLA_WORDS[r.sla] : null,
    note: theirNote || '—',
    status: open ? '◷ Waiting' : r.status === 'answered' ? '✓ Answered' : r.status === 'declined' ? '– Declined' : r.status === 'withdrawn' ? '– Withdrawn' : r.status,
    open,
    draft: r.draft || null,
    answer: r.answer || null,
    action: open ? 'Answer' : r.status === 'answered' && r.draft ? 'Finish grant' : 'Open',
  };
}

export function requestRefusal(e) {
  const code = e?.code || e?.data?.error;
  if (code === 'step_up_required') return 'Your authenticator check lapsed. Confirm it, then try again. Nothing was saved.';
  if (code === 'reason_required') return `Say why, in at least ${REASON_MIN} characters.`;
  return e?.data?.message || e?.message || 'It could not be saved. Try again.';
}

// ---------------------------------------------------------------- default terms (GR6)

export function defaultsCards(defaultsList, grid) {
  const licences = grid?.licences || [];
  return (defaultsList || []).map((d) => {
    const p = PROGRAMS.find((x) => x.key === d.program_key);
    const keys = TERM_ORDER.filter((k) => k in (d.terms || {}));
    const granted = licences.filter((l) => l.grants?.[d.program_key]?.state === 'granted').length;
    const paused = licences.filter((l) => l.grants?.[d.program_key]?.state === 'paused').length;
    return {
      key: d.program_key, name: d.name, group: d.group, readiness: d.readiness, grantable: d.grantable,
      locked: d.locked_reason, kind: d.readiness === 'hq' ? 'hq' : d.readiness === 'notready' ? 'notready' : 'yes',
      note: p?.note || null,
      rows: keys.map((k) => ({ key: k, label: TERMS[k]?.label || k, text: termWord(k, d.terms[k], d.terms) })),
      foot: d.readiness === 'hq' ? 'Runs in HQ › Platform.' : d.readiness === 'notready' ? null
        : grid ? `Granted to ${granted} ${granted === 1 ? 'studio' : 'studios'}${paused ? ` · ${paused} paused` : ''}` : null,
      updated: d.updated_at ? `Changed ${dayWord(d.updated_at)}` : 'Never changed',
      terms: d.terms || {},
    };
  });
}

// ---------------------------------------------------------------- CSV (GR3's Download CSV)

export function csvField(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
/** One studio's programs as CSV: every column in words, so a missing value reads "Not recorded". */
export function studioCsv(rows) {
  const head = ['Program', 'Group', 'Grant', 'Period', 'Key terms', 'Schedule', 'In use'];
  const lines = rows.map((r) => [r.program.name, r.program.group, r.grantWord, r.period, r.terms.join(' · '), r.schedule, r.inUse ? `${r.inUse.text}: ${r.inUse.reason}` : '—']);
  return [head, ...lines].map((l) => l.map(csvField).join(',')).join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------- chart specs (ui/Charts.jsx)

/** "Studios holding each program" as StackBars' spec, with its alt sentence. */
export function holdingChart(rows) {
  const total = rows[0]?.of ?? 0;
  const top = [...rows].sort((a, b) => b.total - a.total)[0];
  return {
    type: 'stackbars', head: 'Program', parts: HOLDING_SERIES,
    rows: rows.map((r) => ({ key: r.key, label: r.label, total: `${r.total} of ${r.of}`, parts: HOLDING_SERIES.map((s) => ({ key: s.key, label: s.label, tone: s.tone, value: r[s.key] })) })),
    alt: `Studios holding each program, of ${total}: ${rows.map((r) => `${r.label} ${r.total}`).join('; ')}.`,
    foot: top && top.total ? `${top.label} is the most granted program: ${top.total} of ${total} studios.` : 'No program is granted or requested yet.',
  };
}

/** "Requests by month" as GroupedColumns' spec; null when D983's figures could not be read. */
export function monthsChart(byMonth) {
  if (!Array.isArray(byMonth)) return null;
  const last = byMonth[byMonth.length - 1];
  return {
    type: 'grouped', series: MONTH_SERIES,
    rows: byMonth.map((m) => ({ label: monthWord(m.month).split(' ')[0], values: MONTH_SERIES.map((s) => Number(m[s.key] ?? 0)), toDate: !!m.so_far })),
    alt: `Requests by month, ${monthWord(byMonth[0]?.month)} to ${monthWord(last?.month)}${last ? `; ${monthWord(last.month)} so far has ${last.waiting} still waiting, ${last.approved} approved and ${last.declined} declined` : ''}.`,
  };
}
