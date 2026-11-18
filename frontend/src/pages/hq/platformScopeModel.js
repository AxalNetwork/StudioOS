/**
 * D5757 (#5757, finding 16 of #4860) — the words and states of HQ · Platform's
 * scope switcher, over the scoped reading D5786 added.
 *
 * TWO POSITIONS. HQ-wide is the default and reads what the page always read:
 * the platform summary, the deployments registry and traffic by branch. A
 * subsidiary scope is one branch, keyed by its code (`?scope=<code>`), and is
 * read from `GET /api/admin/platform/scopes/:code` alone. An HQ-wide figure
 * never stands in for a subsidiary's.
 *
 * THE STATE IS THE WORKER'S. The reading carries one state by the summary's
 * rule (`healthStateOf`, D4854). This file only names it, with one guard of its
 * own: a reading in which no scoped signal answered is Unknown whatever it
 * says, and a state this file does not know is Unknown. Nothing here reads a
 * missing figure as 0 or a missing reading as Healthy.
 *
 * NOTHING HERE IS FETCHED.
 */
import { detectedIncidents, utcStamp } from './platformOverviewModel';

/** The query parameter that carries the scope. Absent, empty or `hq` is HQ-wide. */
export const SCOPE_PARAM = 'scope';

/** The scope a search string names: a subsidiary code, or null for HQ-wide. */
export function scopeFromSearch(search) {
  const params = search instanceof URLSearchParams ? search : new URLSearchParams(String(search || ''));
  const raw = String(params.get(SCOPE_PARAM) || '').trim().toLowerCase();
  return raw && raw !== 'hq' ? raw : null;
}

/** The page's address for a scope: the bare page for HQ-wide, `?scope=<code>` for a subsidiary. */
export function scopeHref(code, base = '/admin/platform') {
  return code ? `${base}?${SCOPE_PARAM}=${encodeURIComponent(code)}` : base;
}

/** The Worker's states, as the overview's vocabulary names them. */
const STATE_WORD = { healthy: 'Healthy', degraded: 'Degraded', critical: 'Critical', unknown: 'Unknown' };

/** The three signals a subsidiary is read on, in D5786's order. */
export const SCOPED_SIGNAL_KEYS = ['live_health', 'stored_check', 'traffic'];
const SIGNAL_NAME = { live_health: 'Branch health', stored_check: 'Last stored check', traffic: 'Traffic' };

const isReady = (block) => !!block && block.availability === 'ready';

/** A subsidiary's line in the switcher: its code, and what the registry says of it. */
export function scopeOption(s) {
  const notes = [];
  if (s.registry_status) notes.push(s.registry_status);
  else notes.push('not in the registry');
  if (!s.bound) notes.push('not bound');
  return { code: s.code, label: s.code, note: notes.join(' · ') };
}

/**
 * The switcher's list. `null` while reading; `{ available: false, reason }`
 * when the list did not answer, so the switcher still offers HQ-wide and the
 * scope in the address, and says the list is unread rather than empty.
 */
export function scopeOptions(list, UNAVAILABLE) {
  if (list === null || list === undefined) return null;
  if (list === UNAVAILABLE || !Array.isArray(list?.scopes)) {
    return { available: false, reason: 'The list of subsidiaries could not be read.', options: [] };
  }
  return {
    available: true,
    complete: list.registry_available !== false,
    reason: list.registry_available === false ? (list.registry_reason || 'The deployments registry could not be read, so the list may be incomplete.') : null,
    options: list.scopes.filter((s) => s && typeof s.code === 'string').map(scopeOption),
  };
}

/**
 * One subsidiary's health: `{ state, confidence }`. `Reading` while the read
 * is out; Unknown when it failed, when its state is not one the Worker
 * defines, or when no scoped signal answered (whatever the reading claims).
 */
