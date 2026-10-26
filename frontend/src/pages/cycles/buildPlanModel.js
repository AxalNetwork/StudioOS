/**
 * D1063 (#2426) — Validate → Build's plan and progress as pure rules: the
 * addresses, the tabs, the Validate cards "What Validate proved" draws, and
 * what each Build module's section says before the planner exists. No React
 * here, so `node --test` loads it alone.
 *
 * The one read (D1063 §2) is `GET /api/cycles/validate/overview`: its cards
 * for Problem discovery, Ideal customer profile, Demand and Experiments, as
 * the Worker sends them. No plan, proposal, handoff or evidence link is
 * stored yet (`build_plans` and its tables are part 1's), so no proposal and
 * no progress stage is drawn, and none is counted as zero.
 */

export const TITLE = 'Plan the build';
export const LINE = 'What Validate proved, turned into what to build. Nothing lands until you accept it.';
export const NOT_YET = 'Not read here yet';
export const FOUNDING_TEAM_LINE = 'Founding team takes no proposals. Equity and roles are yours to record.';
export const DOOR_LINE = 'Plan the build from what Validate proved.';

export const PLAN_TABS = [
  { id: 'plan', label: 'Plan', path: '/build/plan' },
  { id: 'progress', label: 'Progress', path: '/build/plan/progress' },
];

/**
 * Only `?project_id=` and the plan's `scope` ride on a plan tab, so the chosen
 * venture (and a one-claim plan, D1067 §1) is kept and nothing else.
 */
export function planSearch(search = '') {
  const q = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  const id = q.get('project_id');
  if (!id || !/^\d+$/.test(id)) return '';
  const scope = planScope(search);
  return `?project_id=${id}${scope === 'venture' ? '' : `&scope=${scope}`}`;
}

/** The venture alone, for a link that leaves the plan (a module, Validate, Build's overview). */
export const ventureSearch = (search = '') => planSearch(search).replace(/&scope=[^&]*/, '');

/** The plan's scope from the address: the venture, or one claim `h-<id>` (D1065). */
export function planScope(search = '') {
  const s = new URLSearchParams(String(search || '').replace(/^\?/, '')).get('scope');
  return s && /^h-[1-9][0-9]{0,9}$/.test(s) ? s : 'venture';
}

export const planHref = (tab, search = '') => `${(PLAN_TABS.find((t) => t.id === tab) || PLAN_TABS[0]).path}${planSearch(search)}`;

/** "What Validate proved": the four Validate cards the plan rests on, in the canvas's order. */
export const PROVED = ['problem-discovery', 'experiments', 'ideal-customer-profile', 'demand-signals'];

/** The Validate overview's cards for `PROVED`, in that order; a card the read did not send is left out. */
export function provedCards(overview) {
  const cards = Array.isArray(overview?.cards) ? overview.cards : [];
  return PROVED.map((slug) => cards.find((c) => c?.slug === slug)).filter(Boolean);
}

/**
 * The plan's sections, one per Build module that takes proposals, in the
 * module order, with what the planner (part 1's rules) would propose there.
 * Founding team takes none, by rule.
 */
export const SECTIONS = [
  { slug: 'solution-design', name: 'Solution design', kinds: 'the brief, features from severe or real pain themes, risks from objections' },
  { slug: 'prototype-mvp', name: 'Prototype / MVP', kinds: 'must-haves from supported hypotheses, prototype tests for untested ones' },
  { slug: 'product-roadmap', name: 'Product roadmap', kinds: 'Now, Next and Later items, and your Verdict’s commitments' },
  { slug: 'company-creation', name: 'Company creation', kinds: '"Incorporate" and "Assign the IP" when no company is linked' },
  { slug: 'operating-systems', name: 'Operating systems', kinds: 'doors to connect GitHub, Vercel and PostHog' },
];

export const PROGRESS_WAIT = 'Each accepted item’s stages (Accepted, Sent, In progress, Built, Live, Tested) are read from the plan and your tools’ feeds (parts 1 and 4). Until then no stage is drawn, so nothing here reads as not done.';

