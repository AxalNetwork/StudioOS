/**
 * D1071 (#2941, part 8 of #2426) — "Word with Eadwyn": Eadwyn words the plan
 * the rules prepared. Pure where it can be: the route reads the plan, and
 * everything from the material to the screened answer is a function of it.
 *
 * EADWYN WORDS, THE RULES DECIDE. The model is handed the pending items the
 * rules proposed, each under a short ref (`i1`, `i2`…), and answers wording
 * for those refs only. A ref it invents is dropped, so it never adds, removes
 * or reorders an item (#2426 owner question 2, A). It words a title, a
 * feature's description, the brief's summary and the Lovable prompt, and
 * nothing else: no date, amount, verdict, cap-table change or send.
 *
 * LABELS AND COUNTS ONLY. What the model reads is the rule's title (already
 * `planLabel`ed by D1065), the item's kind and module, and its evidence as
 * kinds with counts and labels (`planLabel`ed again). A decision or a
 * commitment is a count, never its wording. No transcript, quote, name,
 * contact or link reaches the model.
 *
 * NO FIGURE LEAVES. A worded field that holds a digit, a currency sign, a
 * contact or a link is dropped, and the answer says how many were.
 *
 * NOTHING IS WRITTEN BUT THE WORDING ROW. The run stores one
 * `ai_rail_proposals` row (`kind 'draft'`) on `build_plan:<plan uid>`, with its
 * run (`usage_log_id`). An item's wording reaches the item only by its Save:
 * D1066's PATCH with `wording`, and Accept names the run in `fill_provenance`.
 */
import type { Env, User } from '../types';
import { planLabel } from './buildPlanner';
import { assertFounder, loadItem, PlanItemError } from './buildPlanAccept';

export const WORD_PAGE = 'Founder · Build';
export const WORD_OPTION = 'draft:build/plan';
/** The rows' own page name, as D1065 writes the plan's proposals. */
export const WORD_ROW_PAGE = 'Founder.Build.Plan';
export const WORD_MAX_ITEMS = 40;
export const WORD_TITLE_MAX = 200;
export const WORD_DESCRIPTION_MAX = 600;
export const WORD_SUMMARY_MAX = 600;
export const WORD_PROMPT_MAX = 4000;
/** The two targets that are not items. */
export const WORD_TARGETS = ['brief', 'prompt'] as const;

/** What each kind may be worded on; a kind without a field is not sent. */
const WORDED: Record<string, Array<'title' | 'description'>> = {
  feature: ['title', 'description'],
  'must-have': ['title'],
  'prototype-test': ['title'],
  risk: ['title'],
  roadmap: ['title'],
  'formation-step': ['title'],
};

const KIND_LABEL: Record<string, string> = {
  feature: 'Feature', 'must-have': 'Must-have', 'prototype-test': 'Prototype test', risk: 'Risk', roadmap: 'Roadmap item', 'formation-step': 'Formation step',
};
/** Evidence counted, never worded: what was decided and what was committed stay the founder's. */
const COUNTED_ONLY = new Set(['decision', 'commitment']);

type PlanItem = { uid: string; module: string; kind: string; status: string; payload: Record<string, any> | null; evidence: Array<{ kind: string; label?: string }> };
type Brief = { audience?: Array<{ label: string }>; problems?: Array<{ label: string }>; positioning?: Record<string, string> | null; replaces?: Array<{ label: string }> } | null;

export type WordMaterial = {
  refs: Record<string, string>;
  items: Array<{ ref: string; kind: string; module: string; title: string; fields: string[]; evidence: string[] }>;
  brief: { audience: string[]; problems: string[]; positioning: string[]; replaces: string[] };
};

