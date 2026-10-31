/**
 * D1408 (#3694) — the Article Authoring canvas's rules, pure.
 *
 * The canvas is `design/incoming/Article Authoring Page.dc.html` (boards AR1–AR6).
 * Everything here is read by the page's components and by
 * `frontend/test/article_authoring_d1408.test.mjs`. No request, no React.
 */

/* ---------- AR1 · the library ---------- */

/**
 * The library's four tabs, by status. `approved` with a `publish_at` is
 * Scheduled; `/api/articles/mine` does not return `publish_at` yet (#3694's
 * slot task), so an approved article sits under In review until it does.
 */
export const LIBRARY_TABS = Object.freeze([
  { key: 'drafts', label: 'Drafts' },
  { key: 'review', label: 'In review' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'published', label: 'Published' },
]);

export function tabOf(a) {
  const s = a?.status;
  if (s === 'published') return 'published';
  if (s === 'approved' && a.publish_at) return 'scheduled';
  if (s === 'submitted' || s === 'in_review' || s === 'approved') return 'review';
  return 'drafts';
}

export function tabCounts(items = []) {
  const out = { drafts: 0, review: 0, scheduled: 0, published: 0 };
  for (const a of items) out[tabOf(a)] += 1;
  return out;
}

export const LIBRARY_SORTS = Object.freeze([
  { key: 'edited', label: 'Last edited' },
  { key: 'title', label: 'Title' },
  { key: 'words', label: 'Words' },
]);

const ts = (v) => {
  if (v == null || v === '') return 0;
  const n = typeof v === 'number' ? v : Date.parse(/Z|[+-]\d\d:?\d\d$/.test(String(v)) ? String(v) : `${String(v).replace(' ', 'T')}Z`);
  return Number.isFinite(n) ? n : 0;
};

/** The rows the library's table shows: one tab, a search over title, subtitle and tags, a sort. */
export function libraryRows(items = [], { tab = 'drafts', query = '', tag = '', sort = 'edited' } = {}) {
  const q = query.trim().toLowerCase();
  const rows = items.filter((a) => tabOf(a) === tab)
    .filter((a) => !tag || (a.tags || []).includes(tag))
    .filter((a) => !q || [a.title, a.subtitle, ...(a.tags || [])].some((v) => String(v || '').toLowerCase().includes(q)));
  const by = {
    edited: (a, b) => ts(b.updated_at) - ts(a.updated_at),
    title: (a, b) => String(a.title || '').localeCompare(String(b.title || '')),
    words: (a, b) => (Number(b.word_count) || 0) - (Number(a.word_count) || 0),
  }[sort] || (() => 0);
  return [...rows].sort(by);
}

/** Every tag on the member's articles, for the Tag filter. */
export function libraryTags(items = []) {
  return [...new Set(items.flatMap((a) => a.tags || []))].sort();
}

/** The two stat cards the stored rows can answer: published in the last 30 days, and views. */
export function libraryStats(items = [], now = Date.now()) {
  const since = now - 30 * 86_400_000;
  const published = items.filter((a) => a.status === 'published');
  return {
    publishedLast30: published.filter((a) => ts(a.published_at) >= since).length,
    views: published.reduce((n, a) => n + (Number(a.views) || 0), 0),
  };
}

/* ---------- AR3 · the writing panel ---------- */

/** Dollars from micro-dollars, as the canvas prints them ($0.006, $0.024, $1.20). */
export function usd(micro) {
  const n = Number(micro);
  if (!Number.isFinite(n)) return null;
  const d = n / 1_000_000;
  return `$${d < 0.1 ? d.toFixed(3) : d.toFixed(2)}`;
}

/** The addendum's cost line before a run. */
export function holdsLine(holdMicro) {
  const h = usd(holdMicro);
  return h ? `Holds up to ${h} · you pay what it uses` : 'You pay what it uses';
}

