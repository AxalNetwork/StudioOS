/**
 * Task #2 — News markdown helpers.
 *
 * - `renderMarkdown(md)` produces sanitised HTML for the public reader.
 *   Minimal in-house renderer (no external deps in the worker bundle):
 *   supports headings, bold/italic, links, lists, code blocks, blockquotes,
 *   inline code and paragraphs. Any raw HTML in the input is HTML-escaped
 *   before tokenisation, so the output can never contain attacker-supplied
 *   tags. Links are rel="noopener nofollow" and target="_blank".
 *
 * - `slugify(title)` makes a URL-safe slug.
 *
 * - `wordsAndMinutes(md)` returns the word count + read-time estimate.
 *
 * - `snapshotRevision()` writes a row to `article_revisions`.
 *
 * - `bustArticleEdgeCache()` is the ONLY cache buster. D166 deleted its
 *   news-shaped twin, `bustEdgeCache`, whose two callers both lived in the
 *   retired `admin_news.ts`. Nothing was lost with it: Task #3 had already
 *   made this function a strict superset, busting the deprecated `/api/news*`
 *   keys alongside the `/api/articles*` ones. An exported function with no
 *   caller is invisible to `noUnusedLocals`, so it would have survived every
 *   guard in the repo.
 */
import type { Env } from '../types';

export function slugify(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80) || `article-${Date.now()}`;
}

export function wordsAndMinutes(md: string): { words: number; minutes: number } {
  const words = (md || '').trim().split(/\s+/).filter(Boolean).length;
  return { words, minutes: Math.max(1, Math.round(words / 220)) };
}

// Inline-image filenames are minted by POST /api/articles/:id/image as
// `img-<uuid>.<ext>`. The GET serving route validates the path segment against
// this exact shape so a crafted filename can't escape the article's R2 prefix
// (the integer :id + this anchored pattern together block path traversal).
export function isValidArticleImageName(name: string): boolean {
  return typeof name === 'string' && /^img-[0-9a-f-]+\.(jpg|png|webp|gif)$/i.test(name);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inline(s: string): string {
  // Inline transforms operate on already-escaped HTML.
  // Order matters: code spans first (so we don't re-process their contents),
  // then images, then links, then bold, then italic.
  let out = s;
  out = out.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, url) => {
    // Allow absolute http(s) OR root-relative ("/api/articles/:id/image/…")
    // URLs only. The (?!\/) guard rejects protocol-relative "//evil.com".
    if (!/^https?:\/\//i.test(url) && !/^\/(?!\/)/.test(url)) return '';
    return `<img alt="${alt}" src="${url}" loading="lazy" />`;
  });
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, url) => {
    // Same URL policy as images — the (?!\/) closes the protocol-relative
    // ("//evil.com") bypass that a bare startsWith('/') previously allowed.
    if (!/^https?:\/\//i.test(url) && !/^\/(?!\/)/.test(url)) return text;
    return `<a href="${url}" rel="noopener nofollow" target="_blank">${text}</a>`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  return out;
}

/**
 * D1410 (#3893) — the three blocks the article editor's Insert… menu adds
 * beside the CommonMark ones. The body stays Markdown (S1's pick B(a)), so
 * each has a Markdown form, rendered here and, for the editor's preview, by
 * `frontend/src/pages/articles/articleBlocks.js`, which draws the same HTML.
 *
 *   · divider:   a line holding only `---`                → `<hr>`
 *   · callout:   a blockquote opening `> [!note|tip|warning]`
 *                → `<aside class="article-callout" data-kind="…">`
 *   · link card: a paragraph holding only `[card](https://…)` or
 *                `[card: Title — description](https://…)` → a bordered card
 *
 * A link card is never fetched: it shows the title and description stored in
 * its Markdown, or the link's domain and the URL. Only http(s) makes a card;
 * anything else is an ordinary paragraph, whose link the inline rule refuses.
 */
const CALLOUT_OPEN = /^\[!(note|tip|warning)\]\s*$/i;
// On escaped text: `[card]` or `[card: …]`, then `(` an http(s) URL `)`, and nothing else.
const CARD = /^\[card(?::\s*([^\]]*))?\]\(([^)\s]+)\)$/;