/** What the model reads; null when nothing is pending to word. */
export function wordMaterial(modules: Record<string, PlanItem[]>, brief: Brief): WordMaterial | null {
  const pending = Object.values(modules).flat().filter((i) => i.status === 'proposed' && WORDED[i.kind] && i.payload);
  const refs: Record<string, string> = {};
  const items = pending.slice(0, WORD_MAX_ITEMS).map((i, n) => {
    const ref = `i${n + 1}`;
    refs[ref] = i.uid;
    const counts = new Map<string, { n: number; labels: Set<string> }>();
    for (const e of i.evidence || []) {
      const k = String(e.kind);
      const c = counts.get(k) || { n: 0, labels: new Set<string>() };
      c.n += 1;
      const label = planLabel(e.label);
      if (label && !COUNTED_ONLY.has(k)) c.labels.add(label);
      counts.set(k, c);
    }
    const evidence = [...counts].map(([k, c]) => `${c.n} ${k.replace(/_/g, ' ')}${c.labels.size ? `: ${[...c.labels].slice(0, 3).join('; ')}` : ''}`);
    return { ref, kind: KIND_LABEL[i.kind], module: i.module, title: planLabel(i.payload!.title), fields: WORDED[i.kind], evidence };
  }).filter((i) => i.title);
  const b = brief || {};
  const labels = (xs?: Array<{ label: string }>) => (xs || []).map((x) => planLabel(x?.label)).filter(Boolean).slice(0, 8);
  const material = {
    refs,
    items,
    brief: {
      audience: labels(b.audience), problems: labels(b.problems), replaces: labels(b.replaces),
      positioning: Object.entries(b.positioning || {}).map(([k, v]) => `${k}: ${planLabel(v)}`).filter((s) => !s.endsWith(': ')),
    },
  };
  return items.length || material.brief.problems.length || material.brief.audience.length ? material : null;
}

export const WORD_SYSTEM = 'You are Eadwyn, a writing assistant who words a founder\'s build plan. You write plain, specific words from the labels you are given, and never a number, date, price or name. You never tell the founder what to decide. Always return valid JSON.';

const list = (xs: string[]) => (xs.length ? xs.map((x) => `- ${x}`).join('\n') : '- not recorded');

/** The prompt. The only digits in it are evidence counts and the length limits. */
export function wordPrompt(m: WordMaterial): string {
  const items = m.items.map((i) => `${i.ref} · ${i.kind} · ${i.module} · rule's title: ${i.title}\n  evidence: ${i.evidence.join(' | ') || 'none'}\n  word: ${i.fields.join(', ')}`).join('\n');
  return `Word this build plan. The rules chose its items; word only the items listed, by their ref.

Brief
Audience:
${list(m.brief.audience)}
Problems:
${list(m.brief.problems)}
Positioning:
${list(m.brief.positioning)}
Replaces:
${list(m.brief.replaces)}

Items
${items || 'none'}

Return ONLY valid JSON of exactly this shape:
{ "items": [{ "ref": "i1", "title": "<title>", "description": "<only where asked>" }],
  "brief": { "summary": "<what is being built, for whom, against which problem>" },
  "lovable_prompt": "<a prompt asking Lovable to build a clickable prototype of the must-haves and features>" }

Rules:
- Word only the refs above. Never add, remove, merge or reorder an item.
- Write no numbers, digits, dates, prices, amounts, percentages or counts of any kind.
- Name no person, customer, company or interviewee. Quote no one.
- Never say whether to proceed, pivot or stop, and never mention equity, shares or ownership.
- A title is at most ${WORD_TITLE_MAX} characters; a description at most ${WORD_DESCRIPTION_MAX}; the summary at most ${WORD_SUMMARY_MAX}; the prompt at most ${WORD_PROMPT_MAX}.`;
}

/** A field a figure, contact or link could hide in is not kept. */
const REFUSED = /[0-9$€£¥%@]|https?:|www\./i;

function clip(v: unknown, max: number): string | null | false {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (REFUSED.test(t)) return false;
  return t.length > max ? t.slice(0, max + 1).replace(/\s+\S*$/, '').slice(0, max).trim() : t;
}

export type Wording = {
  items: Record<string, { title?: string; description?: string }>;
  brief: { summary: string } | null;
  lovable_prompt: string | null;
  removed: number;
};

/**
 * The wording that may be shown, keyed by item uid, and how many fields were
 * dropped. A ref the material did not send, and a field the item's kind does
 * not take, are ignored: Eadwyn words what exists.
 */