/**
 * D1071 (#2941, part 8) — VB5, "Word with Eadwyn". The rules decide which
 * items exist; Eadwyn words them. Its wording is drawn in lavender beside the
 * rule's plain title, and nothing is saved until "Keep wording", which is the
 * item's Save (D1066's PATCH with the wording's id). The run is metered and
 * only ever starts from the press; in Manual mode the Worker refuses it.
 */
export const WORD_OPTION = 'draft:build/plan';
export const WORD_LABEL = 'Word with Eadwyn';
export const WORD_LINE = 'Eadwyn words the plan from your accepted evidence. You keep what you want.';
export const WORD_READS = 'Only what you accepted in Validate.';
export const WORD_COST = 'Taken from your AI tokens when you press Word with Eadwyn.';
export const WORDING_TAG = 'Eadwyn’s wording · not saved';
export const KEEP = 'Keep wording';
export const DISCARD = 'Discard wording';
export const NO_PLAN = 'No plan is prepared yet. The planner’s rules prepare it from what you accepted in Validate; Eadwyn words what they propose.';
export const NOTHING_PENDING = 'No item is waiting for your decision, so there is nothing to word.';
export const AI_OFF_LINE = 'AI assistance is off on this page. The rule’s titles stand, and you can still edit them.';
export const AI_OFF_SUB = 'Turn it back on from the Eadwyn rail.';
export const TOKENS_SUB = 'Runs use your plan’s AI allowance first, then your AI tokens. Nothing was charged.';

/** The kinds Eadwyn words (a door to connect a tool takes no wording). */
export const WORDED_KINDS = ['feature', 'must-have', 'prototype-test', 'risk', 'roadmap', 'formation-step'];

/** The plan's pending items, in module order, each with its rule's title and any wording not yet decided. */
export function wordingRows(plan, wording) {
  const modules = plan?.modules || {};
  const words = wording?.items || {};
  return SECTIONS.flatMap((s) => (modules[s.slug] || [])
    .filter((i) => i?.status === 'proposed' && WORDED_KINDS.includes(i.kind))
    .map((i) => ({ uid: i.uid, module: s.name, kind: i.kind, title: String(i.payload?.title ?? ''), words: words[i.uid] || null })));
}

const TOKEN_CODES = new Set(['budget_user_day', 'budget_user_month', 'budget_org_month', 'spend_limit', 'insufficient_tokens']);

/** A refused press, in the page's words: out of tokens, Manual mode, or what the Worker said. */
export function wordRefusal(e) {
  const code = e?.code || e?.data?.code || e?.data?.error || null;
  const said = String(e?.data?.detail || e?.data?.message || e?.message || '').trim();
  const sentence = said && !/^[a-z_]+$/.test(said) ? said : '';
  if (Number(e?.status) === 402 || TOKEN_CODES.has(code)) return { kind: 'tokens', text: sentence || 'Not enough AI tokens for this run.', sub: TOKENS_SUB };
  if (code === 'assist_off') return { kind: 'off', text: AI_OFF_LINE, sub: AI_OFF_SUB };
  return { kind: 'other', text: sentence || 'Eadwyn could not word the plan just now. Nothing was charged. Try again.', sub: null };
}

// ─────────────────────────────────────────── D1069 (#2939): the plan complete

/** A proposal's kind, as its card's pill says it (VB1). */
export const KIND_WORD = {
  feature: 'Feature', 'must-have': 'Must-have', 'prototype-test': 'Prototype test', risk: 'Risk',
  roadmap: 'Roadmap item', 'formation-step': 'Formation step', 'connect-door': 'Connect',
};

/** Where an accepted item lands, as D1066 §1 writes it. A door lands nothing. */
export function landsIn(item) {
  const p = item?.payload || {};
  switch (item?.kind) {
    case 'feature': return 'Solution design › Features';
    case 'risk': return 'Solution design › Risks';
    case 'must-have': return 'Prototype / MVP › Must-haves';
    case 'prototype-test': return 'Prototype / MVP › Tests';
    // A commitment carries no lane; D1066 lands it in Next.
    case 'roadmap': return `Product roadmap › ${['Now', 'Next', 'Later'].includes(p.lane) ? p.lane : 'Next'}`;
    case 'formation-step': return 'Company creation › Formation';
    default: return null;
  }
}

