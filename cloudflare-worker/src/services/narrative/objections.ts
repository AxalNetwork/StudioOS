/**
 * D913 (#2697, NAR10 and NAR1) — the objections investors raised, read
 * project-wide from Capital relationships' feedback (`raise_prospect_feedback`,
 * migration 463), so Home and Story draw them with no version open.
 *
 * ONE OBJECTION, MANY ROWS. Each Add feedback is a row on one prospect. Rows
 * whose words match once case and spacing are set aside are one objection:
 * its count is how many rows said it, `prospects` how many investors did, and
 * its key is a hash of those words, so the key survives a deleted row.
 *
 * THE ANSWER IS THE FOUNDER'S OWN (D1189). `answer` is the newest non-blank
 * answer written on any of its rows in Capital relationships, else null. It is
 * shown to the founder and admins who already read Capital relationships.
 *
 * WHICH SECTION ANSWERS IT (the owner's option A, migration 624). Each
 * objection carries `answered`: the saved version and section whose words
 * answer it, how that was set (`eadwyn`: an accepted "Answer it" draft, saved;
 * `picked`: chosen by hand), who set it and when, or null. The answers are read
 * apart from the feedback: when they cannot be read, `answers` is
 * 'unreadable' and every `answered` is null, so no objection reads as answered
 * or unanswered on a failed read; the page says so.
 *
 * "Answer it" is `objectionDraft.ts`. This file imports nothing of the
 * narrative's store, so the module read (`raiseCycle.ts`) can use it.
 */
import type { Env } from '../../types';

/** Rows read at most; past it the read says it is capped rather than undercount in silence. */
export const FEEDBACK_CAP = 2000;

export type Answered = {
  version: number;
  section: string;
  how: 'eadwyn' | 'picked';
  by: { id: number; name: string | null } | null;
  at: string | null;
};

export type Objection = {
  key: string;
  text: string;
  count: number;
  prospects: number;
  last_heard: string | null;
  answer: string | null;
  answered?: Answered | null;
};

export type ObjectionsRead = { state: 'ok'; items: Objection[]; capped: boolean; answers: 'ok' | 'unreadable' };

const normal = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** The objection's key: the first 16 hex of SHA-256 over its normalised words. */
export async function objectionKey(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normal(text)));
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

type Row = { objection: string; answer: string | null; prospect_id: number; created_at: string | null };

/** Group the rows, newest first, into objections: most heard first, then by their words. */
export async function groupObjections(rows: readonly Row[]): Promise<Objection[]> {
  const by = new Map<string, { text: string; count: number; prospects: Set<number>; last: string | null; answer: string | null }>();
  for (const r of rows) {
    const text = String(r.objection ?? '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const n = normal(text);
    let g = by.get(n);
    // Rows arrive newest first, so the first row seen gives the words shown and the last heard day.
    if (!g) { g = { text, count: 0, prospects: new Set(), last: r.created_at ? String(r.created_at).slice(0, 10) : null, answer: null }; by.set(n, g); }
    g.count += 1;
    g.prospects.add(Number(r.prospect_id));
    const answer = String(r.answer ?? '').trim();
    if (answer && g.answer === null) g.answer = answer;
  }
  const out = await Promise.all([...by.values()].map(async (g) => ({
    key: await objectionKey(g.text), text: g.text, count: g.count, prospects: g.prospects.size, last_heard: g.last, answer: g.answer,
  })));
  return out.sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
}

type AnswerRow = { objection_key: string; version: number; section_key: string; how: string; answered_by: number | null; name: string | null; answered_at: string | null };

/** The venture's recorded answers by objection key. A failed read throws. */
export async function readAnswers(env: Env, projectId: number): Promise<Map<string, Answered>> {
  const res = await env.DB.prepare(
    `SELECT a.objection_key, a.version, a.section_key, a.how, a.answered_by, u.name, a.answered_at
       FROM narrative_objection_answers a LEFT JOIN users u ON u.id = a.answered_by
      WHERE a.project_id = ?`,
  ).bind(projectId).all<AnswerRow>();
  return new Map((res.results || []).map((r) => [r.objection_key, {
    version: Number(r.version),
    section: r.section_key,
    how: r.how === 'eadwyn' ? 'eadwyn' : 'picked',
    by: r.answered_by ? { id: Number(r.answered_by), name: r.name || null } : null,
    at: r.answered_at ? String(r.answered_at).slice(0, 10) : null,
  } as Answered]));
}

/** Every objection the venture's investors raised. A failed read throws; the caller says it could not be read. */
export async function readObjections(env: Env, projectId: number): Promise<ObjectionsRead> {
  const res = await env.DB.prepare(
    `SELECT f.objection, f.answer, f.prospect_id, f.created_at
       FROM raise_prospect_feedback f JOIN raise_prospects p ON p.id = f.prospect_id
      WHERE p.project_id = ?
      ORDER BY f.created_at DESC, f.id DESC LIMIT ?`,
  ).bind(projectId, FEEDBACK_CAP + 1).all<Row>();
  const rows = res.results || [];
  const items = await groupObjections(rows.slice(0, FEEDBACK_CAP));
  let answers: Map<string, Answered> | null = null;
  try { answers = await readAnswers(env, projectId); } catch (e) {
    console.warn('[narrative] objection answers unreadable:', (e as Error)?.name);
  }
  return {
    state: 'ok',
    items: items.map((o) => ({ ...o, answered: answers ? answers.get(o.key) ?? null : null })),
    capped: rows.length > FEEDBACK_CAP,
    answers: answers ? 'ok' : 'unreadable',
  };
}
