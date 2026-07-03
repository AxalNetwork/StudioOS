/**
 * Pitch Deck Reviewer — extraction, section mapping, and review generation.
 *
 * Extraction is Cloudflare-native: we use Workers AI `env.AI.toMarkdown()`
 * (the document-conversion binding) to turn PDF / DOC / DOCX into markdown,
 * including OCR for image-only PDFs. No paid third-party parsing API.
 *
 * Everything degrades gracefully: if conversion is unavailable or fails, we
 * return `status:'failed'` and the UI falls back to manual paste. The review
 * generator (Workers AI) also has a deterministic fallback so the reviewer is
 * always usable.
 */
import type { Env } from '../types';
import { run as aiRun } from './aiRouter';

export const DECK_SECTIONS: Array<{ key: string; label: string; keywords: string[] }> = [
  { key: 'problem', label: 'Problem', keywords: ['problem', 'pain', 'challenge', 'broken', 'struggle', 'today founders', 'status quo'] },
  { key: 'solution', label: 'Solution', keywords: ['solution', 'introducing', 'we built', 'our approach', 'how it works'] },
  { key: 'market', label: 'Market', keywords: ['market', 'tam', 'sam', 'som', 'market size', 'billion', 'opportunity'] },
  { key: 'product', label: 'Product', keywords: ['product', 'features', 'demo', 'platform', 'screenshots', 'how it works'] },
  { key: 'traction', label: 'Traction', keywords: ['traction', 'growth', 'users', 'revenue', 'mrr', 'arr', 'customers', 'retention', 'waitlist'] },
  { key: 'business_model', label: 'Business model', keywords: ['business model', 'pricing', 'revenue model', 'unit economics', 'ltv', 'cac', 'monetization'] },
  { key: 'competition', label: 'Competition', keywords: ['competition', 'competitors', 'landscape', 'alternatives', 'vs', 'moat', 'differentiation'] },
  { key: 'go_to_market', label: 'Go-to-market', keywords: ['go-to-market', 'gtm', 'distribution', 'channels', 'sales', 'marketing', 'acquisition'] },
  { key: 'team', label: 'Team', keywords: ['team', 'founders', 'ceo', 'cto', 'advisors', 'experience', 'we are'] },
  { key: 'financials', label: 'Financials', keywords: ['financials', 'projections', 'forecast', 'burn', 'runway', 'p&l', 'ebitda'] },
  { key: 'ask', label: 'Fundraising ask', keywords: ['raising', 'ask', 'seeking', 'round', 'use of funds', 'investment', 'valuation', 'safe'] },
  { key: 'other', label: 'Other / uncategorized', keywords: [] },
];

export interface DeckSection {
  key: string;
  label: string;
  content: string;
}

export interface DeckChunk {
  idx: number;
  page: number | null;
  text: string;
}

export interface ExtractionResult {
  status: 'ok' | 'failed' | 'empty';
  markdown: string;
  chunks: DeckChunk[];
  error?: string;
}

export interface DeckReview {
  overall_score: number;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  missing_sections: string[];
  red_flags: string[];
  section_suggestions: Array<{ section: string; suggestion: string }>;
  priority_fixes: string[];
  improved_wording: Array<{ section: string; before: string; after: string }>;
  fix_first: string;
}

const MAX_MD_CHARS = 40_000;

function parseJsonLoose<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  let s = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const firstObj = s.indexOf('{');
  const firstArr = s.indexOf('[');
  let start = firstObj === -1 ? firstArr : firstArr === -1 ? firstObj : Math.min(firstObj, firstArr);
  if (start === -1) return null;
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1)) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Extract text from raw deck bytes using Workers AI document conversion.
 * Returns status:'failed' (never throws) so callers can offer manual paste.
 */
