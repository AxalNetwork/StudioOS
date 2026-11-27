/**
 * D1258 (#3281, part 5 of #2428) — the founder's scorecard, Ask to correct,
 * Add review, Your weighting, sharing and the trajectory (SC7–SC12, SC21) as
 * pure rules over part 3's reads (D1256, `/api/venture-scores`).
 *
 * NOTHING HERE COMPUTES A SCORE. Values, bands, confidence and coverage are
 * the Worker's; this turns what it returns into the canvas's words. A scope or
 * an input with no value is "Not enough recorded", "Not expected yet",
 * "Not recorded" or "Could not be read", never 0 and never a neutral 50.
 * No write here sends a value, band, confidence or grade.
 */
import { SCOPES, NOT_ENOUGH, NOT_EXPECTED, NOT_YET, bandOf } from './scorecardModel.js';

export const TRAJECTORY_PATH = '/raise/scorecard/trajectory';
export const ADVISOR_PATH = '/practice/scorecards';
export const advisorHref = (projectId) => (/^[1-9][0-9]{0,15}$/.test(String(projectId ?? '')) ? `${ADVISOR_PATH}/${projectId}` : ADVISOR_PATH);

export const labelOf = (key) => (SCOPES.find((s) => s.key === key) || {}).label || 'Scope';

/** The Worker's Source labels in the canvas's words (PIPE-RAISE's five). */
export const SOURCE_WORD = Object.freeze({ connector: 'Connector', recorded: 'Recorded', signed: 'Signed', document: 'Document', typed: 'Typed' });
export const sourceWord = (s) => SOURCE_WORD[s] || 'Source not recorded';

/** "5 of 6 inputs" from `{ present, applies }`; a stored coverage share has no count, so it says nothing. */
export function coverageText(c) {
  if (c && typeof c === 'object' && Number.isFinite(Number(c.applies)) && Number(c.applies) > 0) {
    return `${Number(c.present) || 0} of ${Number(c.applies)} inputs`;
  }
  return null;
}

/** The state a scope reads as when it has no value. */
export function stateWord(state) {
  if (state === 'not_expected') return NOT_EXPECTED;
  if (state === 'unreadable') return 'Could not be read';
  if (state === 'not_read') return NOT_YET;
  return NOT_ENOUGH;
}

/** A review beside the computed value, which stays (D1256 §3). */
export function reviewLine(review) {
  if (!review) return null;
  const by = review.reviewer || 'A reviewer';
  if (review.adjustment) {
    const sign = review.adjustment > 0 ? '+' : '−';
    const after = review.reviewed_value != null ? ` · after review ${Math.round(review.reviewed_value)}` : '';
    const comp = review.computed_value != null ? `Computed ${Math.round(review.computed_value)}${after} · ` : '';
    return { kind: 'adjustment', current: review.current !== false, text: `${comp}${sign}${Math.abs(review.adjustment)} by ${by}: ${review.reason || 'Reason not recorded'}` };
  }
  return { kind: 'note', current: review.current !== false, text: `Note by ${by}: ${review.note || 'Note not recorded'}` };
}

/** One scope row as the founder's, staff's or a shared advisor's list draws it. */
export function scopeRow(s) {
  const scored = s?.state === 'scored' && s.value != null && Number.isFinite(Number(s.value));
  return {
    key: s?.scope,
    label: s?.label || labelOf(s?.scope),
    scored,
    value: scored ? Math.round(Number(s.value)) : null,
    band: scored ? (bandOf(s.value, s.scope) || null) : null,
    confidence: scored ? (s.confidence_word || null) : null,
    state: scored ? null : stateWord(s?.state),
    reason: s?.reason || null,
    coverage: coverageText(s?.coverage),
    model: s?.model || null,
    review: reviewLine(s?.review),
    inputs: Array.isArray(s?.inputs) ? s.inputs.map(inputRow) : [],
  };
}

