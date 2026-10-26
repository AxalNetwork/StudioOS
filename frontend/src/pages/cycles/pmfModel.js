/**
 * D1141 (#2433) and D1145 (#3031) — Product-market fit on Fundraising
 * readiness. Pure, so the tests read it without a browser.
 *
 * D1141 put the part on the page before anything computed a score, with
 * model v1 shown (RD4, `INPUTS` below). D1145 draws the score part 3 stores
 * (`parts.pmf` on the module read, D1144) and its history
 * (`GET /api/cycles/raise/pmf/history`):
 *
 *   pmfView      the tile: the number, band, confidence and coverage; "Not
 *                enough recorded" below the floor (no number); Unreadable when
 *                the read failed or never came (never "no score"); and a
 *                partial score when an input could not be read (RD16 B).
 *   inputGroups  the inputs in the canvas's four groups, each row in words.
 *   gapRows      every next step that raises either score, by what it raises.
 *   kitView      the raise kit beside it, from the module's own card.
 *   historyView  the stored points, oldest first, with the pivot marked.
 *
 * NEVER A ZERO FOR A MISSING VALUE: a Not recorded, Not expected yet or
 * unread input draws "—" and says why; only a recorded 0 draws 0.
 */

export const TITLE = 'Product-market fit';
/** D1141's words for a part with nothing computed. D1145 keeps them for the model's legend only. */
export const NOT_YET = 'Not scored yet. No score is computed from Validate yet, so none is shown. This is not a claim that the venture has no fit.';
export const READS = 'It will read only what Validate records: interviews, pains, segments, claims, demand, experiments, the Verdict, and product use once a product is live.';
export const MODEL_VERSION = 'Model v1.0, proposed';

/** The ten inputs of model v1, each with its rule and weight. Weights sum to 100. */
export const INPUTS = [
  { key: 'icp_interviews', name: 'ICP interviews held', rule: '5 points each, full at 20', weight: 10, module: 'customer-research' },
  { key: 'icp_coverage', name: 'ICP coverage', rule: 'share of held interviews with a fit and a segment', weight: 5, module: 'customer-research' },
  { key: 'pain_frequency', name: 'Pain frequency', rule: 'share of ICP interviews naming the top pain, full at 60%', weight: 10, module: 'problem-discovery' },
  { key: 'pain_severity', name: 'Pain severity', rule: 'share judged Severe or Real, full at 70%', weight: 10, module: 'problem-discovery' },
  { key: 'claims_supported', name: 'Claims supported', rule: 'open claims Supported, each by its strongest evidence', weight: 20, module: 'experiments' },
  { key: 'paying_demand', name: 'Paying demand', rule: 'paid deposits, pilots, pre-sales and letters of intent: 1 → 40, 2–4 → 70, 5+ → 100', weight: 15, module: 'demand-signals' },
  { key: 'would_pay', name: 'Would pay', rule: 'confirmed would-pay signals ÷ ICP interviews, full at 40%', weight: 10, module: 'demand-signals' },
  { key: 'waitlist', name: 'Waitlist against the bar', rule: 'sign-ups ÷ the bar you set, capped at 100', weight: 5, module: 'demand-signals' },
  { key: 'experiments', name: 'Experiment outcomes', rule: 'share of done experiments that support', weight: 5, module: 'experiments' },
  { key: 'product_pull', name: 'Product pull', rule: 'activation, week-4 retention and the "very disappointed" share, once a product is live', weight: 10, module: null },
];

export const GRADES = [
  ['Measured', '1.0', 'a recorded session, a connector, the platform\'s waitlist or a verified payment'],
  ['Reviewed', '0.9', 'set by someone other than the founder'],
  ['Sourced', '0.7', 'typed with a file, a link, or a dated record'],
  ['Stated', '0.4', 'typed with no source'],
  ['Not recorded', '0', 'nothing in Validate'],
];

export const BANDS = 'Strong 70 or more · Fair 40–69 · Weak under 40. Below 0.25 confidence it shows "Not enough recorded" and no number.';

/** A Validate module's address, keeping the venture. */
export function validateHref(module, search = '') {
  const m = /[?&](?:project_id|project)=([1-9]\d*)/.exec(String(search || ''));
  return `/validate${module ? `/${module}` : ''}${m ? `?project_id=${m[1]}` : ''}`;
}

