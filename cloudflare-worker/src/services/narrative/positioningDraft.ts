/**
 * D911 (#2695) — Eadwyn's positioning proposal for the Investor narrative,
 * part 5 of #2454. Pure where it can be: `material` reads the venture's
 * qualitative records, and everything after it is a function of what it read.
 *
 * NO FIGURE ENTERS. The run reads only qualitative records:
 *   - pain themes, each with its count in words ("most interviews"), never
 *     the count;
 *   - segments and tracked competitors, by name;
 *   - the Verdict's decision word (Proceed, Pivot or Stop), never its
 *     reasoning;
 *   - the solution as the founder wrote it;
 *   - the team's roles, never a name.
 * No score, tier, financial model value or holder name is read. Any item
 * that holds a digit is held back, so a figure typed into a segment's name
 * or the solution cannot reach the model either. This closes bug 6's
 * remainder (#2454): `POST /api/decks/positioning` sends the financial
 * model's runway, burn and LTV:CAC, and the team's names.
 *
 * NO FIGURE LEAVES. A field of the answer that holds a digit is dropped
 * before it is shown, as `unfoundFigures` does with an empty set of found
 * figures, and the answer says how many were dropped. The store refuses a
 * digit in Eadwyn's wording again on Accept (D908).
 *
 * WHAT IS STORED. Each field that survives is one `ai_rail_proposals` row
 * (D780) under `draft:narrative-positioning`, for the founder to Accept or
 * Discard one at a time (D777 part 3). A run writes no positioning.
 */
import type { Env } from '../../types';
import { getPainGroupsView } from '../painGroups';
import { currentDecision } from '../verdict';
import { POSITIONING_KINDS } from './store';

export const POSITIONING_PAGE = 'Founder · Raise · Investor narrative';
export const POSITIONING_OPTION = 'draft:narrative-positioning';

const HAS_DIGIT = /[0-9]/;
const MAX_ITEMS = 8;

type Part = { state: 'ok'; items: string[] } | { state: 'unreadable' };

export interface PositioningMaterial {
  pains: Part;
  segments: Part;
  competitors: Part;
  verdict: Part;
  solution: Part;
  team: Part;
  /** Items held back because they hold a digit. A count for the page, never the items. */
  withheld: number;
}

/** Where each part is read from, in the canvas's words (NAR5's "Read from"). */
export const READ_FROM: Record<Exclude<keyof PositioningMaterial, 'withheld'>, string> = {
  pains: 'Validate › Pain themes',
  segments: 'Validate › Segments',
  competitors: 'Validate › Competitors',
  verdict: 'Validate › Verdict',
  solution: 'Build › Solution design',
  team: 'Build › Founding team',
};

/** A theme's reach in words. The count itself never travels. */
export function reachWords(count: number, total: number): string {
  if (!(count > 0)) return 'not raised yet';
  if (total > 0 && count / total >= 0.5) return 'raised in most interviews';
  if (total > 0 && count / total >= 0.25) return 'raised in many interviews';
  return count === 1 ? 'raised in one interview' : 'raised in a few interviews';
}

const DECISION_WORD: Record<string, string> = { proceed: 'Proceed', pivot: 'Pivot', stop: 'Stop' };
const ROLE_WORD: Record<string, string> = { founder: 'Founder', owner: 'Founder', cofounder: 'Cofounder', advisor: 'Advisor' };

/** Keep the items with no digit; count the rest. */
function screen(items: string[], held: { n: number }): string[] {
  const out: string[] = [];
  for (const raw of items) {
    const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
    if (!s) continue;
    if (HAS_DIGIT.test(s)) { held.n += 1; continue; }
    if (!out.includes(s)) out.push(s);
  }
  return out.slice(0, MAX_ITEMS);
}

async function part(read: () => Promise<string[]>, held: { n: number }): Promise<Part> {
  try {
    return { state: 'ok', items: screen(await read(), held) };
  } catch (e) {
    console.warn('[narrative] positioning material unreadable:', (e as Error)?.message);
    return { state: 'unreadable' };
  }
}

const rows = async <T>(env: Env, sql: string, ...binds: unknown[]) => ((await env.DB.prepare(sql).bind(...binds).all<T>()).results || []) as T[];