/** One input: its value as the Worker words it, its source and grade, or why it is missing. */
export function inputRow(i) {
  const recorded = i?.state === 'recorded' || (i?.value != null && i?.state == null);
  return {
    key: i?.key,
    label: i?.label || i?.key || 'Input',
    recorded,
    words: recorded ? (i.words || (i.value != null ? `${Math.round(Number(i.value))} of 100` : 'Recorded')) : null,
    missing: recorded ? null : i?.state === 'not_applicable' ? 'Does not apply yet' : (i?.reason || 'Not recorded'),
    source: i?.source ? sourceWord(i.source) : null,
    grade: i?.grade || null,
    stale: Boolean(i?.stale),
    personal: Boolean(i?.personal),
    asOf: i?.as_of || null,
    weight: Number.isFinite(Number(i?.weight)) ? Number(i.weight) : null,
  };
}

/** The open correction on one input, if any: one may be open at a time (D1256 §3). */
export function openCorrection(corrections, scope, inputKey) {
  return (corrections || []).find((c) => c.scope === scope && c.input_key === inputKey && c.state === 'open') || null;
}

export const MESSAGE_MIN = 10;
export const MESSAGE_MAX = 2000;
export function messageProblem(m) {
  const n = String(m || '').trim().length;
  if (n < MESSAGE_MIN) return `Say what is wrong in at least ${MESSAGE_MIN} characters.`;
  if (n > MESSAGE_MAX) return `Keep it to ${MESSAGE_MAX} characters.`;
  return null;
}

// ── Add review (SC10) ────────────────────────────────────────────────────────

export const REVIEW_CAP = 15;
/** What stops Save review, or null. The Worker refuses the same; it never clamps. */
export function reviewProblem({ kind, adjustment, reason, note }, scored) {
  if (kind === 'adjust') {
    const a = Number(adjustment);
    if (!scored) return 'An unscored scope takes a note, not an adjustment.';
    if (!Number.isInteger(a) || a === 0) return 'Choose an adjustment other than 0.';
    if (Math.abs(a) > REVIEW_CAP) return `An adjustment is at most ${REVIEW_CAP} points either way.`;
    if (String(reason || '').trim().length < MESSAGE_MIN) return `Give a reason of at least ${MESSAGE_MIN} characters. The founder reads it.`;
    return null;
  }
  if (!String(note || '').trim()) return 'Write the note.';
  return null;
}
/** The body Save review sends: a note, or an adjustment with its reason. Never a value. */
export function reviewBody({ kind, adjustment, reason, note }) {
  return kind === 'adjust'
    ? { adjustment: Number(adjustment), reason: String(reason).trim(), note: null }
    : { adjustment: 0, reason: null, note: String(note).trim() };
}
/** "Shown as: computed 51 · after review 57", the Worker's own clamp to 0–100. */
export function reviewPreview(computed, adjustment) {
  if (computed == null || !Number(adjustment)) return null;
  const after = Math.max(0, Math.min(100, Math.round(Number(computed)) + Number(adjustment)));
  return `Shown as: computed ${Math.round(Number(computed))} · after review ${after}, with your reason.`;
}

// ── Your weighting (SC7) ─────────────────────────────────────────────────────

export const WEIGHT_MAX = 5;
export const equalWeights = () => Object.fromEntries(SCOPES.map((s) => [s.key, 1]));
/** The weights as the dialog edits them: the saved ones, or equal. */
export const weightsOf = (read) => ({ ...equalWeights(), ...(read?.weights || {}) });
export function weightsProblem(w) {
  for (const s of SCOPES) {
    const n = Number(w?.[s.key]);
    if (!Number.isInteger(n) || n < 0 || n > WEIGHT_MAX) return `Each weight is a whole number from 0 to ${WEIGHT_MAX}.`;
  }
  if (SCOPES.every((s) => Number(w[s.key]) === 0)) return 'Leave at least one scope above 0, or reset to equal.';
  return null;
}
/** True when every scope carries the same weight: the sort is equal, as with no weighting saved. */
export const isEqual = (w) => SCOPES.every((s) => Number(w?.[s.key]) === Number(w?.[SCOPES[0].key]));

// ── Sharing ──────────────────────────────────────────────────────────────────

