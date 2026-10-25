/**
 * D1021 (#2858) — Cap table part 6: Eadwyn's read of a signed SAFE, SPA or grant.
 *
 * A person points at a file in the venture's data room. Its text is read page
 * by page (`env.AI.toMarkdown`, which heads each page "### Page N"), and one
 * metered run (`aiRouter.run`, the Cap table rail's document option) says where
 * the terms are. What comes back is a draft, kept in D780's rail proposals
 * (`proposeRail`), that lands only when a person accepts it and records it
 * through part 2's own routes (D778's proposal path). Nothing here writes the
 * record.
 *
 * NON-MONEY TERMS ONLY. The draft holds the holder, the instrument type, the
 * basis, MFN and the date the document was executed, each with the page it
 * came from; a term the run did not find reads "Not found in the document".
 * For each money field (amount, valuation cap, discount, price per share,
 * shares) it holds only the page it sits on, never the figure: #2431's
 * never-fill rule, and owner question 9 read as B until it is answered. The
 * screen builds the draft from an allow-list, so a figure the model writes has
 * no key to land in.
 */
import type { Env } from '../types';
import { run as aiRun, type RunResult } from './aiRouter';
import { AI_SURFACE } from './aiSurfaces';
import { proposeRail, withdrawRail } from './railProposals';
import { RecordError } from './capTableRecord';

export const DOCUMENT_PAGE = 'Founder · Raise · Cap table';
export const DOCUMENT_OPTION = 'draft:raise/document-terms';
export const NOT_FOUND = 'Not found in the document';

/** The non-money terms, in the order CT11c draws them. */
export const TERMS = [
  { key: 'holder', label: 'Holder' },
  { key: 'instrument_type', label: 'Instrument type' },
  { key: 'basis', label: 'Basis' },
  { key: 'mfn', label: 'MFN' },
  { key: 'executed_on', label: 'Date signed' },
] as const;

/** The money fields: a page each, never a figure. */
export const AMOUNTS = [
  { key: 'amount', label: 'Amount' },
  { key: 'valuation_cap', label: 'Valuation cap' },
  { key: 'discount', label: 'Discount' },
  { key: 'price_per_share', label: 'Price per share' },
  { key: 'shares', label: 'Shares' },
] as const;

const INSTRUMENTS = ['safe', 'note', 'priced', 'grant'] as const;
const BASES = ['post_money', 'pre_money'] as const;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_PAGE_CHARS = 6000;
const MAX_PAGES = 40;

export interface Page { page: number; text: string }

/** Split the converter's markdown on its "### Page N" headings. A document with none is one page. */
export function pagesOf(markdown: string): Page[] {
  const parts = String(markdown || '').split(/^#{1,6}\s*Page\s+(\d+)\s*$/im);
  const pages: Page[] = [];
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const n = Number(parts[i]);
    const text = parts[i + 1].trim();
    if (Number.isSafeInteger(n) && n > 0) pages.push({ page: n, text });
  }
  if (!pages.length && String(markdown || '').trim()) pages.push({ page: 1, text: String(markdown).trim() });
  return pages;
}

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
// A holder is a name. A currency sign, a percent, or a run of three digits is a figure, not a name.
const LOOKS_LIKE_MONEY = /[$€£¥₹%]|\d{3}/;

function pageIn(v: unknown, pages: Page[]): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,4}$/.test(v.trim()) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && pages.some((p) => p.page === n) ? n : null;
}

function realDay(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null;
}

/** One term's value, checked against what that term may hold. Anything else is not found. */
function termValue(key: string, v: unknown, page: Page | undefined): string | boolean | null {
  if (!page) return null;
  switch (key) {
    case 'holder': {
      if (typeof v !== 'string') return null;
      const name = v.trim().slice(0, 200);
      // Eadwyn never states what the document does not hold: the name must be on the page it cites.
      if (!name || LOOKS_LIKE_MONEY.test(name) || !squash(page.text).includes(squash(name))) return null;
      return name;
    }
    case 'instrument_type': return typeof v === 'string' && (INSTRUMENTS as readonly string[]).includes(v) ? v : null;
    case 'basis': return typeof v === 'string' && (BASES as readonly string[]).includes(v) ? v : null;
    case 'mfn': return typeof v === 'boolean' ? v : null;
    case 'executed_on': return realDay(v);
    default: return null;
  }
}

/**
 * The model's answer → the draft. Built only from the allow-list above: each
 * term is `{ value, page }` when it passes its check and cites a page the
 * document has, and each money field is its page alone. No other key, and no
 * figure, survives.
 */
export function screenRead(answer: unknown, pages: Page[]) {
  const a = answer && typeof answer === 'object' && !Array.isArray(answer) ? answer as Record<string, unknown> : {};
  const terms = TERMS.map((t) => {
    const raw = a[t.key] && typeof a[t.key] === 'object' ? a[t.key] as Record<string, unknown> : {};
    const page = pageIn(raw.page, pages);
    const value = page == null ? null : termValue(t.key, raw.value, pages.find((p) => p.page === page));
    return value == null
      ? { key: t.key, label: t.label, found: false, value: null, page: null, note: NOT_FOUND }
      : { key: t.key, label: t.label, found: true, value, page, note: null };
  });
  const amounts = AMOUNTS.map((m) => {
    const page = pageIn(a[`${m.key}_page`], pages);
    return page == null
      ? { key: m.key, label: m.label, found: false, page: null, note: NOT_FOUND }
      : { key: m.key, label: m.label, found: true, page, note: null };
  });
  return { terms, amounts };
}