/** The readiness page's address, keeping the venture (RD12's door from Validate). */
export function readinessHref(search = '') {
  const m = /[?&](?:project_id|project)=([1-9]\d*)/.exec(String(search || ''));
  return `/raise/fundraising-readiness${m ? `?project_id=${m[1]}` : ''}`;
}

export const totalWeight = () => INPUTS.reduce((s, i) => s + i.weight, 0);

// ---------------------------------------------------------------------------
// D1145: the stored score, drawn
// ---------------------------------------------------------------------------

export const UNREADABLE = 'Product-market fit could not be read. The raise kit below is current.';
export const NOT_ENOUGH = 'Not enough recorded';
export const NOT_ENOUGH_NOTE = 'Too little is recorded in Validate for a number, so none shows. Missing data lowers confidence; it is never a zero.';
export const EMPTY_NOTE = 'Your score fills as you work in Validate. Start with Customer research or record a session.';
export const POINTS_FOOT = 'The points add up to the score. Weights are shared out again over the inputs that apply and are recorded.';
export const MISSING_FOOT = 'Each input fills from its Validate module. Missing data lowers confidence; it is never a zero.';

export const GROUPS = [
  ['who', 'Who you heard from'],
  ['problem', 'The problem'],
  ['claims', 'Claims and experiments'],
  ['demand', 'Demand and pull'],
];

export const GRADE_WORD = { measured: 'Measured', reviewed: 'Reviewed', sourced: 'Sourced', stated: 'Stated', not_recorded: 'Not recorded' };
/** A grade's shade on the bars, as the canvas's legend draws it. */
export const GRADE_SHADE = { measured: 1, reviewed: 0.75, sourced: 0.5, stated: 0.25 };
export const CONF_DOTS = { High: '●●●', Medium: '●●○', Low: '●○○' };

/** Each Validate (or Build) module an input or step opens, by the Worker's slug. */
export const MODULE_LABEL = {
  'customer-research': 'Validate › Customer research',
  record: 'Validate › Record a session',
  'problem-discovery': 'Validate › Problem discovery',
  'ideal-customer-profile': 'Validate › Ideal customer profile',
  experiments: 'Validate › Experiments and evidence',
  'demand-signals': 'Validate › Demand and urgency signals',
  verdict: 'Validate › Verdict',
  'product-roadmap': 'Build › Product roadmap',
};

const ID = /[?&](?:project_id|project)=([1-9]\d*)/;
/** A step's or input's module, keeping the venture (the Worker's `stepHref`, in the app's `?project_id=`). */
export function moduleHref(module, search = '') {
  const m = ID.exec(String(search || ''));
  const q = m ? `?project_id=${m[1]}` : '';
  if (module === 'product-roadmap') return `/build/product-roadmap${q}`;
  return `/validate${module ? `/${module}` : ''}${q}`;
}

/** D1141's rule words for an input, by the Worker's key (`experiment_outcomes` is D1141's `experiments`). */
export function ruleOf(key) {
  const k = key === 'experiment_outcomes' ? 'experiments' : key;
  return INPUTS.find((i) => i.key === k)?.rule ?? null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "21 Oct 2026", or null for anything that is not a day. */
export function dayWord(x) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(x ?? ''));
  if (!m) return null;
  const mo = Number(m[2]);
  return mo >= 1 && mo <= 12 ? `${Number(m[3])} ${MONTHS[mo - 1]} ${m[1]}` : null;
}

const TRIGGER_WORD = { module_read: 'when this page was read', rescore: 'after a re-score' };
const DECISION_WORD = { proceed: 'Proceed', pivot: 'Pivot', stop: 'Stop' };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The Verdict, shown and never scored. */
export function verdictLine(v) {
  if (!v || !v.decision) return 'Verdict: No verdict yet';
  const word = DECISION_WORD[v.decision] || String(v.decision);
  const when = dayWord(v.decided_at);
  return `Verdict: ${word}${v.state === 'given' ? '' : ' · withheld'} · ${plural(Number(v.evidence_count) || 0, 'piece', 'pieces')}${when ? ` · ${when}` : ''}`;
}