/** The proposal card's cost line after a run. A charge the server could not read is null, never $0. */
export function chargedLine(chargedMicro, holdMicro) {
  const c = chargedMicro == null ? null : usd(chargedMicro);
  const h = usd(holdMicro);
  if (!c) return 'Charge not recorded yet · see Usage';
  return h ? `Charged ${c} of ${h} held · the rest is released` : `Charged ${c}`;
}

export const REWRITE_TONES = Object.freeze([
  { key: 'shorter', label: 'Shorter' },
  { key: 'plainer', label: 'Plainer' },
  { key: 'formal', label: 'More formal' },
]);

/**
 * The panel's eight actions (D1409 §2), in the canvas's order. `needs` is
 * what the press must carry: `brief` asks for one line, `heading` for a
 * heading, `selection` for selected text, `cursor` for text before the caret.
 */
export const ARTICLE_ACTIONS = Object.freeze([
  { option: 'draft:article-outline', label: 'Outline this article', sub: 'From a one-line brief', needs: 'brief' },
  { option: 'draft:article-section', label: 'Draft a section', sub: 'Under a heading you name', needs: 'heading' },
  { option: 'rewrite:article', label: 'Rewrite the selection', sub: 'Shorter, plainer or more formal', needs: 'selection' },
  { option: 'draft:article-continue', label: 'Continue writing', sub: 'From where your cursor is', needs: 'cursor' },
  { option: 'draft:article-headlines', label: 'Suggest headlines', sub: 'Up to five titles', needs: null },
  { option: 'draft:article-seo', label: 'Write the search title and excerpt', sub: 'For search and social cards', needs: null },
  { option: 'draft:article-newsletter', label: 'Summarise for a newsletter', sub: 'A short summary you can paste', needs: null },
  { option: 'check:article-facts', label: 'Check facts', sub: 'Lists claims that need a source', needs: 'selection-optional' },
]);

export const actionFor = (option) => ARTICLE_ACTIONS.find((a) => a.option === option) || null;

/** The `input` a press sends, or `{ error }` naming what is missing. */
export function assistInput(option, { brief = '', heading = '', selection = '', cursorContext = '', tone = 'shorter' } = {}) {
  const a = actionFor(option);
  if (!a) return { error: 'unknown_option' };
  if (a.needs === 'brief') return brief.trim() ? { input: { brief: brief.trim().slice(0, 1000) } } : { error: 'Write a one-line brief first.' };
  if (a.needs === 'heading') return heading.trim() ? { input: { heading: heading.trim().slice(0, 200), ...(brief.trim() ? { brief: brief.trim().slice(0, 1000) } : {}) } } : { error: 'Name the section’s heading first.' };
  if (a.needs === 'selection') return selection.trim() ? { input: { selection: selection.slice(0, 4000), tone } } : { error: 'Select the text to rewrite first.' };
  if (a.needs === 'cursor') return cursorContext.trim() ? { input: { cursor_context: cursorContext.slice(-4000) } } : { error: 'Place your cursor after some text first.' };
  if (a.needs === 'selection-optional') return { input: selection.trim() ? { selection: selection.slice(0, 4000) } : {} };
  return { input: {} };
}

/** The Markdown a proposal would place, or null when it places nothing (headlines, SEO, facts). */
export function proposalMarkdown(p) {
  const pl = p?.payload || {};
  if (p?.rail_option === 'draft:article-outline' || pl.outline_markdown) return pl.outline_markdown || null;
  if (pl.heading && pl.markdown) return `## ${pl.heading}\n\n${pl.markdown}`;
  if (pl.after) return pl.after;
  if (pl.summary_markdown) return pl.summary_markdown;
  if (pl.markdown) return pl.markdown;
  return null;
}

/**
 * Places `text` in `body`. `replace` swaps the range [start, end) (a
 * rewrite's selection); `below` inserts after the paragraph that holds `end`.
 * Returns the new body and the caret.
 */