/** What a sharing change does, said before it is made. */
export function sharingChange(current, next, candidates = []) {
  const name = (id) => (candidates.find((c) => c.user_id === id) || current.advisors?.find((a) => a.user_id === id) || {}).name || 'An advisor';
  const lines = [];
  if (next.investors !== undefined && next.investors !== current.investors?.on) {
    lines.push(next.investors
      ? 'Investors in your deal flow gain access: every scope, band and confidence, and values and inputs once they sign an NDA with you. Personal and team-only inputs show as a band.'
      : 'Investors in your deal flow lose access. They see a locked scorecard with your reason.');
  }
  if (next.advisors !== undefined) {
    const was = (current.advisors || []).map((a) => a.user_id);
    for (const id of next.advisors.filter((x) => !was.includes(x))) lines.push(`${name(id)} gains read-only access: bands, values and confidence. Inputs stay hidden. They are told.`);
    for (const id of was.filter((x) => !next.advisors.includes(x))) lines.push(`${name(id)} loses access.`);
  }
  return lines;
}

// ── What investors see ───────────────────────────────────────────────────────

const RISK_WORD = Object.freeze({ Strong: 'Low risk', Fair: 'Medium risk', Weak: 'High risk' });
/** The Worker's band in the canvas's words; Risk reads as a risk word on the same cut-offs. */
export const bandWord = (band, scope) => (band ? (scope === 'risk' ? RISK_WORD[band] || null : band) : null);

/** One scope as an investor reads it: before the NDA only the band and confidence word. */
export function previewRow(s) {
  const scored = s?.state === 'scored';
  return {
    key: s?.scope,
    label: s?.label || labelOf(s?.scope),
    band: scored ? bandWord(s.band, s.scope) : null,
    confidence: scored ? s.confidence_word || null : null,
    state: scored ? null : stateWord(s?.state),
    value: !s?.masked && scored && s.value != null ? Math.round(Number(s.value)) : null,
    masked: Boolean(s?.masked),
    inputs: Array.isArray(s?.inputs) ? s.inputs.map((i) => (i.personal ? { key: i.key, label: i.label, hidden: i.note || 'Counted, not shown' } : inputRow(i))) : [],
    review: s?.review ? reviewLine({ ...s.review, current: true }) : null,
  };
}

// ── Trajectory (SC12) ────────────────────────────────────────────────────────

const dayOf = (at) => String(at || '').slice(0, 10);
export const dayWord = (at) => {
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(String(at)) ? at : `${String(at).replace(' ', 'T')}Z`);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : null;
};

/**
 * The chart's lines: one per scope with any scored point, in scope order. A
 * point with no value is a gap (`null`), never 0. Model markers are where a
 * version was first used after the first.
 */
export function trajectoryOf(read) {
  if (!read || !Array.isArray(read.scopes)) return null;
  const days = [...new Set(read.scopes.flatMap((s) => s.points.map((p) => dayOf(p.at))))].filter(Boolean).sort();
  const lines = read.scopes
    .filter((s) => s.points.some((p) => p.value != null))
    .map((s) => {
      const byDay = new Map();
      for (const p of s.points) byDay.set(dayOf(p.at), p.value == null ? null : Number(p.value));
      let last;
      const values = days.map((d) => { if (byDay.has(d)) last = byDay.get(d); return last === undefined ? null : last; });
      const latest = [...s.points].reverse().find((p) => p.value != null) || null;
      return { key: s.scope, label: s.label || labelOf(s.scope), values, latest: latest ? Math.round(latest.value) : null, latestModel: latest?.model || null };
    });
  const markers = (read.models || []).slice(1).map((m) => ({ version: m.version, day: dayOf(m.first_at), index: days.indexOf(dayOf(m.first_at)) })).filter((m) => m.index >= 0);
  return { days, lines, markers, empty: !lines.length };
}

/** The table behind the chart (View as table): each scope's points, a gap said in words. */
export function trajectoryRows(read) {
  return (read?.scopes || []).flatMap((s) => s.points.map((p) => ({
    scope: s.label || labelOf(s.scope), day: dayWord(p.at) || 'Not recorded', model: p.model || 'Not recorded',
    value: p.value == null ? stateWord(p.state) : String(Math.round(Number(p.value))),
    band: p.value == null ? '—' : bandOf(p.value, s.scope) || '—', confidence: p.confidence_word || '—',
  })));
}