/**
 * The tile. `kind` is one of:
 *   'scored'      a number, its band, confidence and coverage;
 *   'not_enough'  below the floor: no number, no band;
 *   'unreadable'  the read failed, or the module read carried no part: never "no score".
 * A scored part with `partial` names the inputs that could not be read.
 */
export function pmfView(part) {
  if (!part || typeof part !== 'object' || part.state === 'unreadable' || !Array.isArray(part.inputs)) {
    return { kind: 'unreadable', line: UNREADABLE };
  }
  const coverage = part.coverage && Number.isFinite(Number(part.coverage.applies))
    ? `${Number(part.coverage.present) || 0} of ${plural(Number(part.coverage.applies), 'input that applies', 'inputs that apply')}`
    : null;
  const unread = part.inputs.filter((i) => i.state === 'unreadable').map((i) => i.label);
  const when = dayWord(part.computed_at);
  const foot = ['From Validate', `Model v${part.model}`, when, part.partial ? 'not stored: an input could not be read' : TRIGGER_WORD[part.trigger]].filter(Boolean).join(' · ');
  const base = { coverage, foot, verdict: verdictLine(part.verdict), partial: Boolean(part.partial), unread, empty: Number(part.coverage?.present) === 0 };
  // `Number(null)` is 0, so a missing value is tested first: it is never drawn as a zero.
  if (part.state === 'scored' && part.value != null && Number.isFinite(Number(part.value))) {
    const word = part.confidence_word;
    return {
      ...base, kind: 'scored', value: Math.round(Number(part.value)), band: part.band || null,
      confidence: word ? `${CONF_DOTS[word] || ''} ${word} confidence`.trim() : null,
      unreadLine: unread.length ? `${unread.join(', ')} could not be read, so the score leaves ${unread.length === 1 ? 'it' : 'them'} out until ${unread.length === 1 ? 'it reads' : 'they read'}.` : null,
    };
  }
  return { ...base, kind: 'not_enough', line: NOT_ENOUGH, note: NOT_ENOUGH_NOTE };
}

/** One input as its row draws it. Its value is a number only when it was recorded. */
export function inputRow(i, search = '') {
  const recorded = i.state === 'recorded' && i.value != null;
  const source = i.source && i.source.table ? `${MODULE_LABEL[i.module] || 'Validate'} · ${plural(Number(i.source.rows) || 0, 'record', 'records')}` : null;
  const status = {
    recorded: GRADE_WORD[i.grade] || 'Recorded',
    not_recorded: 'Not recorded',
    not_expected: 'Not expected yet',
    unreadable: 'Could not be read',
  }[i.state] || 'Not recorded';
  const why = {
    not_recorded: `${i.reason ? `${i.reason} · ` : ''}lowers confidence, not the score`,
    not_expected: 'Out of the coverage count',
    unreadable: 'Left out until it reads · lowers confidence',
  }[i.state] || null;
  return {
    key: i.key, label: i.label, group: i.group, state: i.state, status, why,
    words: i.state === 'unreadable' ? 'Could not be read' : i.words,
    value: recorded ? String(Math.round(Number(i.value))) : '—',
    bar: recorded ? Math.max(0, Math.min(100, Number(i.value))) : null,
    shade: recorded ? GRADE_SHADE[i.grade] ?? 0.25 : null,
    stale: Boolean(i.stale),
    source,
    asOf: recorded ? dayWord(i.as_of) : null,
    weight: recorded && i.contribution != null ? `Weight ${i.weight} · ${Number(i.contribution).toFixed(1)} points` : null,
    beforePivot: Number(i.before_pivot) > 0 ? `${plural(Number(i.before_pivot), 'record', 'records')} before the pivot, not counted` : null,
    href: moduleHref(i.module, search),
    moduleLabel: MODULE_LABEL[i.module] || 'Validate',
    rule: ruleOf(i.key),
    contribution: recorded && i.contribution != null ? Number(i.contribution).toFixed(1) : null,
    weightNumber: i.weight,
    reason: i.reason || null,
  };
}

/** The inputs in the canvas's four groups, in the model's order within each. */
export function inputGroups(part, search = '') {
  const rows = Array.isArray(part?.inputs) ? part.inputs.map((i) => inputRow(i, search)) : [];
  return GROUPS.map(([key, title]) => ({ key, title, rows: rows.filter((r) => r.group === key) })).filter((g) => g.rows.length);
}

