// D703 (#1665) — each cycle's phone root (One Next Thing), for Validate,
// Build, Raise and Grow, to `Cycle Overviews · Mobile.dc.html` (COM) over
// `Cycle Overview.dc.html` (CO:26-27, CO:278-282). It began as D685 §5.12's
// Validate-only focus (#1589).
//
// THE WORKER'S FIRST. Each cycle's overview read returns `focus`, `meter` and
// `index` (#1701's decision 1; Validate's since #1609) beside its figures and
// cards. A part is null when the Worker could not read it, and only then does
// this fall back, to what the same read's figures and cards say:
//   · the focus: Validate's rule 1 (the Customer research card read empty),
//     else the first card's `next`, under "<Cycle> · Next";
//   · the meter: Validate's alone, the interviews figure's count with "No
//     target set"; any other cycle with no `display` reads Not recorded;
//   · the index: one row per card in the read, each "Unreadable", linking its
//     module page. A module the Worker hides stays hidden: the browser never
//     adds a row. Any `index` that is not an array reads as none sent (#1701's
//     PR 1b sends Validate's as rows; the `{ interviews_total, booked }` object
//     it replaced, and the rows the browser built from it, are gone).
// Every fallback reads the RAW overview: adapting a card replaces its series
// with chart specs. A missing value reads "Not recorded", never 0, and the
// browser never formats money.

import { safeHref } from './cycleModel.js';

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const sentence = (t) => { const s = String(t || '').trim(); return !s ? '' : /[.!?]$/.test(s) ? s : `${s}.`; };

/** The canvas's words for a venture with no interview yet (`mobData.focus.new`). */
export const FIRST_FOCUS = {
  eyebrow: 'Validate · Next',
  headline: 'Record your first conversation.',
  why: 'Validate starts with one interview. Everything else in the venture builds on what it finds.',
  cta: 'Record a session',
  then: 'Write the claim you most need to be true.',
};

const figure = (raw, key) => (Array.isArray(raw?.figures) ? raw.figures : []).find((f) => f?.key === key) || null;
const card = (raw, slug) => (Array.isArray(raw?.cards) ? raw.cards : []).find((c) => c?.slug === slug) || null;

export const CYCLE_NAMES = { validate: 'Validate', build: 'Build', raise: 'Raise', grow: 'Grow' };
const nameOf = (cycle) => CYCLE_NAMES[cycle] || 'Validate';

/**
 * The cycle's own action route a root CTA may name (decision 2): opened
 * through `openAction` on a plain tap, so Back from it is one step. Grow's
 * root never opens Share an update (S1's ruling), so Grow has none here.
 */
export const ROOT_ACTION_PATHS = { validate: 'record', build: 'connect', raise: 'call' };

/** The focus: the Worker's when it has a headline and an in-app CTA, else rule 1 (Validate), else the first card's next. */
export function phoneFocus(raw, search = '', cycle = 'validate') {
  const f = raw?.focus;
  const href = safeHref(f?.cta?.href);
  if (f && typeof f === 'object' && f.headline && href) {
    return { eyebrow: f.eyebrow || `${nameOf(cycle)} · Next`, headline: f.headline, why: f.why || null, cta: f.cta.text || f.cta.label || 'Open', href, then: f.then || null };
  }
  if (cycle === 'validate') {
    const research = card(raw, 'customer-research');
    if (research?.state === 'empty') return { ...FIRST_FOCUS, href: `/validate/record${search}` };
  }
  const first = (Array.isArray(raw?.cards) ? raw.cards : []).find((c) => c?.next?.text && safeHref(c.next.href));
  if (!first) return null;
  return { eyebrow: `${nameOf(cycle)} · Next`, headline: sentence(first.next.text), why: first.reason || null, cta: `Open ${first.name || 'the module'}`, href: first.next.href, then: null };
}

