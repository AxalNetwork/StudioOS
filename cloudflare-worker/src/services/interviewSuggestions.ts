/**
 * D757 §2.6–§2.7 (#1925) — what a Validate module reads from interviews: the
 * suggestions still waiting for the founder, the findings already accepted
 * into `interview_findings`, and how many accepted suggestions each module
 * took from one interview.
 *
 * Reads only. Every write stays where it is: Accept, one at a time or all at
 * once, runs each suggestion's own claim and writer
 * (`routes/founder_validate_structure.ts`).
 *
 * WHO. The callers gate: pending suggestions reach venture writers only
 * (`canWrite`), and a finding's quote reaches anyone else only when its
 * interview agreed to be quoted. A suggestion's quote is `QUOTE_WITHHELD`
 * without that consent, for writers too, as D757 §2.5 draws the gate.
 */
import type { Env } from '../types';
import { MODULES, QUOTE_WITHHELD, type ModuleSlug } from './cycleValidate';
import { FINDING_KINDS, findingLine, isFindingKind, type FindingKind } from './interviewFindings';
import { isPlacementKind, placementSlug } from './interviewStructuring';

/** At most this many pending suggestions are read per module, newest last. */
export const MAX_SUGGESTIONS = 200;

export interface Suggestion {
  id: number;
  kind: string;
  payload: Record<string, unknown>;
  quote: string | null;
  /** D857: the customer's own words when `quote` is the translation the run read; null otherwise. */
  quote_original: string | null;
  /** D857: the language the customer spoke, when the run read a translation. */
  source_lang: string | null;
  interviewee: string | null;
  interview_id: number | null;
  session_id: number | null;
  cite_from: number | null;
  segment_id: number | null;
  speaker: string | null;
  href: string | null;
}