export function screenWording(parsed: unknown, m: WordMaterial): Wording {
  const o = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, any> : {};
  let removed = 0;
  const keep = (v: unknown, max: number) => {
    const r = clip(v, max);
    if (r === false) removed += 1;
    return r || null;
  };
  const items: Wording['items'] = {};
  for (const w of Array.isArray(o.items) ? o.items : []) {
    const uid = m.refs[String(w?.ref ?? '')];
    const spec = m.items.find((i) => m.refs[i.ref] === uid);
    if (!uid || !spec || items[uid]) continue;
    const out: { title?: string; description?: string } = {};
    const title = keep(w.title, WORD_TITLE_MAX);
    if (title) out.title = title;
    if (spec.fields.includes('description')) {
      const description = keep(w.description, WORD_DESCRIPTION_MAX);
      if (description) out.description = description;
    }
    if (Object.keys(out).length) items[uid] = out;
  }
  const summary = keep(o.brief?.summary, WORD_SUMMARY_MAX);
  return { items, brief: summary ? { summary } : null, lovable_prompt: keep(o.lovable_prompt, WORD_PROMPT_MAX), removed };
}

// ─────────────────────────────────────────────── the wording row

type PlanRef = { id: number; uid: string; status: string };

export const planFor = (env: Env, projectId: number, scope: string) => env.DB.prepare(`SELECT id, uid, status FROM build_plans
  WHERE project_id = ? AND scope = ? AND status IN ('draft', 'open', 'paused') ORDER BY id DESC LIMIT 1`).bind(projectId, scope).first<PlanRef>();

/** Stores the run's wording; it is shown as not saved until an item's Save keeps it. */
export async function storeWording(env: Env, userId: number, plan: PlanRef, w: Wording, run: { model: string | null; usageLogId: number | null }) {
  const uid = crypto.randomUUID();
  // A newer wording replaces the founder's pending one on this plan; a kept wording stays the item's.
  await env.DB.batch([
    env.DB.prepare(`UPDATE ai_rail_proposals SET status = 'withdrawn', updated_at = CURRENT_TIMESTAMP
      WHERE record_ref = ? AND rail_option = ? AND kind = 'draft' AND user_id = ? AND status = 'proposed'`).bind(`build_plan:${plan.uid}`, WORD_OPTION, userId),
    env.DB.prepare(`INSERT INTO ai_rail_proposals (uid, user_id, rail_page, rail_option, record_ref, kind, payload_json, model, usage_log_id, decided_payload_json)
      VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`)
      .bind(uid, userId, WORD_ROW_PAGE, WORD_OPTION, `build_plan:${plan.uid}`, JSON.stringify(w), run.model, run.usageLogId, JSON.stringify({ kept: [], discarded: [] })),
  ]);
  return uid;
}

type WordingRow = { id: number; uid: string; status: string; payload_json: string; decided_payload_json: string | null; usage_log_id: number | null; created_at: string };
const parse = (s: unknown): any => { try { return JSON.parse(String(s)); } catch { return null; } };

/** The wording as the page draws it: each target not yet kept or discarded. */
export function wordingView(row: WordingRow) {
  const w = (parse(row.payload_json) || {}) as Wording;
  const d = parse(row.decided_payload_json) || {};
  const decided = new Set<string>([...(d.kept || []), ...(d.discarded || [])]);
  return {
    uid: row.uid, created_at: row.created_at, removed: Number(w.removed || 0),
    items: Object.fromEntries(Object.entries(w.items || {}).filter(([k]) => !decided.has(k))),
    brief: w.brief && !decided.has('brief') ? w.brief : null,
    lovable_prompt: w.lovable_prompt && !decided.has('prompt') ? w.lovable_prompt : null,
    kept: { brief: (d.kept || []).includes('brief') ? w.brief : null, prompt: (d.kept || []).includes('prompt') ? w.lovable_prompt : null },
  };
}

/** The founder's latest wording on the plan, or null. */
export async function latestWording(env: Env, userId: number, plan: PlanRef) {
  const row = await env.DB.prepare(`SELECT id, uid, status, payload_json, decided_payload_json, usage_log_id, created_at FROM ai_rail_proposals
    WHERE record_ref = ? AND rail_option = ? AND kind = 'draft' AND user_id = ? AND status IN ('proposed', 'accepted') ORDER BY id DESC LIMIT 1`)
    .bind(`build_plan:${plan.uid}`, WORD_OPTION, userId).first<WordingRow>();
  return row ? wordingView(row) : null;
}

