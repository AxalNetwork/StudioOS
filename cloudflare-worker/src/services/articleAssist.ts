/**
 * D1409 (#3695, part 1) — Eadwyn's writing options in the article editor:
 * what each option asks a model, and what of its answer becomes a proposal.
 * Pure: no binding, no fetch.
 *
 * Each option is one rail option on "<Profile> · Articles" (`ARTICLE_OPTIONS`),
 * run once through `run()` per press by `routes/article_assist.ts`. A run writes
 * one `ai_rail_proposals` row and never the article: Insert, Replace and Accept
 * place the proposal in the editor, and the editor's own save writes it.
 *
 * The model reads the article as it is stored (title, subtitle and body, cut to
 * `ARTICLE_TEXT_MAX`). The guard checks what the member typed for the press
 * (`guardTextOf`), not the article, which is the member's own text.
 */

export const ARTICLE_OPTION_KEYS = [
  'draft:article-outline',
  'draft:article-section',
  'rewrite:article',
  'draft:article-continue',
  'draft:article-headlines',
  'draft:article-seo',
  'draft:article-newsletter',
  'check:article-facts',
] as const;
export type ArticleOption = typeof ARTICLE_OPTION_KEYS[number];

/** The proposal kind each option leaves (`ai_rail_proposals.kind`). */
export const ARTICLE_OPTIONS: Record<ArticleOption, { kind: 'draft' | 'proposal' | 'note'; maxTokens: number }> = {
  'draft:article-outline': { kind: 'draft', maxTokens: 900 },
  'draft:article-section': { kind: 'draft', maxTokens: 1400 },
  'rewrite:article': { kind: 'proposal', maxTokens: 1600 },
  'draft:article-continue': { kind: 'draft', maxTokens: 900 },
  'draft:article-headlines': { kind: 'proposal', maxTokens: 300 },
  'draft:article-seo': { kind: 'proposal', maxTokens: 300 },
  'draft:article-newsletter': { kind: 'draft', maxTokens: 600 },
  'check:article-facts': { kind: 'note', maxTokens: 1200 },
};

export const ARTICLE_TONES = ['shorter', 'plainer', 'formal'] as const;
export type ArticleTone = typeof ARTICLE_TONES[number];

export const ARTICLE_TEXT_MAX = 12_000;
export const BRIEF_MAX = 1_000;
export const HEADING_MAX = 200;
export const SELECTION_MAX = 4_000;
export const HEADLINES_MAX = 5;
export const HEADLINE_MAX = 120;
export const SEO_TITLE_MAX = 120;
export const EXCERPT_MAX = 200;
export const SUMMARY_MAX = 1_200;
export const CLAIMS_MAX = 20;
const MARKDOWN_MAX = 8_000;

/** The role → profile names the rail uses (`PROFILE_OF_ROLE`, `frontend/src/lib/railPages.js`). */
const PROFILE_OF_ROLE: Record<string, string> = {
  founder: 'Founder', investor: 'Investor', advisor: 'Advisor', partner: 'Operating Partner',
  admin: 'Admin', branch_admin: 'Admin', super_admin: 'Super Admin',
};

/** The rail page an article run is filed under: `<Profile> · Articles`. */
export function articlePage(role: unknown): string {
  return `${PROFILE_OF_ROLE[String(role ?? '')] ?? 'Member'} · Articles`;
}

export const articleRecord = (id: number) => `articles:${id}`;

export type ArticleInput = {
  brief?: string;
  heading?: string;
  selection?: string;
  tone?: ArticleTone;
  cursor_context?: string;
};

type Field = { name: keyof ArticleInput; max: number; required: boolean };
const FIELDS: Record<ArticleOption, Field[]> = {
  'draft:article-outline': [{ name: 'brief', max: BRIEF_MAX, required: true }],
  'draft:article-section': [{ name: 'heading', max: HEADING_MAX, required: true }, { name: 'brief', max: BRIEF_MAX, required: false }],
  'rewrite:article': [{ name: 'selection', max: SELECTION_MAX, required: true }],
  'draft:article-continue': [{ name: 'cursor_context', max: SELECTION_MAX, required: true }],
  'draft:article-headlines': [],
  'draft:article-seo': [],
  'draft:article-newsletter': [],
  'check:article-facts': [{ name: 'selection', max: SELECTION_MAX, required: false }],
};

