/**
 * #3938 part 7 (D1478 task 4) — VA12's retrieve step: "ICP: segment form fill
 * and clustering of interviewees".
 *
 * The plan gives VA12 two steps: RETRIEVE (bge-m3 embeds the venture's
 * interviewees and its segments) then SYNTH (the segment form's writer). Until
 * now the New segment fill ran only the writer. This is the first step. Each
 * interviewee goes to their nearest existing segment when one is near enough;
 * the rest are grouped with each other by meaning. The writer reads the result
 * as a HINT after the facts, never as an answer: the form's parse is
 * unchanged, so a hint cannot write a field by itself.
 *
 * WHAT IS EMBEDDED. An interviewee is their role, company, ICP fit and logged
 * pains, never their name, notes or recording. A segment is its name and "who
 * they are". The hint names an interviewee only by role and company.
 *
 * DEGRADING, NEVER INVENTING. When any segment cannot be embedded, nobody is
 * placed by segment (a nearest segment taken from a partial list is a wrong
 * hint); the interviewees are still grouped with each other. An interviewee
 * who cannot be embedded, or whose vector is the wrong size, is left out.
 * With fewer than two interviewees embedded there is no hint at all. A refusal
 * the member must hear about (assist off, a budget stop, the guard, a plan
 * lock) stops the press, as in `themeHints.ts`.
 *
 * Every embedding is the member's press through `run()`, on the form's page
 * and rail, through `HINT_DEPS` (`themeHints.ts`).
 */
import { cosine } from './matchRows';
import type { ThemeHintDeps } from './themeHints';

/** The form whose fill runs this step, and its plan job. */
export const SEGMENT_FORM = 'segment';
export const SEGMENT_JOB = 'VA12' as const;

/** At most this many interviewees and segments are embedded for one press. */
export const SEGMENT_INTERVIEWEES_MAX = 40;
export const SEGMENT_SEGMENTS_MAX = 20;
/** An interviewee this close to a segment belongs near it; below, they are grouped with each other. */
export const NEAR_SEGMENT = 0.6;
/** Two ungrouped interviewees this close share a group. */
export const SAME_GROUP = 0.65;
const TEXT_MAX = 400;

export type Interviewee = { id: number; role: string | null; company: string | null; fit: string | null; pains: string[] };
export type Segment = { name: string; who: string | null };
export type SegmentHint = { bySegment: Array<{ segment: string; people: string[] }>; groups: string[][] };

const clip = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX);
/** How the hint names an interviewee: role and company, never their name. */
export const label = (p: Interviewee) => {
  const who = [p.role, p.company].map((x) => String(x ?? '').trim()).filter(Boolean).join(', ');
  return who ? `Interview ${p.id} (${who})` : `Interview ${p.id}`;
};
const textOf = (p: Interviewee) => clip([p.role, p.company, p.fit ? `ICP fit: ${p.fit}` : '', p.pains.length ? `Pains: ${p.pains.join('; ')}` : '']
  .map((x) => String(x ?? '').trim()).filter(Boolean).join('. '));

/** The interviewees by nearest segment and the groups of the rest, or null when there is nothing to say. */
export async function segmentHints(people: Interviewee[], segments: Segment[], deps: ThemeHintDeps): Promise<SegmentHint | null> {
  const pool = people.filter((p) => textOf(p)).slice(0, SEGMENT_INTERVIEWEES_MAX);
  if (pool.length < 2) return null;
  const named = segments.filter((s) => clip(s.name)).slice(0, SEGMENT_SEGMENTS_MAX);
  let sv: number[][] | null = [];
  for (const s of named) {
    const v = await deps.embed(clip([s.name, s.who ?? ''].filter(Boolean).join('. ')));
    if (!v) { sv = null; break; }
    sv.push(v);
  }
  const vecs: Array<{ p: Interviewee; v: number[] }> = [];
  for (const p of pool) {
    const v = await deps.embed(textOf(p));
    if (v && v.length) vecs.push({ p, v });
  }
  if (vecs.length < 2) return null;
  const dim = vecs[0].v.length;
  const usable = vecs.filter((x) => x.v.length === dim);
  const placed = new Map<string, string[]>();
  const rest: typeof usable = [];
  for (const x of usable) {
    let best: { name: string; s: number } | null = null;
    if (sv) {
      named.forEach((s, i) => {
        const score = cosine(x.v, sv![i]);
        if (Number.isFinite(score) && (!best || score > best.s)) best = { name: clip(s.name), s: score };
      });
    }
    const b = best as { name: string; s: number } | null;
    if (b && b.s >= NEAR_SEGMENT) placed.set(b.name, [...(placed.get(b.name) ?? []), label(x.p)]);
    else rest.push(x);
  }
  // Greedy grouping: each interviewee joins the first group whose first member is close enough.
  const groups: Array<{ seed: number[]; people: string[] }> = [];
  for (const x of rest) {
    const g = groups.find((gr) => cosine(x.v, gr.seed) >= SAME_GROUP);
    if (g) g.people.push(label(x.p));
    else groups.push({ seed: x.v, people: [label(x.p)] });
  }
  const bySegment = [...placed].map(([segment, ps]) => ({ segment, people: ps })).sort((a, b) => b.people.length - a.people.length || a.segment.localeCompare(b.segment));
  const out = groups.map((g) => g.people).sort((a, b) => b.length - a.length);
  if (!bySegment.length && !out.some((g) => g.length > 1)) return null;
  return { bySegment, groups: out };
}

/** The hint section the writer reads after the facts, or '' when there is nothing to add. */
export function segmentSection(h: SegmentHint | null): string {
  if (!h) return '';
  const lines = ['Interviewees by meaning (a hint from the retrieval step, not an answer; a new segment should describe a group not already covered):'];
  for (const s of h.bySegment) lines.push(`  Near "${s.segment}": ${s.people.join('; ')}`);
  h.groups.forEach((g, i) => { if (g.length > 1) lines.push(`  Not near any segment, group ${i + 1}: ${g.join('; ')}`); });
  const alone = h.groups.filter((g) => g.length === 1).map((g) => g[0]);
  if (alone.length) lines.push(`  Not near any segment or each other: ${alone.join('; ')}`);
  return lines.join('\n');
}