const EVIDENCE_KIND = {
  pain_group: 'Problem discovery', hypothesis: 'Hypothesis', experiment: 'Experiment', signal: 'Demand',
  finding: 'Customer research', feature: 'Feature', commitment: 'Your commitment', decision: 'Verdict',
};
const SIGNAL_WORD = { loi: 'LOI', would_pay: 'Would pay', pre_sale: 'Pre-sale' };

/** One "Because" chip: the source word, the module it came from, and its label (VB1). */
export function evidenceChip(e) {
  const source = ['Recorded', 'Typed', 'Document'].includes(e?.source_label) ? e.source_label : 'Typed';
  const label = e?.kind === 'signal' ? SIGNAL_WORD[e.label] || String(e?.label ?? '') : String(e?.label ?? '');
  return { source, text: [EVIDENCE_KIND[e?.kind] || 'Evidence', label].filter(Boolean).join(' · ') };
}

/** The "Because" chips of an item, signals counted into one chip so a test does not list ten LOIs. */
export function becauseChips(item) {
  const ev = Array.isArray(item?.evidence) ? item.evidence : [];
  const signals = ev.filter((e) => e?.kind === 'signal');
  const chips = ev.filter((e) => e?.kind !== 'signal').map(evidenceChip);
  if (signals.length) chips.push({ source: signals.every((s) => s.source_label === 'Document') ? 'Document' : 'Recorded', text: `Demand · ${signals.length} confirmed ${signals.length === 1 ? 'signal' : 'signals'}` });
  return chips;
}

/** The item's status pill (VB3). Discarded reads Dismissed, the word the button used. */
export const STATUS_WORD = {
  proposed: '○ Proposed', accepted: '✓ Accepted', edited: '✎ Edited and accepted', withdrawn: '↺ Withdrawn', discarded: '– Dismissed',
};
export const isDecided = (i) => i?.status === 'accepted' || i?.status === 'edited';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "12 Oct" from a SQLite or ISO stamp, in UTC; null when there is none to read. */
export function dayMon(raw) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw ?? ''));
  return m && MONTHS[Number(m[2]) - 1] ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : null;
}
/** "12 Oct, 14:05" in UTC; null when there is no stamp. */
export function dayTime(raw) {
  const d = dayMon(raw);
  const t = /[ T](\d{2}):(\d{2})/.exec(String(raw ?? ''));
  return d ? (t ? `${d}, ${t[1]}:${t[2]} UTC` : d) : null;
}

/** An accepted (or dismissed) item's one line: when, and where it landed (VB1, VB3). */
export function decidedLine(item) {
  const when = dayMon(item?.decided_at);
  if (item?.status === 'discarded') return `Dismissed${when ? ` ${when}` : ''} · it will not be proposed again`;
  const where = item?.kind === 'connect-door' ? 'Operating systems' : landsIn(item);
  return [when ? `Accepted ${when}` : 'Accepted', where].filter(Boolean).join(' · ');
}

/** Every item of the plan, in module order. */
const allItems = (plan) => SECTIONS.flatMap((s) => (plan?.modules?.[s.slug] || []));

/** VB1's counts: real numbers from the read, never guessed. */
export function planCounts(plan) {
  const items = allItems(plan);
  return {
    proposed: items.filter((i) => i?.status === 'proposed').length,
    accepted: items.filter(isDecided).length,
    dismissed: items.filter((i) => i?.status === 'discarded').length,
  };
}
export const countsLine = (c) => `${c.proposed} proposed · ${c.accepted} accepted · ${c.dismissed} dismissed`;

/** A module's items, ordered as the canvas draws them: proposals, then decided, then dismissed and withdrawn. */
export function moduleItems(plan, slug) {
  const rank = { proposed: 0, accepted: 1, edited: 1, discarded: 2, withdrawn: 3 };
  return (plan?.modules?.[slug] || []).map((i, n) => [i, n])
    .sort(([a, x], [b, y]) => (rank[a?.status] ?? 4) - (rank[b?.status] ?? 4) || x - y).map(([i]) => i);
}

const DECISION = { proceed: 'Proceed', pivot: 'Pivot', stop: 'Stop' };

/**
 * What the scope's verdict means for the plan (VB1, VB14). `verdict` is the
 * plan read's: the newest unsuperseded decision, or null when none.
 *   · given Proceed or Pivot: the strip's "From your Verdict" (founders only);
 *   · given Stop: the plan is paused, and resumes on a new decision;
 *   · withheld: "Plan anyway", and Raise shows the plan as resting on withheld evidence.
 */