/** "Then" once (decision 3): a leading "Then " is stripped and the first letter upper-cased. */
export function thenText(text) {
  const t = String(text ?? '').trim().replace(/^then\s*:?\s+/i, '');
  return t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}` : null;
}

/**
 * The meter, drawn as the Worker sends it: its `label` and `display` ("14 of
 * 20", "$900k of $1.5M"), then "· <target_reason>" with no target, and a bar
 * at count / target when both are numbers and the target is above zero.
 * Validate alone falls back: the interviews figure's count, "<count> of
 * <target>" or "<count>", and "No target set". Another cycle with no meter
 * draws none (null); one with no `display` reads Not recorded.
 */
export function phoneMeter(raw, cycle = 'validate') {
  const m = raw?.meter && typeof raw.meter === 'object' ? raw.meter : null;
  const target = num(m?.target) && m.target > 0 ? m.target : null;
  if (cycle !== 'validate') {
    if (!m) return null;
    const count = num(m.count) ? m.count : null;
    return {
      label: m.label || 'Not recorded',
      count,
      target,
      pct: count != null && target != null ? Math.max(0, Math.min(100, Math.round((100 * count) / target))) : null,
      unreadable: false,
      display: typeof m.display === 'string' && m.display ? m.display : null,
      target_reason: target == null && m.target_reason ? m.target_reason : null,
    };
  }
  const fig = figure(raw, 'interviews_this_month');
  // The Worker's count first: it reads none logged as 0, a fact it counted.
  const count = num(m?.count) ? m.count : num(fig?.value) ? fig.value : null;
  const display = typeof m?.display === 'string' && m.display ? m.display
    : count == null ? null : target != null ? `${count} of ${target}` : `${count}`;
  return {
    label: m?.label || 'Interviews this month',
    count,
    target,
    pct: count != null && target != null ? Math.max(0, Math.min(100, Math.round((100 * count) / target))) : null,
    unreadable: count == null && fig?.state === 'unreadable',
    display,
    target_reason: target == null ? (m?.target_reason || 'No target set') : null,
  };
}

/**
 * "Everything else in <Cycle>": the Worker's rows as sent, each href in-app
 * only. `value: null` draws Not recorded, `''` nothing, any other string
 * (`"Unreadable"` included) is the value. A null index falls back to one
 * "Unreadable" row per card in the read.
 */
export function phoneIndex(raw, search = '', cycle = 'validate') {
  const index = raw?.index;
  if (Array.isArray(index)) {
    return index.filter((r) => r && r.key && r.title).map((r) => ({
      key: String(r.key), title: String(r.title), detail: r.detail == null ? '' : String(r.detail),
      value: r.value == null ? null : String(r.value), href: safeHref(r.href),
    }));
  }
  return (Array.isArray(raw?.cards) ? raw.cards : []).filter((c) => c?.slug && /^[a-z0-9-]+$/.test(c.slug)).map((c) => ({
    key: c.slug, title: c.name || c.slug, detail: c.caption || '', value: 'Unreadable', href: `/${cycle}/${c.slug}${search}`,
  }));
}

/** The target form's value as the Worker takes it: a positive whole number, null to clear, or a sentence. */
export function targetValue(text) {
  const t = String(text ?? '').trim();
  if (!t) return { value: null };
  const n = Number(t);
  if (!Number.isInteger(n) || n <= 0) return { error: 'Enter a whole number of interviews a month, above zero.' };
  return { value: n };
}

// ---------------------------------------------------------------------------
// D757 §2.6–§2.7 (#1928) — "From your interviews" and the Verdict line, as
// pure rules the desktop section and the phone group both draw.
// ---------------------------------------------------------------------------

/** The panel's empty state. */
export const NO_SUGGESTIONS = 'No suggestions from your interviews yet.';
/** At most this many ids go in one Accept all call (#1925's route). */
export const ACCEPT_ALL_MAX = 50;

/** A transcript time as "00:12:31", or null when it is not a time. */
export function hms(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return null;
  const t = Math.floor(ms / 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(t / 3600))}:${p(Math.floor((t % 3600) / 60))}:${p(t % 60)}`;
}

/** "Heard in <name> · 00:12:31 · <speaker>", leaving out what was not recorded. */
export function heardLine(s) {
  return ['Heard in ' + (s?.interviewee || 'an interview'), hms(s?.cite_from), s?.speaker || null].filter(Boolean).join(' · ');
}

/**
 * The panel's state from the module read's `parts` (#1925): `hidden` for a
 * reader (the read sends no `suggestions` key), `unreadable` (null), `none`,
 * or `some` with the rows.
 */
export function suggestionsView(parts) {
  if (!parts || parts.can_write !== true || !Object.hasOwn(parts, 'suggestions')) return { state: 'hidden', rows: [] };
  if (!Array.isArray(parts.suggestions)) return { state: 'unreadable', rows: [] };
  const rows = parts.suggestions.filter((s) => s && Number.isInteger(s.id));
  return { state: rows.length ? 'some' : 'none', rows };
}

/**
 * Accept all, as #1925's route takes it: per session, at most 50 ids a call.
 * A suggestion with no session is accepted on its own (`sessionId: null`).
 */
export function acceptAllBatches(rows) {
  const bySession = new Map();
  const single = [];
  for (const s of rows || []) {
    if (!Number.isInteger(s?.id)) continue;
    if (Number.isInteger(s.session_id)) {
      if (!bySession.has(s.session_id)) bySession.set(s.session_id, []);
      bySession.get(s.session_id).push(s.id);
    } else single.push({ sessionId: null, ids: [s.id] });
  }
  const batches = [];
  for (const [sessionId, ids] of bySession) {
    for (let i = 0; i < ids.length; i += ACCEPT_ALL_MAX) batches.push({ sessionId, ids: ids.slice(i, i + ACCEPT_ALL_MAX) });
  }
  return [...batches, ...single];
}