export async function extractDeck(env: Env, bytes: Uint8Array, mime: string, filename: string): Promise<ExtractionResult> {
  const ai = (env as unknown as { AI?: { toMarkdown?: (docs: unknown) => Promise<unknown> } }).AI;
  if (!ai || typeof ai.toMarkdown !== 'function') {
    // Plain-text / markdown uploads can be decoded directly without the AI binding.
    if (/text\/(plain|markdown)/i.test(mime)) {
      const md = new TextDecoder('utf-8').decode(bytes).slice(0, MAX_MD_CHARS);
      return md.trim() ? { status: 'ok', markdown: md, chunks: chunkMarkdown(md) } : { status: 'empty', markdown: '', chunks: [] };
    }
    return { status: 'failed', markdown: '', chunks: [], error: 'document_conversion_unavailable' };
  }
  try {
    const blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
    const result = (await ai.toMarkdown([{ name: filename || 'deck', blob }])) as Array<{ data?: string }> | { data?: string };
    let md = '';
    if (Array.isArray(result)) md = String(result[0]?.data || '');
    else md = String((result as { data?: string })?.data || '');
    md = md.slice(0, MAX_MD_CHARS).trim();
    if (!md) return { status: 'empty', markdown: '', chunks: [] };
    return { status: 'ok', markdown: md, chunks: chunkMarkdown(md) };
  } catch (e) {
    return { status: 'failed', markdown: '', chunks: [], error: (e as Error).message || 'extraction_failed' };
  }
}

/** Split markdown into traceable chunks (preserve original text order). */
export function chunkMarkdown(md: string): DeckChunk[] {
  const raw = md.split(/\n(?=#{1,3}\s)|\n\s*\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  const blocks = raw.length ? raw : md.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  return blocks.slice(0, 200).map((text, idx) => ({ idx, page: null, text: text.slice(0, 4000) }));
}

function scoreBlockForSection(block: string, keywords: string[]): number {
  if (!keywords.length) return 0;
  const b = block.toLowerCase();
  let score = 0;
  for (const kw of keywords) if (b.includes(kw)) score += kw.includes(' ') ? 2 : 1;
  return score;
}

/**
 * Deterministic first-pass section mapping from chunks. Optionally refined by
 * AI when the model is available (better boundaries + cleanup).
 */
export function mapSectionsHeuristic(chunks: DeckChunk[]): DeckSection[] {
  const buckets: Record<string, string[]> = {};
  for (const s of DECK_SECTIONS) buckets[s.key] = [];
  for (const chunk of chunks) {
    let best = 'other';
    let bestScore = 0;
    for (const s of DECK_SECTIONS) {
      const sc = scoreBlockForSection(chunk.text, s.keywords);
      if (sc > bestScore) {
        bestScore = sc;
        best = s.key;
      }
    }
    buckets[best].push(chunk.text);
  }
  return DECK_SECTIONS.map((s) => ({ key: s.key, label: s.label, content: (buckets[s.key] || []).join('\n\n').trim() }));
}

export async function mapSections(env: Env, userId: number, markdown: string, chunks: DeckChunk[]): Promise<DeckSection[]> {
  const heuristic = mapSectionsHeuristic(chunks);
  const system =
    'You organize raw pitch-deck text into standard sections. Respond ONLY with JSON: {"sections": [{"key": string, "content": string}]}. ' +
    'Use ONLY these keys: ' +
    DECK_SECTIONS.map((s) => s.key).join(', ') +
    '. Put verbatim/lightly-cleaned deck content under each. Leave a section content empty if the deck does not cover it. Do not invent facts.';
  const user = `Raw deck text (markdown):\n${markdown.slice(0, 16_000)}`;
  try {
    const res = await aiRun(env, {
      task: 'dd_synthesis',
      userId,
      systemPrompt: system,
      messages: [{ role: 'user', content: user }],
      maxTokens: 1800,
      temperature: 0.2,
    });
    const parsed = parseJsonLoose<{ sections: Array<{ key: string; content: string }> }>(res.output);
    if (parsed?.sections?.length) {
      const byKey = new Map(parsed.sections.map((s) => [s.key, String(s.content || '')]));
      return DECK_SECTIONS.map((s) => ({
        key: s.key,
        label: s.label,
        // Prefer AI content; fall back to heuristic bucket when AI left it blank.
        content: (byKey.get(s.key) || heuristic.find((h) => h.key === s.key)?.content || '').trim(),
      }));
    }
  } catch {
    /* fall through to heuristic */
  }
  return heuristic;
}

function normalizeReview(ai: Partial<DeckReview> | null, sections: DeckSection[]): DeckReview {
  const present = sections.filter((s) => s.key !== 'other' && s.content.trim()).map((s) => s.key);
  const missing = DECK_SECTIONS.filter((s) => s.key !== 'other' && !present.includes(s.key)).map((s) => s.label);
  const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean).slice(0, 12) : []);
  const score = Number(ai?.overall_score);
  return {
    overall_score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : Math.max(20, Math.min(90, 30 + present.length * 6)),
    summary: typeof ai?.summary === 'string' && ai.summary.trim() ? ai.summary.trim() : `Deck covers ${present.length}/${DECK_SECTIONS.length - 1} standard sections.`,
    strengths: strArr(ai?.strengths).length ? strArr(ai?.strengths) : present.length ? [`Covers ${present.slice(0, 4).join(', ')}`] : [],
    weaknesses: strArr(ai?.weaknesses),
    missing_sections: strArr(ai?.missing_sections).length ? strArr(ai?.missing_sections) : missing,
    red_flags: strArr(ai?.red_flags),
    section_suggestions: Array.isArray(ai?.section_suggestions)
      ? (ai!.section_suggestions as Array<{ section: string; suggestion: string }>)
          .filter((x) => x && typeof x.suggestion === 'string')
          .map((x) => ({ section: String(x.section || ''), suggestion: String(x.suggestion) }))
          .slice(0, 12)
      : [],
    priority_fixes: strArr(ai?.priority_fixes),
    improved_wording: Array.isArray(ai?.improved_wording)
      ? (ai!.improved_wording as Array<{ section: string; before: string; after: string }>)
          .filter((x) => x && typeof x.after === 'string')
          .map((x) => ({ section: String(x.section || ''), before: String(x.before || ''), after: String(x.after) }))
          .slice(0, 8)
      : [],
    fix_first: typeof ai?.fix_first === 'string' && ai.fix_first.trim() ? ai.fix_first.trim() : missing.length ? `Add the missing ${missing[0]} slide — investors screen for it fast.` : 'Sharpen the traction slide with concrete numbers.',
  };
}