/** The card's parts from its (already escaped) link text and URL, or null when it makes no card. */
export function cardParts(stored: string | undefined, url: string): { title: string; description: string; domain: string } | null {
  const host = url.match(/^https?:\/\/([^/?#:\s]+)/i);
  if (!host) return null;
  const domain = host[1].toLowerCase().replace(/^www\./, '');
  const [title, ...rest] = (stored || '').split(' — ');
  return {
    title: title.trim() || domain,
    description: rest.join(' — ').trim() || url,
    domain,
  };
}

export function renderMarkdown(md: string): string {
  const escaped = escapeHtml(md || '');
  const lines = escaped.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Fenced code block. Tolerate leading indentation on the fence — article
    // bodies are often written with a uniform leading indent per line.
    if (/^\s*```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // consume closing fence
      out.push(`<pre><code>${buf.join('\n')}</code></pre>`);
      continue;
    }
    // D1410 — a divider: a line holding only `---`. A fence's own lines never
    // reach here, so `---` inside code stays code.
    if (/^\s*---\s*$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }
    // Heading. Leading whitespace is tolerated so indented `## ...` lines are
    // recognised as headings rather than leaking as literal text.
    const h = line.match(/^\s*(#{1,6})\s+(.+)$/);
    if (h) {
      const level = Math.min(6, h[1].length);
      out.push(`<h${level}>${inline(h[2].trim())}</h${level}>`);
      i++;
      continue;
    }
    // Blockquote (consecutive lines starting with ">", leading indent allowed).
    // NB: input is HTML-escaped before tokenisation, so the ">" marker is
    // "&gt;" by the time we get here — match that, not a literal ">".
    if (/^\s*&gt;\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*&gt;\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*&gt;\s?/, ''));
        i++;
      }
      // D1410 — a callout: the first line is `[!note]`, `[!tip]` or `[!warning]`.
      // Any other blockquote, an unknown kind included, is unchanged.
      const callout = buf[0].trim().match(CALLOUT_OPEN);
      if (callout) {
        const body = buf.slice(1).join(' ').trim();
        out.push(`<aside class="article-callout" data-kind="${callout[1].toLowerCase()}">${body ? `<p>${inline(body)}</p>` : ''}</aside>`);
        continue;
      }
      out.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`);
      continue;
    }
    // Unordered list.
    if (/^\s*[-*]\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        buf.push(`<li>${inline(lines[i].replace(/^\s*[-*]\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ul>${buf.join('')}</ul>`);
      continue;
    }
    // Ordered list.
    if (/^\s*\d+\.\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        buf.push(`<li>${inline(lines[i].replace(/^\s*\d+\.\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ol>${buf.join('')}</ol>`);
      continue;
    }
    // Blank line.
    if (!line.trim()) { i++; continue; }
    // Paragraph: gather consecutive non-empty lines. Authors commonly
    // separate paragraphs with a single newline (no blank line) when typing
    // in a textarea; join the gathered lines with <br> so that intent is
    // preserved as visible line breaks instead of collapsing into one run-on
    // block. Blank lines still start a fresh <p>.
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(#{1,6}\s|&gt;\s?|[-*]\s+|\d+\.\s+|```|---\s*$)/.test(lines[i])) {
      buf.push(lines[i].trim());
      i++;
    }
    // D1410 — a link card: the paragraph holds only `[card…](http(s)://…)`.
    const card = buf.length === 1 ? buf[0].match(CARD) : null;
    const parts = card ? cardParts(card[1], card[2]) : null;
    if (card && parts) {
      out.push(
        `<a class="article-card" href="${card[2]}" rel="noopener noreferrer nofollow" target="_blank">`
        + `<span class="article-card-title">${parts.title}</span>`
        + `<span class="article-card-description">${parts.description}</span>`
        + `<span class="article-card-domain">${parts.domain}</span></a>`,
      );
      continue;
    }
    if (buf.length > 0) out.push(`<p>${buf.map((l) => inline(l)).join('<br>')}</p>`);
  }
  return out.join('\n');
}

export async function snapshotRevision(
  env: Env,
  articleId: number,
  savedBy: number,
  reason: 'submit' | 'request_changes' | 'reject' | 'publish' | 'manual',
): Promise<void> {
  try {
    const row: any = await env.DB.prepare(
      `SELECT title, subtitle, body_markdown, status FROM articles WHERE id = ? LIMIT 1`,
    ).bind(articleId).first();
    if (!row) return;
    const maxRev: any = await env.DB.prepare(
      `SELECT COALESCE(MAX(rev), 0) AS m FROM article_revisions WHERE article_id = ?`,
    ).bind(articleId).first();
    const rev = (maxRev?.m ?? 0) + 1;
    await env.DB.prepare(
      `INSERT INTO article_revisions
         (article_id, rev, title, subtitle, body_markdown, status_at_save, saved_by, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(articleId, rev, row.title, row.subtitle, row.body_markdown, row.status, savedBy, reason).run();
  } catch (e) {
    console.warn('[newsRender] snapshot failed:', (e as Error).message);
  }
}

// Task #1 — Article cache buster. /api/articles list responses vary by
// sector/role/tag/search/limit/offset/featured query strings; we can't
// enumerate every variant, so we delete the canonical list URL plus the
// slug + cover keys and rely on the next request to repopulate. The list
// endpoint sets a short s-maxage so cold variants self-heal quickly.
export async function bustArticleEdgeCache(env: Env, slug: string, id: number, authorUserId?: number): Promise<void> {
  try {
    const cache = (caches as any).default;
    if (!cache) return;
    const base = env.APP_URL || 'https://axal.vc';
    await cache.delete(new Request(`${base}/api/articles`));
    await cache.delete(new Request(`${base}/api/articles?featured=1`));
    await cache.delete(new Request(`${base}/api/articles/${slug}`));
    await cache.delete(new Request(`${base}/api/articles/cover/${id}`));
    // Task #3 — News & Articles queues merged; all publish/unpublish now flows
    // through admin_articles. Also bust the DEPRECATED /api/news* edge keys so
    // the legacy public URLs don't keep serving stale content (up to 60 days).
    await cache.delete(new Request(`${base}/api/news`));
    await cache.delete(new Request(`${base}/api/news/${slug}`));
    await cache.delete(new Request(`${base}/api/news/cover/${id}`));
    // Inline body images are cached per-file at /api/articles/:id/image/:name.
    // Their filenames can't be derived from the slug, so list the article's R2
    // prefix and purge each image's edge key. Best-effort + bounded; combined
    // with the short image TTL this stops retracted content lingering public.
    try {
      const listed = await env.FILES?.list?.({ prefix: `articles/${id}/` });
      for (const obj of listed?.objects || []) {
        const fname = obj.key.split('/').pop();
        if (fname && fname.startsWith('img-')) {
          await cache.delete(new Request(`${base}/api/articles/${id}/image/${fname}`));
        }
      }
    } catch (e) {
      console.warn('[newsRender] image cache purge failed:', (e as Error).message);
    }
    if (authorUserId) {
      await cache.delete(new Request(`${base}/api/articles/by-author/${authorUserId}`));
    }
  } catch (e) {
    console.warn('[newsRender] article cache bust failed:', (e as Error).message);
  }
}