export function verdictState(verdict) {
  if (!verdict || !DECISION[verdict.decision]) return { kind: 'none' };
  const n = Number(verdict.evidence_count) || 0;
  const pieces = `${n} ${n === 1 ? 'piece' : 'pieces'} of evidence`;
  if (verdict.state === 'withheld') {
    return { kind: 'withheld', line: `Your verdict is withheld: ${n} of ${Number(verdict.bar) || 5} pieces of evidence. You can still plan, but Raise will show the plan as resting on withheld evidence.` };
  }
  if (verdict.decision === 'stop') return { kind: 'stop', line: 'Your verdict is Stop. The plan is paused. Accepted items stay.', sub: 'Record a new decision to resume.' };
  const when = dayMon(verdict.decided_at);
  return { kind: 'given', strip: `From your Verdict: ${[DECISION[verdict.decision], when, pieces].filter(Boolean).join(' · ')}` };
}

/** "Prepared 12 Oct, 14:05 UTC · rules only, no AI cost" (VB1); the trigger is never an AI run (D1065). */
export function preparedLine(plan) {
  const at = dayTime(plan?.prepared_at);
  return `${at ? `Prepared ${at}` : 'Prepared'} · rules only, no AI cost`;
}

/**
 * VB13: what D1067's `/since` says. `new` is null for a plan prepared before
 * D1067 kept its list: then only "changed" is known, and no count is guessed.
 */
export function sinceLine(since) {
  if (!since || !since.plan) return null;
  const n = since.new, c = since.contradicting;
  if (Number.isInteger(n) && n > 0) {
    return `${n} new ${n === 1 ? 'piece' : 'pieces'} of evidence since this plan${Number.isInteger(c) && c > 0 ? `, ${c} contradicting` : ''}.`;
  }
  if (since.changed) return n === null ? 'Your evidence changed since this plan. How many pieces are new was not recorded for this plan.' : 'Your evidence changed since this plan.';
  return null;
}
export const SINCE_FOOT = 'No accepted item is changed by itself. Open it to decide.';

/**
 * VB4: each kind's own fields, D1066 §2's list and values. Impact is
 * `added_value`, the column a feature's Impact is stored in.
 */
export const EDIT_FIELDS = {
  feature: [
    { key: 'title', label: 'Title', kind: 'text', max: 200 },
    { key: 'description', label: 'Description', kind: 'area', max: 2000 },
    { key: 'added_value', label: 'Impact', kind: 'choice', options: ['Low', 'Medium', 'High'] },
    { key: 'effort', label: 'Effort', kind: 'choice', options: ['S', 'M', 'L', 'XL'] },
  ],
  'must-have': [{ key: 'title', label: 'Title', kind: 'text', max: 200 }],
  'prototype-test': [
    { key: 'title', label: 'Title', kind: 'text', max: 200 },
    { key: 'method', label: 'Method', kind: 'text', max: 500 },
    { key: 'target', label: 'Target', kind: 'text', max: 500 },
  ],
  risk: [
    { key: 'title', label: 'Title', kind: 'text', max: 200 },
    { key: 'severity', label: 'Severity', kind: 'choice', options: ['low', 'medium', 'high'], words: { low: 'Low', medium: 'Medium', high: 'High' } },
    { key: 'mitigation', label: 'Mitigation', kind: 'area', max: 2000 },
  ],
  roadmap: [
    { key: 'title', label: 'Title', kind: 'text', max: 200 },
    { key: 'lane', label: 'Lane', kind: 'choice', options: ['Now', 'Next', 'Later'] },
  ],
  'formation-step': [{ key: 'title', label: 'Title', kind: 'text', max: 200 }],
};
export const canEdit = (item) => Boolean(EDIT_FIELDS[item?.kind]);

/** The form's starting values: the proposal as it stands (or the founder's saved edit). */
export function editStart(item) {
  const p = item?.payload || {};
  return Object.fromEntries((EDIT_FIELDS[item?.kind] || []).map((f) => [f.key, p[f.key] == null ? '' : String(p[f.key])]));
}