/**
 * The Verdict card's interview line (§2.6), for writers only: partners and
 * other readers never see it. Null when the Worker sent none or could not
 * read it.
 */
export function verdictInterviewLine(data) {
  if (data?.parts?.can_write !== true) return null;
  const line = data?.card?.interview_evidence;
  return line && typeof line.text === 'string' && line.text ? line.text : null;
}

// A finding kind's words, as the Worker's `findingLine`
// (`cloudflare-worker/src/services/interviewFindings.ts`) writes them; the
// test reads that function back so the two cannot drift. A suggestion has no
// text of its own: the module read sends its payload.
const ATTRIBUTE_WORD = { role: 'Role', company: 'Company', company_size: 'Company size', industry: 'Industry', geography: 'Geography', stage: 'Stage', tools: 'Tools' };
const KIND_WORD = { workaround: 'Workaround', status_quo: 'Status quo', in_house: 'Built in-house' };
const FOLLOW_UP_WORD = { follow_up: 'Follow-up', intro_offer: 'Intro offered', beta_signup: 'Beta sign-up' };
const capital = (s) => (s ? `${s[0].toUpperCase()}${s.slice(1).replace(/_/g, ' ')}` : s);
const posInt = (v) => (Number.isInteger(v) && v > 0 ? v : null);

/** "1,200 USD / month", or null when the finding names no amount (the Worker's `amountWord`). */
export function amountWord(p) {
  const cents = posInt(p?.amount_cents);
  if (!cents) return null;
  const period = p.period === 'month' ? ' / month' : p.period === 'year' ? ' / year' : '';
  return `${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${String(p.currency || 'usd').toUpperCase()}${period}`;
}

/** `{ what, detail }` for a finding kind, or null for any other kind. */
export function findingLine(kind, p = {}) {
  switch (kind) {
    case 'firmographic': return { what: ATTRIBUTE_WORD[String(p.attribute)] ?? 'Firmographic', detail: String(p.value ?? '') };
    case 'job_to_be_done': return { what: 'Job to be done', detail: String(p.job ?? '') };
    case 'market_fact': return { what: `Market fact · ${capital(String(p.topic ?? 'other'))}`, detail: String(p.fact ?? '') };
    case 'alternative': return { what: `Alternative · ${KIND_WORD[String(p.kind)] ?? 'Other'}`, detail: String(p.name ?? '') };
    case 'budget': return { what: 'Budget', detail: [p.detail, amountWord(p)].filter(Boolean).join(' · ') };
    case 'timing': return { what: 'Timing', detail: String(p.when ?? '') };
    case 'urgency': return { what: `Urgency · ${capital(String(p.level ?? ''))}`, detail: String(p.reason ?? '') };
    case 'buying_trigger': return { what: 'Buying trigger', detail: String(p.trigger ?? '') };
    case 'objection': return { what: `Objection · ${capital(String(p.about ?? 'other'))}`, detail: String(p.detail ?? '') };
    case 'follow_up': return { what: FOLLOW_UP_WORD[String(p.kind)] ?? 'Follow-up', detail: [p.detail, p.due_hint].filter(Boolean).join(' · ') };
    case 'prototype_ask': return { what: 'Prototype ask', detail: [p.feature, p.workflow].filter(Boolean).join(' · ') };
    default: return null;
  }
}

/**
 * A suggestion in one line: a finding kind's words, a new hypothesis or an
 * experiment idea; null for the older placement kinds, which the panel draws
 * with Interview review's `placementText`.
 */
export function suggestionLine(s) {
  const p = s?.payload && typeof s.payload === 'object' ? s.payload : {};
  if (s?.kind === 'hypothesis_new') return `New hypothesis · ${p.claim ?? ''}${p.disproof ? ` · disproved by: ${p.disproof}` : ''}`;
  if (s?.kind === 'experiment_idea') return `Experiment · ${p.title ?? ''}${p.method ? ` · ${p.method}` : ''}`;
  const f = findingLine(s?.kind, p);
  return f ? (f.detail ? `${f.what} · ${f.detail}` : f.what) : null;
}

/**
 * Accept all, batch by batch (`acceptAllBatches`): a session's ids through
 * #1925's route, a suggestion with no session through its own Accept.
 * `sessions` is `interviewSessionsApi`. Resolves to how many were not accepted.
 */
export async function acceptSuggestions(batches, sessions) {
  let failed = 0;
  for (const b of batches || []) {
    if (b.sessionId == null) {
      for (const id of b.ids) { try { await sessions.accept(id); } catch { failed += 1; } }
    } else {
      const out = await sessions.acceptAll(b.sessionId, b.ids);
      failed += (Array.isArray(out?.results) ? out.results : []).filter((r) => r?.ok !== true).length;
    }
  }
  return failed;
}