/** What one step raises, in the canvas's words ("Up to +6.9", "Confidence Medium → High", "Coverage 8 → 9 of 9"). */
export function gainWords(gain) {
  if (!gain) return [];
  const out = [];
  if (Number(gain.value) > 0) out.push(`Up to +${Number(gain.value)}`);
  if (gain.confidence && gain.confidence.from !== gain.confidence.to) out.push(`Confidence ${gain.confidence.from || 'none'} → ${gain.confidence.to || 'none'}`);
  if (gain.coverage) out.push(`Coverage ${gain.coverage.from} → ${gain.coverage.to} of ${gain.coverage.of}`);
  return out;
}

/**
 * Every next step that raises either score: the engine's steps for
 * Product-market fit, in its order, then each raise kit item's "Missing" from
 * the checklist below. Scope is 'pmf' or 'kit', for the chips.
 */
export function gapRows(part, records, search = '') {
  const pmf = (Array.isArray(part?.steps) ? part.steps : []).map((s) => ({
    scope: 'pmf', scopeLabel: 'Product-market fit', text: s.text, gains: gainWords(s.gain),
    href: moduleHref(s.module, search), moduleLabel: MODULE_LABEL[s.module] || 'Validate',
  }));
  const kit = (Array.isArray(records?.rows) ? records.rows : [])
    .filter((r) => r?.id !== 'pmf' && String(r?.cells?.missing ?? '').trim())
    .map((r) => ({ scope: 'kit', scopeLabel: 'Raise kit', text: String(r.cells.missing).trim(), gains: [], href: null, moduleLabel: r.cells.item || null }));
  return [...pmf, ...kit];
}

/**
 * The raise kit, from the module's own card: its items' newest scores out of
 * 10 (the card's bars, every item, whatever the table below filters). The kit
 * is their mean × 10, as `overallReadiness` computes it; an item no one scored
 * is left out, never counted as 0.
 */
export function kitView(card) {
  if (!card || card.state === 'unreadable') return { kind: 'unreadable', line: 'The raise kit could not be read.' };
  const bars = (Array.isArray(card.series) ? card.series : []).find((x) => x?.kind === 'hbar');
  const items = Array.isArray(bars?.items) ? bars.items : [];
  const scored = items.filter((i) => i.value != null && Number.isFinite(Number(i.value)));
  if (!scored.length) return { kind: 'empty', line: 'Not scored yet', note: `0 of ${plural(items.length || 8, 'item', 'items')} scored` };
  const line = (Array.isArray(card.series) ? card.series : []).find((x) => x?.kind === 'line');
  return {
    kind: 'scored', value: Math.round((scored.reduce((a, i) => a + Number(i.value), 0) / scored.length) * 10),
    note: `${scored.length} of ${plural(items.length, 'item', 'items')} scored`,
    spark: Array.isArray(line?.values) ? line.values.slice(-6) : [],
  };
}

/**
 * The stored points, oldest first. A point below the floor has no value
 * (`value: null`) and is drawn as a gap; the first point after the pivot day
 * carries the pivot mark; a point on another model version than the one
 * before it carries that change.
 */
export function historyView(items, pivotAt = null) {
  const list = Array.isArray(items) ? items : [];
  let pivotMarked = false; let prevModel = null;
  return list.map((p) => {
    const d = String(p.computed_at || '').slice(0, 10);
    const pivot = Boolean(pivotAt && !pivotMarked && d > String(pivotAt).slice(0, 10));
    if (pivot) pivotMarked = true;
    const modelChange = prevModel != null && p.model !== prevModel ? `Model v${p.model}` : null;
    prevModel = p.model;
    const value = p.value == null || !Number.isFinite(Number(p.value)) ? null : Math.round(Number(p.value));
    const cov = p.coverage ? `${p.coverage.present} of ${p.coverage.applies}` : null;
    return {
      id: p.id, day: dayWord(d) || 'Date not recorded', value, band: value == null ? null : p.band,
      label: value == null ? NOT_ENOUGH : String(value),
      confidence: p.confidence_word ? `${p.confidence_word} confidence` : 'Not enough recorded',
      coverage: cov, model: `v${p.model}`, trigger: TRIGGER_WORD[p.trigger] || null,
      pivot, modelChange,
    };
  });
}