const parse = (raw: unknown): Record<string, unknown> | null => {
  try {
    const v = raw ? JSON.parse(String(raw)) : null;
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch { return null; }
};
const interviewOf = (ref: unknown): number | null => {
  const m = /^interview:([1-9][0-9]{0,9})$/.exec(String(ref ?? ''));
  return m ? Number(m[1]) : null;
};
const ids = (n: number) => Array.from({ length: n }, () => '?').join(', ');

/**
 * The project's pending suggestions from engine runs (`run_id` set) that land
 * in `slug`, each with where it was heard: the interviewee, the session, the
 * first transcript segment of its passage and that segment's speaker, and
 * the session page's link to the line.
 */
export async function moduleSuggestions(env: Env, projectId: number, slug: ModuleSlug): Promise<Suggestion[]> {
  const rows = (await env.DB.prepare(
    `SELECT id, kind, payload_json, edited_payload_json, target_ref, session_id, cite_from, citation_json
       FROM validate_proposals
      WHERE project_id = ? AND run_id IS NOT NULL AND status = 'pending'
      ORDER BY id LIMIT ?`,
  ).bind(projectId, MAX_SUGGESTIONS * MODULES.length).all<Record<string, any>>()).results ?? [];
  const mine = rows.flatMap((r) => {
    if (!isPlacementKind(r.kind)) return [];
    const payload = parse(r.edited_payload_json) ?? parse(r.payload_json);
    return payload && placementSlug(r.kind, payload) === slug ? [{ r, payload }] : [];
  }).slice(0, MAX_SUGGESTIONS);
  if (!mine.length) return [];

  const interviewIds = [...new Set(mine.map(({ r }) => interviewOf(r.target_ref)).filter((n): n is number => n != null))];
  const interviews = new Map<number, { name: string | null; consent: boolean }>();
  if (interviewIds.length) {
    const res = await env.DB.prepare(
      `SELECT id, interviewee_name, quote_consent FROM discovery_interviews WHERE project_id = ? AND id IN (${ids(interviewIds.length)})`,
    ).bind(projectId, ...interviewIds).all<{ id: number; interviewee_name: string | null; quote_consent: number | null }>();
    for (const iv of res.results ?? []) interviews.set(Number(iv.id), { name: iv.interviewee_name ?? null, consent: Number(iv.quote_consent) === 1 });
  }
  const sessionIds = [...new Set(mine.map(({ r }) => Number(r.session_id)).filter((n) => Number.isInteger(n) && n > 0))];
  const segments = new Map<number, Array<{ id: number; start: number; end: number; speaker: string | null }>>();
  if (sessionIds.length) {
    const res = await env.DB.prepare(
      `SELECT s.id, s.session_id, s.start_ms, s.end_ms, s.speaker_label
         FROM interview_transcript_segments s JOIN interview_sessions x ON x.id = s.session_id
        WHERE x.project_id = ? AND s.session_id IN (${ids(sessionIds.length)}) AND s.source = 'final'
        ORDER BY s.session_id, COALESCE(s.start_ms, 0), s.id`,
    ).bind(projectId, ...sessionIds).all<{ id: number; session_id: number; start_ms: number | null; end_ms: number | null; speaker_label: string | null }>();
    for (const s of res.results ?? []) {
      const list = segments.get(Number(s.session_id)) ?? [];
      const start = Number(s.start_ms ?? 0);
      list.push({ id: Number(s.id), start, end: Number(s.end_ms ?? start), speaker: s.speaker_label ?? null });
      segments.set(Number(s.session_id), list);
    }
  }

  return mine.map(({ r, payload }) => {
    const interviewId = interviewOf(r.target_ref);
    const iv = interviewId != null ? interviews.get(interviewId) : undefined;
    const sessionId = Number.isInteger(Number(r.session_id)) && Number(r.session_id) > 0 ? Number(r.session_id) : null;
    const from = r.cite_from == null ? null : Number(r.cite_from);
    // The passage's first segment: the one it starts in, else the first after it.
    const segs = sessionId != null ? segments.get(sessionId) ?? [] : [];
    const seg = from == null ? null : segs.find((s) => s.start <= from && from < Math.max(s.end, s.start + 1)) ?? segs.find((s) => s.start >= from) ?? null;
    const citation = parse(r.citation_json);
    const quote = citation?.quote;
    const original = citation?.quote_original;
    const sourceLang = citation?.source_lang;
    return {
      id: Number(r.id),
      kind: String(r.kind),
      payload,
      quote: typeof quote === 'string' && quote ? (iv?.consent ? quote : QUOTE_WITHHELD) : null,
      // The same consent gate as the quote: the original is the same customer's words.
      quote_original: typeof original === 'string' && original ? (iv?.consent ? original : QUOTE_WITHHELD) : null,
      source_lang: typeof sourceLang === 'string' && /^[a-z]{2,3}$/.test(sourceLang) ? sourceLang : null,
      interviewee: iv?.name ?? null,
      interview_id: interviewId,
      session_id: sessionId,
      cite_from: from,
      segment_id: seg?.id ?? null,
      speaker: seg?.speaker ?? null,
      href: sessionId != null ? `/validate/session/${sessionId}?project=${projectId}${seg ? `#seg-${seg.id}` : ''}` : null,
    };
  });
}

export interface FindingRow {
  id: number;
  kind: FindingKind;
  what: string;
  detail: string;
  quote: string | null;
  interview_id: number;
  interviewee: string | null;
}

/**
 * The accepted findings of `kinds`, for the interviews `where` names (a
 * segment's, one interview's, or the project's), newest first. A quote
 * reaches a writer, or anyone else when its interview agreed to be quoted.
 */
export async function findingsFor(
  env: Env,
  opts: { projectId: number; kinds: readonly FindingKind[]; writer: boolean; segmentId?: number; interviewId?: number },
): Promise<FindingRow[]> {
  const kinds = opts.kinds.filter((k) => isFindingKind(k));
  if (!kinds.length) return [];
  const res = await env.DB.prepare(
    `SELECT f.id, f.kind, f.payload_json, f.quote, f.interview_id, i.interviewee_name, i.quote_consent
       FROM interview_findings f JOIN discovery_interviews i ON i.id = f.interview_id AND i.project_id = f.project_id
      WHERE f.project_id = ? AND f.kind IN (${ids(kinds.length)})
        AND (? = 0 OR i.segment_id = ?) AND (? = 0 OR f.interview_id = ?)
      ORDER BY f.created_at DESC, f.id DESC LIMIT 200`,
  ).bind(
    opts.projectId, ...kinds,
    opts.segmentId != null ? 1 : 0, opts.segmentId ?? 0,
    opts.interviewId != null ? 1 : 0, opts.interviewId ?? 0,
  ).all<Record<string, any>>();
  return (res.results ?? []).flatMap((r) => {
    if (!isFindingKind(r.kind)) return [];
    const payload = parse(r.payload_json);
    if (!payload) return [];
    const line = findingLine(r.kind, payload);
    const quote = r.quote ? String(r.quote) : null;
    return [{
      id: Number(r.id), kind: r.kind, ...line,
      quote: quote && (opts.writer || Number(r.quote_consent) === 1) ? quote : quote ? QUOTE_WITHHELD : null,
      interview_id: Number(r.interview_id), interviewee: r.interviewee_name ?? null,
    }];
  });
}

/** Every finding kind whose module is `slug`, by its payload-free slug. */
export function findingKindsOf(slug: 'ideal-customer-profile' | 'market-intelligence' | 'demand-signals'): FindingKind[] {
  return (Object.keys(FINDING_KINDS) as FindingKind[]).filter((k) => FINDING_KINDS[k].slug({}) === slug);
}

/**
 * How many suggestions from one interview were accepted into each module,
 * in the modules' own order. A module that took none is left out.
 */
export async function acceptedPerModule(env: Env, projectId: number, interviewId: number): Promise<Array<{ slug: ModuleSlug; name: string; count: number }>> {
  const res = await env.DB.prepare(
    `SELECT kind, payload_json, edited_payload_json FROM validate_proposals
      WHERE project_id = ? AND target_ref = ? AND run_id IS NOT NULL AND status = 'accepted'`,
  ).bind(projectId, `interview:${interviewId}`).all<Record<string, any>>();
  const by = new Map<string, number>();
  for (const r of res.results ?? []) {
    if (!isPlacementKind(r.kind)) continue;
    const payload = parse(r.edited_payload_json) ?? parse(r.payload_json);
    if (!payload) continue;
    const slug = placementSlug(r.kind, payload);
    by.set(slug, (by.get(slug) ?? 0) + 1);
  }
  return MODULES.filter((m) => by.has(m.slug)).map((m) => ({ slug: m.slug, name: m.name, count: by.get(m.slug)! }));
}