/**
 * The edit Accept sends: only the fields the founder changed, so an untouched
 * item reads `accepted`, not `edited` (D1066 §2). A blank title is refused here
 * before the Worker refuses it; a blank optional field is left as proposed.
 */
export function editPayload(item, form) {
  const start = editStart(item);
  const out = {};
  for (const f of EDIT_FIELDS[item?.kind] || []) {
    const v = String(form?.[f.key] ?? '').trim();
    if (f.key === 'title' && !v) return { error: 'A title is required.' };
    if (v === String(start[f.key] ?? '').trim()) continue;
    if (!v) continue;
    if (f.kind === 'choice' && !f.options.includes(v)) return { error: `${f.label} is not a value this item takes.` };
    out[f.key] = v.slice(0, f.max || v.length);
  }
  return { edit: Object.keys(out).length ? out : null };
}

/** The module an item's write belongs to, by name. */
export const moduleName = (slug) => SECTIONS.find((s) => s.slug === slug)?.name || 'Build';

/**
 * A refused write, in words (VB3's "could not save"). The Worker's own sentence
 * is used when it sent one (D1066 §5); a store failure says nothing was saved.
 */
export function writeRefusal(e, slug) {
  const code = e?.data?.code || e?.data?.error || e?.code || null;
  const said = String(e?.data?.message || e?.data?.detail || '').trim();
  const sentence = said && !/^[a-z_]+$/.test(said) ? said : '';
  if (code === 'writer_refused') return `${moduleName(slug)} could not save this: ${sentence || 'Build refused the write.'}`;
  if (code === 'decided') return sentence || 'This item is already decided.';
  if (code === 'plan_paused' || code === 'plan_stopped') return sentence || 'The plan is paused. Record a new decision to resume.';
  if (code === 'invalid_edit') return sentence || 'That edit is not one this item takes.';
  if (code === 'not_this_project') return sentence || 'This plan belongs to the venture’s founders.';
  return sentence || 'This could not be saved. Nothing was saved; try again.';
}

/** Accept all's answer (D1066 §3) in words: how many landed, what was refused, and whether more wait. */
export function acceptAllLine(out) {
  const results = Array.isArray(out?.results) ? out.results : [];
  const ok = Number.isInteger(out?.accepted) ? out.accepted : results.filter((r) => r?.ok).length;
  const refused = results.filter((r) => r && !r.ok);
  const parts = [`${ok} accepted.`];
  if (refused.length) parts.push(`${refused.length} could not be: ${String(refused[0].message || 'refused').replace(/\.$/, '')}.`);
  if (out?.more) parts.push('More are waiting. Press Accept all again.');
  return parts.join(' ');
}

/** VB17: nothing accepted in Validate yet (D1065 `no_evidence`). */
export const EMPTY_TITLE = 'Nothing to plan from yet.';
export const EMPTY_LINE = 'The plan reads only what you accepted in Validate. Accept findings from your interviews first.';
/** No plan yet, but there may be evidence: the founder prepares it by rule. */
export const UNPREPARED_LINE = 'No plan is prepared yet. The planner’s rules prepare it from what you accepted in Validate, at no AI cost.';
/** VB16: an admin reads the plan. */
export const READ_ONLY_LINE = 'Founders accept their plan. You can read it.';
export const READ_ONLY_NOTE = 'If the owner allows admins to accept, Accept appears here.';
/** VB20a: a caller the plan is not for. */
export const NOT_YOURS = 'This plan belongs to the venture’s founders.';
export const NOT_YOURS_LINE = 'Investors, advisors and explorers see a venture’s evidence only when its founders share it in Raise.';
/** Pause and resume (D1067 §3), each said before it is done. */
export const PAUSED_BY_YOU = 'You paused the plan. Accepted items stay. Nothing is prepared or accepted while it is paused.';
export const PAUSE_BODY = 'Nothing is prepared or accepted while the plan is paused. Accepted items stay as they are. You can resume it.';
export const RESUME_BODY = 'The plan opens again, so you can accept its proposals.';
export const UPDATE_BODY = 'The rules read your accepted evidence again. New proposals are added and unsupported ones withdrawn. No accepted item is changed.';
export const DISMISS_BODY = 'It will not be proposed again. Nothing is written to Build.';