export function scopeHealth(reading, { code, failed = null } = {}) {
  if (reading === null || reading === undefined) {
    if (failed) return { state: 'Unknown', confidence: `Health can't be determined for ${code}: ${failed} Don't treat this as healthy.` };
    return { state: 'Reading', confidence: `Reading ${code}…` };
  }
  const answered = SCOPED_SIGNAL_KEYS.filter((k) => isReady(reading.signals?.[k]));
  const unknown = Array.isArray(reading.unknown) ? reading.unknown : [];
  let state = STATE_WORD[reading.state] || 'Unknown';
  if (answered.length === 0) state = 'Unknown';
  const why = unknown.map((u) => `${String(u.signal || '').toLowerCase()} (${String(u.reason || 'unknown').replace(/\.$/, '')})`).join('; ');
  if (state === 'Unknown') {
    return { state, confidence: `Health can't be determined for ${code}: ${why || 'no signal read for it answered'}. Don't treat this as healthy.` };
  }
  const detected = Array.isArray(reading.detected) ? reading.detected : [];
  const wrong = detected.filter((d) => d.severity !== 'low');
  if (state === 'Healthy') {
    return { state, confidence: `Read for ${code}: ${answered.map((k) => SIGNAL_NAME[k]).join(', ')}. Nothing read is wrong.` };
  }
  const parts = [];
  if (wrong.length) parts.push(`${wrong.map((d) => d.title).join('; ')}.`);
  if (why) parts.push(`Confidence reduced: ${why}.`);
  return { state, confidence: parts.join(' ') || `${code} reads ${state.toLowerCase()}.` };
}

/** A figure, or null with no stand-in. Never `|| 0`. */
const fig = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * The three signal rows. Each: `{ key, name, status, reason, observed, source,
 * facts: [[label, value|null]] }`. A signal that did not answer is Unknown with
 * the read's own reason, and its figures are null (drawn Not recorded).
 */
export function signalRows(reading) {
  if (!reading?.signals) return [];
  const code = reading.scope?.code;
  const stale = (reading.detected || []).some((d) => d.key === `branch_check:${code}`);
  return SCOPED_SIGNAL_KEYS.map((key) => {
    const b = reading.signals[key] || null;
    const base = { key, name: SIGNAL_NAME[key], observed: utcStamp(b?.observed_at), source: b?.source || null };
    if (!isReady(b)) {
      const why = b?.reason || 'This signal did not answer.';
      const facts = key === 'traffic'
        ? [['Requests', null], ['5xx errors', null], ['p95 latency', null]]
        : key === 'live_health' ? [['Database', null], ['Deploy version', null]] : [['Checked', null]];
      return { ...base, status: 'Unknown', availability: b?.availability || 'unavailable', reason: why, facts };
    }
    if (key === 'live_health') {
      return {
        ...base, availability: 'ready', reason: null,
        status: b.db_ok === true ? 'Healthy' : b.db_ok === false ? 'Degraded' : 'Unknown',
        facts: [['Database', b.db_ok === true ? 'Answering' : b.db_ok === false ? 'Failing' : null], ['Deploy version', b.deploy_version || null], ['Licence', b.licence_status || null]],
      };
    }
    if (key === 'stored_check') {
      return {
        ...base, availability: 'ready', reason: null,
        status: b.ok === false ? 'Degraded' : b.ok === true ? (stale ? 'Stale' : 'Healthy') : 'Unknown',
        facts: [['Checked', utcStamp(b.checked_at)], ['Result', b.ok === true ? 'ok' : b.ok === false ? 'not ok' : null]],
      };
    }
    // Traffic is read for whether it answered; no threshold judges it (D5786).
    const minutes = fig(b.window?.window_minutes);
    return {
      ...base, availability: 'ready', reason: null, status: 'Available',
      facts: [
        ['Requests', fig(b.hits)],
        ['5xx errors', fig(b.errors_5xx)],
        ['p95 latency', fig(b.p95_ms) === null ? null : `${fig(b.p95_ms)} ms`],
        ['Window', minutes === null ? null : `${Math.round(minutes / 1440)} days`],
      ],
    };
  });
}

/** The reading's detected incidents as Needs attention items, through the overview's own reader. */
export function scopeAttention(reading) {
  if (!reading) return [];
  const det = detectedIncidents({ health: { state: reading.state, detected: reading.detected, unknown: reading.unknown } });
  return det?.available ? det.items : [];
}

/** The rail's lines for a subsidiary scope: what was read for it, and nothing HQ-wide. */
export function scopeCoverage(reading, code) {
  if (!reading) return [];
  const rows = signalRows(reading);
  const health = scopeHealth(reading, { code });
  return [
    `Scope: subsidiary ${code}, health ${health.state}`,
    ...rows.map((r) => `${r.name}: ${r.availability === 'ready' ? r.status : `not read (${r.reason.replace(/\.$/, '')})`}`),
  ];
}

/** A refused or failed scoped read, in words, from the refusal's code (D258), never its message. */
export function scopeReadFailure(err, code) {
  if (err?.code === 'invalid_scope') return `"${code}" is not a subsidiary code. A scope is a branch code, never HQ.`;
  if (err?.code === 'unknown_scope') return `No subsidiary is deployed or bound under "${code}".`;
  return 'The scoped reading did not answer.';
}