/**
 * Generate an honest, investor-grade review from the mapped sections.
 * Deterministic fallback when the model refuses/times out.
 */
export async function generateReview(env: Env, userId: number, sections: DeckSection[], context?: { startup?: string }): Promise<DeckReview> {
  const filled = sections.filter((s) => s.content.trim());
  const deckText = filled.map((s) => `## ${s.label}\n${s.content}`).join('\n\n').slice(0, 16_000);
  const system =
    'You are a blunt but constructive seed-stage VC reviewing a founder\'s pitch deck. Be candid, specific, and useful — no fluff, no flattery, never rude. ' +
    'Respond ONLY with JSON matching this shape: {"overall_score": number (0-100), "summary": string, "strengths": string[], "weaknesses": string[], "missing_sections": string[], "red_flags": string[], "section_suggestions": [{"section": string, "suggestion": string}], "priority_fixes": string[], "improved_wording": [{"section": string, "before": string, "after": string}], "fix_first": string}. ' +
    'Ground every point in the deck text. Score harshly but fairly.';
  const user = [context?.startup ? `Startup context: ${context.startup}` : '', 'Pitch deck sections:', deckText || '(deck text is empty)', '', 'Return the review JSON now.']
    .filter(Boolean)
    .join('\n');
  try {
    const res = await aiRun(env, {
      task: 'dd_synthesis',
      userId,
      systemPrompt: system,
      messages: [{ role: 'user', content: user }],
      maxTokens: 1800,
      temperature: 0.5,
    });
    if (res.ok && res.output) {
      const parsed = parseJsonLoose<Partial<DeckReview>>(res.output);
      return normalizeReview(parsed, sections);
    }
  } catch {
    /* fall through */
  }
  return normalizeReview(null, sections);
}