const WORDING_UID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One wording row on the item's own plan, the founder's, still open. */
async function wordingOn(env: Env, userId: number, planUid: string, wordingUid: unknown) {
  if (typeof wordingUid !== 'string' || !WORDING_UID.test(wordingUid)) throw new PlanItemError('invalid_edit', 400, 'That wording is not on this plan.');
  const row = await env.DB.prepare(`SELECT id, uid, status, payload_json, decided_payload_json, usage_log_id, created_at FROM ai_rail_proposals
    WHERE uid = ? AND record_ref = ? AND rail_option = ? AND kind = 'draft' AND user_id = ?`)
    .bind(wordingUid, `build_plan:${planUid}`, WORD_OPTION, userId).first<WordingRow>();
  if (!row || !['proposed', 'accepted'].includes(row.status)) throw new PlanItemError('invalid_edit', 400, 'That wording is not on this plan.');
  return row;
}

/** Records a target kept or discarded on the wording row; the row is accepted once anything is kept. */
async function decide(env: Env, row: WordingRow, target: string, how: 'kept' | 'discarded') {
  const d = parse(row.decided_payload_json) || {};
  const kept: string[] = (d.kept || []).filter((t: string) => t !== target);
  const discarded: string[] = (d.discarded || []).filter((t: string) => t !== target);
  (how === 'kept' ? kept : discarded).push(target);
  await env.DB.prepare(`UPDATE ai_rail_proposals SET decided_payload_json = ?, status = CASE WHEN ? THEN 'accepted' ELSE status END,
    decided_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('proposed', 'accepted')`)
    .bind(JSON.stringify({ kept, discarded }), kept.length ? 1 : 0, row.id).run();
}

/**
 * Keep wording on an item: the edit D1066's PATCH saves, built from the
 * wording, with the wording named on it (`wording_uid`) so Accept names its
 * run. The item stays proposed until Accept.
 */
export async function itemWordingEdit(env: Env, user: User, itemUid: string, wordingUid: unknown) {
  const item = await loadItem(env, itemUid);
  if (!item) throw new PlanItemError('not_this_project', 404, 'This plan item does not belong to this venture.');
  assertFounder(item, user);
  const plan = await env.DB.prepare('SELECT uid FROM build_plans WHERE id = ?').bind(item.plan_id).first<{ uid: string }>();
  const row = await wordingOn(env, user.id, String(plan?.uid ?? ''), wordingUid);
  const words = ((parse(row.payload_json) || {}).items || {})[itemUid];
  if (!words || !Object.keys(words).length) throw new PlanItemError('invalid_edit', 400, 'That wording holds nothing for this item.');
  const edit: Record<string, string> = {};
  for (const k of WORDED[item.kind] || []) if (typeof words[k] === 'string') edit[k] = words[k];
  return { edit, wording: { uid: row.uid, id: row.id, usage_log_id: row.usage_log_id }, decide: () => decide(env, row, itemUid, 'kept') };
}

/** Keep or discard the brief's or the prompt's wording, or discard an item's. Keeping an item is its Save. */
export async function decideWording(env: Env, user: User, projectId: number, scope: string, wordingUid: string, target: string, how: 'kept' | 'discarded') {
  const plan = await planFor(env, projectId, scope);
  if (!plan) throw new PlanItemError('not_this_project', 404, 'This plan does not belong to this venture.');
  const row = await wordingOn(env, user.id, plan.uid, wordingUid);
  const w = (parse(row.payload_json) || {}) as Wording;
  const isItem = Boolean(w.items?.[target]);
  if (!isItem && !(WORD_TARGETS as readonly string[]).includes(target)) throw new PlanItemError('invalid_edit', 400, 'That wording holds nothing for this.');
  if (isItem && how === 'kept') throw new PlanItemError('invalid_edit', 400, 'An item’s wording is kept by saving the item.');
  if (!isItem && !(target === 'brief' ? w.brief : w.lovable_prompt)) throw new PlanItemError('invalid_edit', 400, 'That wording holds nothing for this.');
  await decide(env, row, target, how);
  const after = await env.DB.prepare(`SELECT id, uid, status, payload_json, decided_payload_json, usage_log_id, created_at FROM ai_rail_proposals WHERE id = ?`).bind(row.id).first<WordingRow>();
  return wordingView(after!);
}