export function placeText(body = '', text = '', { start = 0, end = start, mode = 'below' } = {}) {
  const s = Math.max(0, Math.min(start, body.length));
  const e = Math.max(s, Math.min(end, body.length));
  if (mode === 'replace') {
    return { body: body.slice(0, s) + text + body.slice(e), caret: s + text.length };
  }
  const nl = body.indexOf('\n\n', e);
  const at = nl === -1 ? body.length : nl;
  const before = body.slice(0, at).replace(/\s+$/, '');
  const block = `${before ? '\n\n' : ''}${text.trim()}\n`;
  const rest = body.slice(at).replace(/^\s+/, '');
  return { body: before + block + (rest ? `\n${rest}` : ''), caret: before.length + block.length };
}

/** The sentence a refused press shows (D1409's codes), never the server's raw error. */
export function refusalMessage(err) {
  const code = err?.data?.error || err?.data?.code || err?.data?.refusal || err?.code || '';
  if (/^budget_|spend_limit|insufficient/.test(code) || err?.status === 402) return { code: code || 'budget', text: 'Your AI balance cannot cover this. Add tokens, then try again.', topUp: true };
  if (code === 'ai_paused') return { code, text: 'AI is paused for your account right now.' };
  if (code === 'assist_off') return { code, text: 'AI assistance is off on this page. Turn it on in the AIRail.' };
  if (code === 'real_person') return { code, text: err?.data?.message || 'Eadwyn does not draw real people. Describe a scene, an object or an idea instead.' };
  if (code === 'nothing_proposed') return { code, text: 'Eadwyn had nothing to propose this time. You were charged only what the run used.' };
  if (code === 'already_published') return { code, text: 'This article is published; Eadwyn does not change a published article.' };
  if (code === 'storage_full' || err?.status === 413) return { code: code || 'storage_full', text: 'Your storage plan is full. Free some space or upgrade, then try again.' };
  if (code === 'model_unavailable' || code === 'storage_unavailable') return { code, text: 'Eadwyn could not run just now. Nothing was charged; try again in a moment.' };
  if (code === 'invalid_input') return { code, text: 'Check what you entered and try again.' };
  return { code: code || 'failed', text: 'That did not work. Try again.' };
}

/* ---------- AR2 · the format bar ---------- */

/**
 * The format bar's and slash menu's edits on Markdown: wrap the selection, or
 * prefix its lines. Returns the new body and the new selection.
 */