export const isArticleOption = (v: unknown): v is ArticleOption => (ARTICLE_OPTION_KEYS as readonly string[]).includes(v as string);

/** The press's input, checked, or the field it refuses and why. */
export function inputOf(option: ArticleOption, raw: unknown): { input: ArticleInput } | { field: string; error: string } {
  const body = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const input: ArticleInput = {};
  for (const f of FIELDS[option]) {
    const v = typeof body[f.name] === 'string' ? (body[f.name] as string).trim() : '';
    if (!v) {
      if (f.required) return { field: f.name, error: `${f.name} required` };
      continue;
    }
    if (v.length > f.max) return { field: f.name, error: `${f.name} is at most ${f.max} characters` };
    (input as any)[f.name] = v;
  }
  if (option === 'rewrite:article') {
    if (!(ARTICLE_TONES as readonly string[]).includes(body.tone as string)) return { field: 'tone', error: `tone must be one of ${ARTICLE_TONES.join(', ')}` };
    input.tone = body.tone as ArticleTone;
  }
  return { input };
}

/** What the guard checks: only what the member typed for the press. */
export function guardTextOf(input: ArticleInput): string {
  return [input.brief, input.heading, input.selection, input.cursor_context].filter(Boolean).join('\n\n');
}

export type ArticleText = { title?: string | null; subtitle?: string | null; body_markdown?: string | null };

/** The article as the model reads it: title, subtitle and body, cut to `ARTICLE_TEXT_MAX`. */
export function articleTextOf(a: ArticleText): string {
  const parts = [a.title ? `# ${a.title}` : '', a.subtitle ? `_${a.subtitle}_` : '', a.body_markdown || ''].filter(Boolean);
  return parts.join('\n\n').slice(0, ARTICLE_TEXT_MAX);
}

const SYSTEM = [
  'You help a member write an article for the Axal network.',
  'Write in plain, clear English. Keep the author\'s meaning and voice.',
  'Do not invent quotes, people, companies, results or statistics.',
  'Return only what is asked: no preface, no explanation.',
].join(' ');

const TONE_ASK: Record<ArticleTone, string> = {
  shorter: 'Rewrite this passage shorter, keeping every point it makes.',
  plainer: 'Rewrite this passage in plainer words, for a reader new to the subject.',
  formal: 'Rewrite this passage in a more formal register.',
};

/** The messages one press sends. */
export function messageOf(option: ArticleOption, article: ArticleText, input: ArticleInput): { system: string; user: string } {
  const text = articleTextOf(article);
  const withArticle = (ask: string) => `${ask}\n\nThe article so far:\n${text || '(empty)'}`;
  switch (option) {
    case 'draft:article-outline':
      return { system: SYSTEM, user: withArticle(`Draft an outline for this article as a Markdown list of section headings, each with one line on what it covers.\n\nThe author's brief:\n${input.brief}`) };
    case 'draft:article-section':
      return { system: SYSTEM, user: withArticle(`Draft the section titled "${input.heading}" in Markdown. Do not repeat the heading.${input.brief ? `\n\nWhat it should cover:\n${input.brief}` : ''}`) };
    case 'rewrite:article':
      return { system: SYSTEM, user: `${TONE_ASK[input.tone!]} Return only the rewritten passage.\n\nThe passage:\n${input.selection}` };
    case 'draft:article-continue':
      return { system: SYSTEM, user: withArticle(`Continue the article from where the author stopped, for one or two paragraphs in Markdown. Do not repeat what is written.\n\nThe text just before the cursor:\n${input.cursor_context}`) };
    case 'draft:article-headlines':
      return { system: SYSTEM, user: withArticle(`Suggest ${HEADLINES_MAX} headlines for this article, each at most ${HEADLINE_MAX} characters. Answer as a JSON array of strings.`) };
    case 'draft:article-seo':
      return { system: SYSTEM, user: withArticle(`Write a search title of at most ${SEO_TITLE_MAX} characters and a summary of at most ${EXCERPT_MAX} characters for this article. Answer as JSON: {"seo_title": "...", "excerpt": "..."}.`) };
    case 'draft:article-newsletter':
      return { system: SYSTEM, user: withArticle(`Summarise this article for a newsletter in at most ${SUMMARY_MAX} characters of Markdown.`) };
    case 'check:article-facts':
      return {
        system: SYSTEM,
        user: withArticle(`List the claims in ${input.selection ? 'the passage below' : 'this article'} that a reader would want a source for: figures, dates, quotes and statements of fact. Do not judge whether they are true. Answer as JSON: {"claims": [{"quote": "the words, exactly as written", "why": "what kind of source it needs"}]}.${input.selection ? `\n\nThe passage:\n${input.selection}` : ''}`),
      };
  }
}

