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

/** Only `?project_id=` rides on a plan tab, so the chosen venture is kept and nothing else. */
export function planSearch(search = '') {
  const id = new URLSearchParams(String(search || '').replace(/^\?/, '')).get('project_id');
  return id && /^\d+$/.test(id) ? `?project_id=${id}` : '';
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

export const PLAN_WAIT = 'Proposals are prepared by the planner’s rules from what you accepted in Validate (part 1). Until then none is shown, which is not a claim that there is nothing to build.';
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
