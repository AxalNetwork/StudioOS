/**
 * D658 (#1471) — Eadwyn turns an interview into proposals for every Validate
 * module, and answers questions about it, each claim tied to the passage it
 * came from.
 *
 * What this file decides, as pure functions the routes call:
 *
 *   · THE KINDS. Seven placements, each with a payload schema, a key for
 *     merging duplicates, and whether a module writer exists. A kind with
 *     no store stays proposed-only (`writer: false`: market facts) and the
 *     review read says so.
 *   · THE CITATION RULE. A placement must name the span it came from, as
 *     `cite: { from, to }` in milliseconds, inside the transcript it was
 *     given and overlapping at least one segment. One that does not is
 *     DROPPED, not stored: an uncited placement is a claim nobody can check.
 *   · NEVER TRUNCATED SILENTLY. A long transcript is split on segment
 *     boundaries, every segment in exactly one part, each part run, and the
 *     placements merged. `parts > 1` travels to the founder.
 *   · ASK. An answer must cite at least one span of the transcript; one that
 *     cites nothing is refused rather than shown.
 *
 * Severity is three-level (Severe, Real, Mild), as the canvas draws it and as
 * `interview_pain_severities` stores it since #1472 (D659): accept writes the
 * level itself.
 */
import type { Env } from '../types';
import { run as aiRun } from './aiRouter';
import { AI_SURFACE } from './aiSurfaces';
import { normPhrase } from './painGroups';

/** One transcript segment, as #1470 stores a `final` one. Offsets in ms. */
export interface Segment {
  start: number;
  end: number;
  speaker: string | null;
  text: string;
}

export type PlacementKind =
  | 'pain_severity'
  | 'icp_fit'
  | 'segment'
  | 'demand_signal'
  | 'evidence'
  | 'competitor_mention'
  | 'market_fact';

/** What the run knows about the project, so a placement can name real rows. */
export interface StructureContext {
  hypotheses: { id: number; code: string; claim: string }[];
  painGroups: { id: number; title: string }[];
}

export interface Placement {
  kind: PlacementKind;
  payload: Record<string, unknown>;
  cite: { from: number; to: number };
  quote: string;
}

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim().replace(/\s+/g, ' ');
  return t && t.length <= max ? t : null;
};
const oneOf = <T extends string>(v: unknown, values: readonly T[]): T | null => {
  const t = typeof v === 'string' ? v.trim().toLowerCase().replace(/[\s-]+/g, '_') : '';
  return (values as readonly string[]).includes(t) ? (t as T) : null;
};
const posInt = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null);

export const PAIN_SEVERITY_LEVELS = ['severe', 'real', 'mild'] as const;
export const ICP_FITS = ['strong', 'partial', 'none'] as const;
export const DEMAND_SIGNALS = ['need_to_have', 'would_pay', 'loi', 'pre_sale'] as const;
export const EVIDENCE_DIRECTIONS = ['supports', 'refutes'] as const;
/** The Lab has no Anecdote / Pattern / Measured scale; this is the canvas's. */
export const EVIDENCE_STRENGTHS = ['anecdote', 'pattern', 'measured'] as const;

interface KindSpec {
  /** Normalise the payload, or null to drop the placement. */
  parse(p: Record<string, unknown>, ctx: StructureContext): Record<string, unknown> | null;
  /** Two placements with the same key are one finding. */
  key(p: Record<string, unknown>): string;
  /** A module writer exists on main, so accept can write it. */
  writer: boolean;
  /** Which Validate module the placement belongs to, for the review read. */
  module: string;
}

