/**
 * D8256 (#8256) — the Raise Overview's next actions beyond readiness (RA-02): the follow-ups due and
 * the investor objections no narrative section answers yet. Each part reads on its own: one that
 * could not be read is `{ state: 'unreadable' }` and never reads as "nothing due" or "nothing open".
 *
 *   follow_ups_due   prospects still in the raise (not passed) with a next step due on or before
 *                    today + 6 days (this week), earliest first; each with its step, its day and
 *                    whether it is overdue, linked to Capital relationships' Outreach
 *   open_objections  objections from Capital relationships' feedback (`raise_prospect_feedback`)
 *                    grouped as the Investor narrative groups them (D913, `objectionKey`), that no
 *                    saved section answers (migration 624); most heard first, each with the
 *                    investors who raised it, linked to Story with that objection open. When the
 *                    answers cannot be read the part is unreadable: no objection reads as open on
 *                    a failed read.
 *
 * `names: false` (a staff read, D1191) leaves every investor name out: the counts stay.
 * The links are in-app addresses only.
 */
import { objectionKey, readAnswers } from './narrative/objections';
import type { Ctx } from './raiseCycle';

/** Rows read at most for each part; past it the part says it is capped rather than undercount in silence. */
export const FOLLOW_UPS_MAX = 50;
export const OBJECTION_ROWS_MAX = 2000;
/** "This week": a next step due within this many days of today. */
export const DUE_WITHIN_DAYS = 6;

export type FollowUp = { prospect_id: number; investor: string | null; step: string; due_on: string; overdue: boolean };
export type FollowUpsDue =
  | { state: 'ok'; items: FollowUp[]; capped: boolean; href: string }
  | { state: 'unreadable' };
export type OpenObjection = { key: string; text: string; count: number; prospects: number; investors: string[] | null; href: string };
export type OpenObjections =
  | { state: 'ok'; items: OpenObjection[]; capped: boolean }
  | { state: 'unreadable' };

const day = (v: unknown): string | null => {
  const s = String(v ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
const nameOf = (p: { name: string | null; firm: string | null }) => [p.name, p.firm].map((x) => String(x ?? '').trim()).filter(Boolean).join(' · ') || 'An investor';

export async function followUpsDue(ctx: Ctx, opts: { names: boolean }): Promise<FollowUpsDue> {
  try {
    const res = await ctx.env.DB.prepare(
      `SELECT id, name, firm, next_step, next_step_due FROM raise_prospects
        WHERE project_id = ? AND stage <> 'passed' AND trim(COALESCE(next_step, '')) <> ''
          AND julianday(substr(next_step_due, 1, 10)) IS NOT NULL
          AND julianday(substr(next_step_due, 1, 10)) <= julianday(?) + ?
        ORDER BY substr(next_step_due, 1, 10), id LIMIT ?`,
    ).bind(ctx.projectId, ctx.today, DUE_WITHIN_DAYS, FOLLOW_UPS_MAX + 1)
      .all<{ id: number; name: string | null; firm: string | null; next_step: string; next_step_due: string }>();
    const rows = (res.results || []).filter((r) => day(r.next_step_due));
    return {
      state: 'ok',
      items: rows.slice(0, FOLLOW_UPS_MAX).map((r) => {
        const due = day(r.next_step_due)!;
        return { prospect_id: Number(r.id), investor: opts.names ? nameOf(r) : null, step: String(r.next_step).replace(/\s+/g, ' ').trim(), due_on: due, overdue: due < ctx.today };
      }),
      capped: rows.length > FOLLOW_UPS_MAX,
      href: `/raise/capital-relationships/outreach?project=${ctx.projectId}`,
    };
  } catch (e) {
    console.warn('[raiseNextActions] follow-ups unreadable:', (e as Error)?.message);
    return { state: 'unreadable' };
  }
}

export async function openObjections(ctx: Ctx, opts: { names: boolean }): Promise<OpenObjections> {
  try {
    const res = await ctx.env.DB.prepare(
      `SELECT f.objection, f.prospect_id, p.name, p.firm
         FROM raise_prospect_feedback f JOIN raise_prospects p ON p.id = f.prospect_id
        WHERE p.project_id = ? AND trim(f.objection) <> ''
        ORDER BY f.created_at DESC, f.id DESC LIMIT ?`,
    ).bind(ctx.projectId, OBJECTION_ROWS_MAX + 1).all<{ objection: string; prospect_id: number; name: string | null; firm: string | null }>();
    const rows = res.results || [];
    const answers = await readAnswers(ctx.env, ctx.projectId);
    const by = new Map<string, { text: string; count: number; prospects: Map<number, string> }>();
    for (const r of rows.slice(0, OBJECTION_ROWS_MAX)) {
      const text = String(r.objection ?? '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const key = await objectionKey(text);
      let g = by.get(key);
      // Rows arrive newest first, so the first row seen gives the words shown (as D913 does).
      if (!g) { g = { text, count: 0, prospects: new Map() }; by.set(key, g); }
      g.count += 1;
      if (!g.prospects.has(Number(r.prospect_id))) g.prospects.set(Number(r.prospect_id), nameOf(r));
    }
    const items = [...by.entries()]
      .filter(([key]) => !answers.has(key))
      .map(([key, g]) => ({
        key, text: g.text, count: g.count, prospects: g.prospects.size,
        investors: opts.names ? [...g.prospects.values()] : null,
        href: `/raise/investor-narrative/story?project=${ctx.projectId}&objection=${encodeURIComponent(key)}`,
      }))
      .sort((a, b) => b.prospects - a.prospects || b.count - a.count || a.text.localeCompare(b.text));
    return { state: 'ok', items, capped: rows.length > OBJECTION_ROWS_MAX };
  } catch (e) {
    console.warn('[raiseNextActions] objections unreadable:', (e as Error)?.message);
    return { state: 'unreadable' };
  }
}