const SYSTEM = `You are Eadwyn, reading a signed financing document (a SAFE, a share purchase agreement, a convertible note or an option grant) for the venture's cap table.
Say where its terms are. Answer with one JSON object and nothing else:
{"holder":{"value":"<the investor's or grantee's name exactly as written>","page":<n>},
 "instrument_type":{"value":"safe"|"note"|"priced"|"grant","page":<n>},
 "basis":{"value":"post_money"|"pre_money","page":<n>},
 "mfn":{"value":true|false,"page":<n>},
 "executed_on":{"value":"YYYY-MM-DD","page":<n>},
 "amount_page":<n>,"valuation_cap_page":<n>,"discount_page":<n>,"price_per_share_page":<n>,"shares_page":<n>}
Rules: <n> is the page number the text is under. Use null for anything the document does not state. Never write an amount, a valuation cap, a discount, a price or a share count: for those give only the page they are on. Do not infer a term the text does not state.`;

function promptOf(name: string, pages: Page[]) {
  return `Document: ${name}\n\n` + pages.map((p) => `--- Page ${p.page} ---\n${p.text.slice(0, MAX_PAGE_CHARS)}`).join('\n\n');
}

function parseJson(s: string): unknown {
  const m = /\{[\s\S]*\}/.exec(String(s || ''));
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

type Converter = { toMarkdown?: (docs: unknown, opts?: unknown) => Promise<unknown> };

async function documentPages(env: Env, file: { r2_key: string; name: string; content_type: string | null }): Promise<Page[]> {
  const ai = (env as unknown as { AI?: Converter }).AI;
  if (!env.FILES || !ai || typeof ai.toMarkdown !== 'function') {
    throw new RecordError(503, 'document_read_unavailable', 'Reading documents is not configured here.');
  }
  const obj = await env.FILES.get(file.r2_key);
  if (!obj) throw new RecordError(404, 'unknown_document', 'That document’s file is no longer in the data room.');
  const bytes = await obj.arrayBuffer();
  if (bytes.byteLength > MAX_FILE_BYTES) throw new RecordError(413, 'too_large', 'That document is larger than Eadwyn reads.');
  const out = await ai.toMarkdown(
    [{ name: file.name, blob: new Blob([bytes], { type: file.content_type || 'application/pdf' }) }],
    { conversionOptions: { pdf: { metadata: false } } },
  );
  const md = Array.isArray(out) ? String((out[0] as { data?: string })?.data ?? '') : String((out as { data?: string })?.data ?? '');
  return pagesOf(md).slice(0, MAX_PAGES);
}

export const documentRecord = (projectId: number) => `project:${projectId}`;

/**
 * POST /record/:projectId/document-read — `{ document_ref: 'data_room_files:<id>' }`.
 * One metered run, charged to the member who pressed. Answers the draft, or the
 * router's refusal (Manual, budget, guard) through `refuseRun` in the route.
 */
export async function readDocumentTerms(env: Env, projectId: number, userId: number, body: Record<string, unknown>, rail: { page: string; option?: string | null; record?: string | null }) {
  const ref = typeof body.document_ref === 'string' ? body.document_ref.trim() : '';
  const m = /^data_room_files:([1-9]\d{0,15})$/.exec(ref);
  if (!m) throw new RecordError(400, 'bad_document_ref', 'Pick a document from the venture’s data room (data_room_files:<id>).', { field: 'document_ref' });
  const file = await env.DB.prepare('SELECT id, name, r2_key, content_type FROM data_room_files WHERE id = ? AND project_id = ?')
    .bind(Number(m[1]), projectId).first<{ id: number; name: string; r2_key: string; content_type: string | null }>();
  if (!file) throw new RecordError(400, 'unknown_document', 'That document is not this venture’s.', { field: 'document_ref' });
  const pages = await documentPages(env, file);
  if (!pages.length) throw new RecordError(422, 'nothing_to_read', 'Eadwyn found no text in that document.');

  const prompt = promptOf(file.name, pages);
  const result: RunResult = await aiRun(env, {
    task: 'rail_legal',
    userId,
    surface: AI_SURFACE.raiseCapTable,
    rail,
    systemPrompt: SYSTEM,
    messages: [{ role: 'user', content: prompt }],
    // The member's own upload: an unsafe verdict on it is marked, not withheld.
    guardText: prompt,
    guardOutput: 'mark',
    temperature: 0,
    maxTokens: 600,
  });
  if (!result.ok || !result.output) return { result, draft: null };

  const { terms, amounts } = screenRead(parseJson(result.output), pages);
  const record = documentRecord(projectId);
  // A new read replaces the draft the member's last read on this venture left open.
  await withdrawRail(env, userId, DOCUMENT_OPTION, record);
  const payload = { document_ref: ref, document_name: file.name, pages: pages.length, terms, amounts };
  const row = await proposeRail(env, {
    userId, page: DOCUMENT_PAGE, option: DOCUMENT_OPTION, record, kind: 'draft', payload,
    model: result.usage?.model ?? null, usageLogId: result.usageLogId ?? null,
  });
  return { result, draft: { uid: row.uid, ...payload } };
}