export const PLACEMENT_KINDS: Record<PlacementKind, KindSpec> = {
  pain_severity: {
    module: 'problem_discovery',
    writer: true,
    parse: (p) => {
      const phrase = str(p.phrase, 120);
      const severity = oneOf(p.severity, PAIN_SEVERITY_LEVELS);
      return phrase && normPhrase(phrase) && severity ? { phrase, severity } : null;
    },
    key: (p) => `pain:${normPhrase(String(p.phrase))}`,
  },
  icp_fit: {
    module: 'customer_research',
    writer: true,
    parse: (p) => {
      const fit = oneOf(p.fit, ICP_FITS);
      const reason = str(p.reason, 300);
      return fit && reason ? { fit, reason } : null;
    },
    key: () => 'icp_fit',
  },
  segment: {
    module: 'ideal_customer_profile',
    writer: true, // writeSegment + assignInterviewSegment (D659)
    parse: (p) => {
      const name = str(p.name, 80);
      return name ? { name } : null;
    },
    key: (p) => `segment:${String(p.name).toLowerCase()}`,
  },
  demand_signal: {
    module: 'demand_signals',
    writer: true, // writeDemandSignal, arriving to_confirm (D659)
    parse: (p) => {
      const signal = oneOf(p.signal, DEMAND_SIGNALS);
      const detail = p.detail == null ? null : str(p.detail, 200);
      if (!signal || (p.detail != null && !detail)) return null;
      return { signal, detail };
    },
    key: (p) => `demand:${p.signal}`,
  },
  evidence: {
    module: 'experiments',
    writer: true,
    parse: (p, ctx) => {
      const hypothesisId = posInt(p.hypothesis_id);
      const painGroupId = posInt(p.pain_group_id);
      const direction = oneOf(p.direction, EVIDENCE_DIRECTIONS);
      const strength = oneOf(p.strength, EVIDENCE_STRENGTHS);
      if (!hypothesisId || !painGroupId || !direction || !strength) return null;
      // Only rows this project has: the model cannot invent a hypothesis.
      if (!ctx.hypotheses.some((h) => h.id === hypothesisId)) return null;
      if (!ctx.painGroups.some((g) => g.id === painGroupId)) return null;
      return { hypothesis_id: hypothesisId, pain_group_id: painGroupId, direction, strength };
    },
    key: (p) => `evidence:${p.hypothesis_id}:${p.pain_group_id}:${p.direction}`,
  },
  competitor_mention: {
    module: 'market_intelligence',
    writer: true, // writeCompetitorMention, on the project's competitor list (D659)
    parse: (p) => {
      const name = str(p.name, 120);
      return name ? { name, context: str(p.context, 200) } : null;
    },
    key: (p) => `competitor:${String(p.name).toLowerCase()}`,
  },
  market_fact: {
    module: 'market_intelligence',
    writer: false, // no market-fact store yet
    parse: (p) => {
      const fact = str(p.fact, 300);
      const source = str(p.source, 200);
      return fact && source ? { fact, source } : null;
    },
    key: (p) => `fact:${String(p.fact).toLowerCase()}`,
  },
};

export function isPlacementKind(k: unknown): k is PlacementKind {
  return typeof k === 'string' && Object.prototype.hasOwnProperty.call(PLACEMENT_KINDS, k);
}

/**
 * The segments a span overlaps. Empty when the span is not a span (`to` not
 * after `from`), not numbers, or outside every segment given.
 */
export function segmentsInSpan(segments: readonly Segment[], from: unknown, to: unknown): Segment[] {
  if (typeof from !== 'number' || typeof to !== 'number') return [];
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return [];
  return segments.filter((s) => s.start < to && s.end > from);
}

export const MAX_QUOTE = 400;

export function quoteFor(segments: readonly Segment[]): string {
  const text = segments.map((s) => s.text.trim()).join(' ').replace(/\s+/g, ' ').trim();
  return text.length > MAX_QUOTE ? `${text.slice(0, MAX_QUOTE - 1)}…` : text;
}

/**
 * Split a transcript on segment boundaries, each part at most `maxChars` of
 * text (a single longer segment is a part on its own). Every segment lands in
 * exactly one part, in order: nothing is cut.
 */