/** A model's text without a code fence, a "Here is…" preface or wrapping quotes. */
export function cleanText(raw: unknown, max: number): string {
  let s = typeof raw === 'string' ? raw.trim() : '';
  s = s.replace(/^```(?:markdown|md)?\s*/i, '').replace(/\s*```$/i, '').trim();
  s = s.replace(/^(?:sure[,!.]?\s*)?here(?:'s| is| are)[^\n:]{0,80}:\s*\n?/i, '').trim();
  if (/^".*"$/s.test(s) && !s.slice(1, -1).includes('"')) s = s.slice(1, -1).trim();
  return s.slice(0, max).trim();
}

/** The first JSON object or array in a model's answer, or null. */
export function jsonOf<T>(raw: unknown): T | null {
  const s = typeof raw === 'string' ? raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim() : '';
  for (const [open, close] of [['{', '}'], ['[', ']']] as const) {
    const a = s.indexOf(open);
    const b = s.lastIndexOf(close);
    if (a === -1 || b <= a) continue;
    try { return JSON.parse(s.slice(a, b + 1)) as T; } catch { /* try the other shape */ }
  }
  return null;
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max).trim() : '');

/** The proposal one run's answer makes, or null when it parses to nothing. */
export function payloadOf(option: ArticleOption, output: unknown, input: ArticleInput): Record<string, unknown> | null {
  switch (option) {
    case 'draft:article-outline': {
      const outline_markdown = cleanText(output, MARKDOWN_MAX);
      return outline_markdown ? { outline_markdown } : null;
    }
    case 'draft:article-section': {
      const markdown = cleanText(output, MARKDOWN_MAX);
      return markdown ? { heading: input.heading, markdown } : null;
    }
    case 'rewrite:article': {
      const after = cleanText(output, MARKDOWN_MAX);
      return after ? { before: input.selection, after, tone: input.tone } : null;
    }
    case 'draft:article-continue': {
      const markdown = cleanText(output, MARKDOWN_MAX);
      return markdown ? { markdown } : null;
    }
    case 'draft:article-headlines': {
      const parsed = jsonOf<unknown>(output);
      const list = Array.isArray(parsed) ? parsed : Array.isArray((parsed as any)?.headlines) ? (parsed as any).headlines : [];
      const headlines = [...new Set(list.map((h: unknown) => str(h, HEADLINE_MAX)).filter(Boolean))].slice(0, HEADLINES_MAX) as string[];
      return headlines.length ? { headlines } : null;
    }
    case 'draft:article-seo': {
      const parsed = jsonOf<any>(output);
      const seo_title = str(parsed?.seo_title, SEO_TITLE_MAX);
      const excerpt = str(parsed?.excerpt, EXCERPT_MAX);
      return seo_title || excerpt ? { seo_title, excerpt } : null;
    }
    case 'draft:article-newsletter': {
      const summary_markdown = cleanText(output, SUMMARY_MAX);
      return summary_markdown ? { summary_markdown } : null;
    }
    case 'check:article-facts': {
      const parsed = jsonOf<any>(output);
      const list: unknown[] = Array.isArray(parsed?.claims) ? parsed.claims : Array.isArray(parsed) ? parsed : [];
      const claims = list
        .map((x: any) => ({ quote: str(x?.quote, 300), why: str(x?.why, 300), needs_source: true as const }))
        .filter((x) => x.quote)
        .slice(0, CLAIMS_MAX);
      return claims.length ? { claims } : null;
    }
  }
}