export function formatMarkdown(body = '', start = 0, end = start, kind = 'bold') {
  const sel = body.slice(start, end);
  const wrap = (l, r, ph) => {
    const inner = sel || ph;
    const text = `${l}${inner}${r}`;
    return { body: body.slice(0, start) + text + body.slice(end), start: start + l.length, end: start + l.length + inner.length };
  };
  const lineStart = body.lastIndexOf('\n', start - 1) + 1;
  const prefix = (fn) => {
    const block = body.slice(lineStart, end) || '';
    const lines = (block || '').split('\n').map(fn);
    const text = lines.join('\n');
    return { body: body.slice(0, lineStart) + text + body.slice(end), start: lineStart, end: lineStart + text.length };
  };
  switch (kind) {
    case 'bold': return wrap('**', '**', 'bold text');
    case 'italic': return wrap('*', '*', 'italic text');
    case 'code': return sel.includes('\n') ? wrap('```\n', '\n```', 'code') : wrap('`', '`', 'code');
    case 'link': return wrap('[', '](https://)', 'link text');
    case 'h2': return prefix((l) => `## ${l.replace(/^#+\s*/, '')}`);
    case 'h3': return prefix((l) => `### ${l.replace(/^#+\s*/, '')}`);
    case 'quote': return prefix((l) => `> ${l.replace(/^>\s?/, '')}`);
    case 'bulleted': return prefix((l) => `- ${l.replace(/^[-*]\s+/, '')}`);
    case 'numbered': { let i = 0; return prefix((l) => `${(i += 1)}. ${l.replace(/^\d+\.\s+/, '')}`); }
    case 'paragraph': return prefix((l) => l.replace(/^(#+|>|[-*]|\d+\.)\s+/, ''));
    default: return { body, start, end };
  }
}

/** The format bar's buttons (AR2's floating bar) and the slash menu's blocks the Markdown store renders today. */
export const FORMAT_BUTTONS = Object.freeze([
  { kind: 'bold', label: 'Bold', short: 'B' },
  { kind: 'italic', label: 'Italic', short: 'I' },
  { kind: 'link', label: 'Link', short: 'Link' },
  { kind: 'h2', label: 'Heading', short: 'H2' },
  { kind: 'quote', label: 'Quote', short: '“”' },
  { kind: 'code', label: 'Code', short: '</>' },
]);

export const SLASH_BLOCKS = Object.freeze([
  { kind: 'paragraph', label: 'Paragraph' },
  { kind: 'h2', label: 'Heading' },
  { kind: 'h3', label: 'Subheading' },
  { kind: 'quote', label: 'Quote' },
  { kind: 'bulleted', label: 'Bulleted list' },
  { kind: 'numbered', label: 'Numbered list' },
  { kind: 'code', label: 'Code' },
]);

/* ---------- AR4 · the image sheet ---------- */

export const IMAGE_STYLES = Object.freeze([
  { key: 'photo', label: 'Photo' },
  { key: 'illustration', label: 'Illustration' },
  { key: 'diagram', label: 'Diagram' },
  { key: 'abstract', label: 'Abstract' },
]);

export const IMAGE_ASPECTS = Object.freeze([
  { key: '16:9', label: '16:9', note: 'cover' },
  { key: '4:3', label: '4:3' },
  { key: '1:1', label: '1:1' },
  { key: '3:4', label: '3:4' },
]);

export const IMAGE_PROMPT_MAX = 400;

/** The ask the image routes take, or `{ error }`. */
export function imageAsk({ prompt = '', style = 'illustration', aspect = '16:9', count = 4 } = {}) {
  const p = prompt.trim();
  if (p.length < 3) return { error: 'Describe the image in a few words.' };
  if (p.length > IMAGE_PROMPT_MAX) return { error: `Keep the description under ${IMAGE_PROMPT_MAX} characters.` };
  if (!IMAGE_STYLES.some((s) => s.key === style)) return { error: 'Pick a style.' };
  if (!IMAGE_ASPECTS.some((a) => a.key === aspect)) return { error: 'Pick an aspect ratio.' };
  const n = Math.max(1, Math.min(4, Math.floor(Number(count) || 1)));
  return { ask: { prompt: p, style, aspect, count: n } };
}

/** The Markdown an image places in the body. */
export const imageMarkdown = (img, alt = '') => `![${String(alt || '').replace(/[[\]]/g, '')}](${img.url})`;

/* ---------- AR5 · the publish sheet ---------- */

export const SEARCH_TITLE_MAX = 60;
export const SEARCH_DESCRIPTION_MAX = 200;

/** What a search result would show: the title, the address and the description. */
export function searchPreview({ title = '', seo_title = '', excerpt = '', subtitle = '', slug = '' }, origin = 'https://axal.vc') {
  const t = (seo_title || title || 'Untitled').trim();
  const d = (excerpt || subtitle || '').trim();
  return {
    title: t.length > SEARCH_TITLE_MAX ? `${t.slice(0, SEARCH_TITLE_MAX - 1)}…` : t,
    url: `${origin.replace(/\/$/, '')}/articles/${slug || 'your-article'}`,
    description: d.length > 160 ? `${d.slice(0, 159)}…` : d,
    titleTooLong: t.length > SEARCH_TITLE_MAX,
  };
}

/** Who can see a draft, under the editor (AR2's footer). */
export function draftAudience(status) {
  if (status === 'published') return 'Anyone with the link can read this article.';
  if (['submitted', 'in_review', 'approved'].includes(status)) return 'Only you and the review team can see this article.';
  return 'Only you can see this draft until you send it for review.';
}