export function chunkSegments(segments: readonly Segment[], maxChars = 12000): Segment[][] {
  const parts: Segment[][] = [];
  let cur: Segment[] = [];
  let size = 0;
  for (const s of segments) {
    const len = s.text.length + 32;
    if (cur.length && size + len > maxChars) {
      parts.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(s);
    size += len;
  }
  if (cur.length) parts.push(cur);
  return parts;
}

/** The transcript as the model reads it: one line per segment, offsets first. */
export function transcriptLines(segments: readonly Segment[]): string {
  return segments.map((s) => `[${s.start}-${s.end}] ${s.speaker || 'Speaker ?'}: ${s.text.trim()}`).join('\n');
}

/** Pull the first JSON object out of a model's reply; null when there is none. */
export function firstJsonObject(text: string): Record<string, unknown> | null {
  const t = String(text || '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const v = JSON.parse(t.slice(start, end + 1));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The placements one part of the transcript produced, each validated against
 * its kind and its citation. Returns what survived and how many were dropped,
 * so the run can say "3 placements had no passage and were left out".
 */
export function parsePlacements(
  output: string,
  part: readonly Segment[],
  ctx: StructureContext,
): { placements: Placement[]; dropped: number } {
  const obj = firstJsonObject(output);
  const raw = Array.isArray(obj?.placements) ? (obj!.placements as unknown[]) : [];
  const placements: Placement[] = [];
  let dropped = 0;
  for (const item of raw) {
    const r = item && typeof item === 'object' ? (item as Record<string, unknown>) : null;
    const kind = r?.kind;
    const cite = r?.cite && typeof r.cite === 'object' ? (r.cite as Record<string, unknown>) : null;
    const cited = cite ? segmentsInSpan(part, cite.from, cite.to) : [];
    const payload = r?.payload && typeof r.payload === 'object' ? (r.payload as Record<string, unknown>) : null;
    const parsed = isPlacementKind(kind) && payload ? PLACEMENT_KINDS[kind].parse(payload, ctx) : null;
    // THE RULE: no cited span inside this part, no placement.
    if (!isPlacementKind(kind) || !parsed || cited.length === 0) {
      dropped += 1;
      continue;
    }
    placements.push({
      kind,
      payload: parsed,
      cite: { from: cite!.from as number, to: cite!.to as number },
      quote: quoteFor(cited),
    });
  }
  return { placements, dropped };
}

/** One finding once, the first citation kept. */
export function mergePlacements(lists: readonly Placement[][]): Placement[] {
  const seen = new Set<string>();
  const out: Placement[] = [];
  for (const list of lists) {
    for (const p of list) {
      const key = `${p.kind}|${PLACEMENT_KINDS[p.kind].key(p.payload)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
  }
  return out;
}

export const STRUCTURE_PROMPT = [
  'You read one customer-discovery interview and place what it says into the',
  "founder's Validate modules. You only PROPOSE; the founder accepts or discards",
  'each placement.',
  '',
  'Every line of the transcript starts with its span in milliseconds, [from-to].',
  'Every placement MUST cite the span it comes from, using those numbers, as',
  '"cite": {"from": <ms>, "to": <ms>}. A placement you cannot tie to a passage',
  'is not a placement: leave it out.',
  '',
  'Kinds and their payloads:',
  '- pain_severity: {"phrase": "<the pain in a few words>", "severity": "severe" | "real" | "mild"}',
  '- icp_fit: {"fit": "strong" | "partial" | "none", "reason": "<one sentence>"}',
  '- segment: {"name": "<the customer segment this person belongs to>"}',
  '- demand_signal: {"signal": "need_to_have" | "would_pay" | "loi" | "pre_sale", "detail": "<optional>"}',
  '- evidence: {"hypothesis_id": <id from the list>, "pain_group_id": <id from the list>,',
  '    "direction": "supports" | "refutes", "strength": "anecdote" | "pattern" | "measured"}',
  '- competitor_mention: {"name": "<company or product>", "context": "<optional>"}',
  '- market_fact: {"fact": "<one sentence>", "source": "<who said it, or where it comes from>"}',
  '',
  'Use only hypothesis and pain-group ids from the lists you are given. Do not',
  'invent figures. Reply with ONE JSON object and nothing else:',
  '{"placements": [{"kind": "...", "payload": {...}, "cite": {"from": 0, "to": 0}}]}',
].join('\n');

export function contextLines(ctx: StructureContext): string {
  const h = ctx.hypotheses.length
    ? ctx.hypotheses.map((x) => `- ${x.id}: ${x.code} ${x.claim}`).join('\n')
    : '- none';
  const g = ctx.painGroups.length
    ? ctx.painGroups.map((x) => `- ${x.id}: ${x.title}`).join('\n')
    : '- none';
  return `Hypotheses (id: code claim):\n${h}\n\nPain groups (id: title):\n${g}`;
}

/** One line of the session's receipt for one model call. */
export interface ReceiptLine {
  step: 'structured' | 're_structured' | 'asked';
  model: string;
  requested_model: string | null;
  fallback_used: boolean;
  est_cost_usd: number;
  prompt_tokens: number;
  completion_tokens: number;
}

export type StructureOutcome =
  | {
      ok: true;
      placements: Placement[];
      dropped: number;
      parts: number;
      receipt: ReceiptLine[];
    }
  | { ok: false; refusal: string | null; receipt: ReceiptLine[] };

/**
 * Run `structure_interview` over a transcript: one call per part, through the
 * router (which reserves and settles the D640 budget per call), placements
 * merged. A refusal on any part stops the run, and the caller stores nothing:
 * half a structuring is not offered as a whole one.
 */
export async function structureTranscript(
  env: Env,
  opts: {
    userId: number;
    model?: string;
    segments: readonly Segment[];
    context: StructureContext;
    step: 'structured' | 're_structured';
    maxChars?: number;
  },
): Promise<StructureOutcome> {
  const parts = chunkSegments(opts.segments, opts.maxChars);
  const receipt: ReceiptLine[] = [];
  const lists: Placement[][] = [];
  let dropped = 0;
  for (let i = 0; i < parts.length; i += 1) {
    const r = await aiRun(env, {
      task: 'structure_interview',
      userId: opts.userId,
      model: opts.model,
      // Every structuring run is asked from Validate's interviews (D552).
      surface: AI_SURFACE.validateInterviews,
      systemPrompt: `${STRUCTURE_PROMPT}\n\n${contextLines(opts.context)}`,
      messages: [{
        role: 'user',
        content: parts.length > 1
          ? `Part ${i + 1} of ${parts.length} of the transcript:\n${transcriptLines(parts[i])}`
          : `Transcript:\n${transcriptLines(parts[i])}`,
      }],
      maxTokens: 1500,
      temperature: 0.2,
    });
    receipt.push({
      step: opts.step,
      model: r.usage.model,
      requested_model: opts.model ?? null,
      fallback_used: !!r.usage.fallback_used,
      est_cost_usd: r.usage.est_cost_usd || 0,
      prompt_tokens: r.usage.prompt_tokens || 0,
      completion_tokens: r.usage.completion_tokens || 0,
    });
    if (!r.ok) return { ok: false, refusal: r.refusal ?? null, receipt };
    const parsed = parsePlacements(r.output || '', parts[i], opts.context);
    lists.push(parsed.placements);
    dropped += parsed.dropped;
  }
  return { ok: true, placements: mergePlacements(lists), dropped, parts: parts.length, receipt };
}

/**
 * ASK. The model answers from the transcript only, as
 * `{"answer": "...", "cites": [{"from", "to"}]}`. Citations outside the
 * transcript are dropped; an answer left with none is REFUSED.
 */
export const ASK_PROMPT = [
  'Answer a question about one customer interview, from its transcript only.',
  'Every line of the transcript starts with its span in milliseconds, [from-to].',
  'Cite every span your answer relies on. If the transcript does not answer the',
  'question, say so, and cite nothing.',
  'Reply with ONE JSON object and nothing else:',
  '{"answer": "<plain sentences>", "cites": [{"from": <ms>, "to": <ms>}]}',
].join('\n');

export function checkAnswer(
  output: string,
  segments: readonly Segment[],
): { ok: true; answer: string; cites: { from: number; to: number; quote: string }[] } | { ok: false; reason: 'no_citation' | 'unreadable' } {
  const obj = firstJsonObject(output);
  const answer = typeof obj?.answer === 'string' ? obj.answer.trim() : '';
  if (!obj || !answer) return { ok: false, reason: 'unreadable' };
  const cites: { from: number; to: number; quote: string }[] = [];
  for (const c of Array.isArray(obj.cites) ? obj.cites : []) {
    const r = c && typeof c === 'object' ? (c as Record<string, unknown>) : null;
    const hit = r ? segmentsInSpan(segments, r.from, r.to) : [];
    if (hit.length) cites.push({ from: r!.from as number, to: r!.to as number, quote: quoteFor(hit) });
  }
  if (!cites.length) return { ok: false, reason: 'no_citation' };
  return { ok: true, answer, cites };
}

/**
 * COMPARE. Two runs over one session, aligned by module: each module lists
 * the first run's placements and the second's, side by side, so the founder
 * keeps one line or the other.
 */
export function alignRuns<T extends { kind: string }>(
  first: readonly T[],
  second: readonly T[],
): { module: string; first: T[]; second: T[] }[] {
  const modules: string[] = [];
  const add = (k: string) => {
    const m = isPlacementKind(k) ? PLACEMENT_KINDS[k].module : 'other';
    if (!modules.includes(m)) modules.push(m);
    return m;
  };
  for (const p of first) add(p.kind);
  for (const p of second) add(p.kind);
  const moduleOf = (p: T) => (isPlacementKind(p.kind) ? PLACEMENT_KINDS[p.kind].module : 'other');
  return modules.map((module) => ({
    module,
    first: first.filter((p) => moduleOf(p) === module),
    second: second.filter((p) => moduleOf(p) === module),
  }));
}

/** A `final` segment as #1470 (migration 438) stores it. */
export interface SegmentRow {
  start_ms: number | null;
  end_ms: number | null;
  speaker_label: string | null;
  text: string;
}

/**
 * #1470's final segments as the spans this file cites, in order.
 *
 * Audio sessions carry both offsets. Text chat and manual entry carry a start
 * (the message's time) or nothing, and no end. So, deterministically: a
 * missing end is the next segment's start (or the start + 1 ms for the last);
 * a missing start is the previous end, or the segment's position × 1000 ms.
 * The same rows always give the same spans, so a stored `cite_from`/`cite_to`
 * keeps pointing at the passage it quoted.
 */
export function toSegments(rows: readonly SegmentRow[]): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    const text = String(r.text || '').trim();
    if (!text) continue;
    const prevEnd = out.length ? out[out.length - 1].end : 0;
    // A recorded start is kept as recorded, even where two speakers overlap.
    const start = Number.isSafeInteger(r.start_ms) && (r.start_ms as number) >= 0 ? (r.start_ms as number) : Math.max(prevEnd, i * 1000);
    const nextStart = rows.slice(i + 1).map((n) => n.start_ms).find((n) => Number.isSafeInteger(n));
    let end = Number.isSafeInteger(r.end_ms) ? (r.end_ms as number)
      : (typeof nextStart === 'number' && nextStart > start ? nextStart : start + 1000);
    if (end <= start) end = start + 1;
    out.push({ start, end, speaker: r.speaker_label || null, text });
  }
  return out;
}

export type AskOutcome =
  | { ok: true; answer: string; cites: { from: number; to: number; quote: string }[]; receipt: ReceiptLine[] }
  | { ok: false; refusal: string | null; reason: 'refused' | 'no_citation'; receipt: ReceiptLine[] };

/**
 * ASK over a whole transcript. A long one is asked part by part (never cut);
 * each part's answer is kept only if it cites a span of that part, and the
 * kept answers are joined in order. Nothing kept → refused, `no_citation`.
 */
export async function askTranscript(
  env: Env,
  opts: { userId: number; model?: string; segments: readonly Segment[]; question: string; maxChars?: number },
): Promise<AskOutcome> {
  const parts = chunkSegments(opts.segments, opts.maxChars ?? 24000);
  const receipt: ReceiptLine[] = [];
  const answers: string[] = [];
  const cites: { from: number; to: number; quote: string }[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const r = await aiRun(env, {
      task: 'structure_interview',
      userId: opts.userId,
      model: opts.model,
      surface: AI_SURFACE.validateInterviews,
      systemPrompt: ASK_PROMPT,
      messages: [{
        role: 'user',
        content: `${parts.length > 1 ? `Part ${i + 1} of ${parts.length} of the transcript` : 'Transcript'}:\n${transcriptLines(parts[i])}\n\nQuestion: ${opts.question}`,
      }],
      maxTokens: 500,
      temperature: 0.1,
    });
    receipt.push({
      step: 'asked',
      model: r.usage.model,
      requested_model: opts.model ?? null,
      fallback_used: !!r.usage.fallback_used,
      est_cost_usd: r.usage.est_cost_usd || 0,
      prompt_tokens: r.usage.prompt_tokens || 0,
      completion_tokens: r.usage.completion_tokens || 0,
    });
    if (!r.ok) return { ok: false, refusal: r.refusal ?? null, reason: 'refused', receipt };
    const checked = checkAnswer(r.output || '', parts[i]);
    if (checked.ok) {
      answers.push(checked.answer);
      cites.push(...checked.cites);
    }
  }
  if (!cites.length) return { ok: false, refusal: null, reason: 'no_citation', receipt };
  return { ok: true, answer: answers.join(' '), cites, receipt };
}