/** The venture's qualitative records, each part read alone. */
export async function positioningMaterial(env: Env, projectId: number): Promise<PositioningMaterial> {
  const held = { n: 0 };
  const pains = await part(async () => {
    const view = await getPainGroupsView(env, projectId, { strict: true });
    const total = Number(view.interview_total) || 0;
    return [...(view.groups || [])].filter((g) => Number(g.count) > 0)
      .sort((a, b) => Number(b.count) - Number(a.count) || a.sort_order - b.sort_order)
      .map((g) => `${String(g.title || '').trim()} (${reachWords(Number(g.count), total)})`);
  }, held);
  const segments = await part(async () => (await rows<{ name: string }>(env,
    'SELECT name FROM customer_segments WHERE project_id = ? AND archived_at IS NULL ORDER BY id', projectId)).map((r) => r.name), held);
  const competitors = await part(async () => (await rows<{ name: string }>(env,
    `SELECT c.name FROM competitor_candidates c JOIN competitor_analyses a ON a.id = c.analysis_id
      WHERE a.project_id = ?
        AND NOT EXISTS (SELECT 1 FROM competitor_tracking t
                         WHERE t.project_id = a.project_id AND t.name_norm = substr(lower(trim(c.name)), 1, 120)
                           AND t.stopped_at IS NOT NULL)
      ORDER BY c.created_at, c.id`, projectId)).map((r) => r.name), held);
  const verdict = await part(async () => {
    const d = await currentDecision(env, projectId, 'venture');
    return d && DECISION_WORD[d.decision] ? [DECISION_WORD[d.decision]] : [];
  }, held);
  const solution = await part(async () => {
    const p = await env.DB.prepare('SELECT solution FROM projects WHERE id = ?').bind(projectId).first<{ solution: string | null }>();
    return p?.solution ? [String(p.solution).slice(0, 1200)] : [];
  }, held);
  const team = await part(async () => {
    const r = await rows<{ role: string }>(env,
      `SELECT 'founder' AS role FROM projects WHERE id = ? AND founder_id IS NOT NULL
       UNION ALL
       SELECT role FROM project_members WHERE project_id = ? AND status = 'accepted' AND role IN ('owner', 'cofounder', 'advisor')`,
      projectId, projectId);
    return r.map((x) => ROLE_WORD[x.role]).filter(Boolean);
  }, held);
  return { pains, segments, competitors, verdict, solution, team, withheld: held.n };
}

/** The parts that answered and hold something: what the run may read. */
export function readFrom(m: PositioningMaterial): string[] {
  return (Object.keys(READ_FROM) as Array<keyof typeof READ_FROM>)
    .filter((k) => m[k].state === 'ok' && (m[k] as { items: string[] }).items.length > 0)
    .map((k) => READ_FROM[k]);
}

/** True when there is nothing to propose from: the team's roles alone say nothing about the venture. */
export const nothingToRead = (m: PositioningMaterial) => readFrom(m).every((r) => r === READ_FROM.team);

export const POSITIONING_SYSTEM = 'You are Eadwyn, a startup positioning strategist. You write plain, specific words and never a number. Always return valid JSON.';

/** The prompt: the material, part by part, and the shape of the answer. Nothing in it holds a digit but the field limits. */
export function positioningPrompt(m: PositioningMaterial): string {
  const block = (k: keyof typeof READ_FROM) => {
    const p = m[k];
    if (p.state !== 'ok' || !p.items.length) return `${READ_FROM[k]}: not recorded`;
    return `${READ_FROM[k]}:\n${p.items.map((s) => `- ${s}`).join('\n')}`;
  };
  return `Write investor positioning for this venture from its own records below, and nothing else.

${(Object.keys(READ_FROM) as Array<keyof typeof READ_FROM>).map(block).join('\n\n')}

Return ONLY valid JSON of exactly this shape:
{
  "one_liner": "<one sentence, at most fifteen words>",
  "elevator": "<two or three sentences a founder can say in twenty seconds>",
  "lines": ["<line>", "<line>", "<line>", "<line>"],
  "category": "<the category the venture competes in, a few words>",
  "wedge": "<who it wins first and why, one phrase>"
}

Rules:
- Write no numbers, digits, percentages, prices, dates or counts of any kind. Figures are inserted by the founder from their records.
- Three to five lines, each a distinct angle, each at most eighteen words.
- Never invent customers, results, partners or funding.
- Name no person.`;
}

/** The answer's fields, each trimmed and capped, in the store's kinds. */
const CAP: Record<string, number> = { one_liner: 200, elevator: 1200, line: 300, category: 300, wedge: 300 };

export type ProposedField = { kind: typeof POSITIONING_KINDS[number]; position: number; text: string };

/**
 * The fields that may be proposed, and how many were dropped because they
 * held a digit. A field over its length is cut at the last word that fits.
 */
export function screenAnswer(parsed: unknown): { fields: ProposedField[]; removed: number } {
  const o = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  const fields: ProposedField[] = [];
  let removed = 0;
  const take = (kind: ProposedField['kind'], position: number, v: unknown) => {
    if (typeof v !== 'string') return;
    let s = v.replace(/\s+/g, ' ').trim();
    if (!s) return;
    if (HAS_DIGIT.test(s)) { removed += 1; return; }
    const max = CAP[kind];
    if (s.length > max) s = s.slice(0, max).replace(/\s+\S*$/, '').trim();
    if (s) fields.push({ kind, position, text: s });
  };
  take('one_liner', 0, o.one_liner);
  take('elevator', 0, o.elevator ?? o.elevator_pitch);
  const lines = Array.isArray(o.lines) ? o.lines : Array.isArray(o.positioning_lines) ? o.positioning_lines : [];
  let at = 0;
  for (const l of lines.slice(0, 6)) {
    const before = fields.length;
    take('line', at, l);
    if (fields.length > before) at += 1;
  }
  take('category', 0, o.category);
  take('wedge', 0, o.wedge);
  return { fields, removed };
}
