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
    if (!/^https?:\/\//i.test(url)) return '';
    return `<img alt="${alt}" src="${url}" loading="lazy" />`;
  });
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, url) => {
    if (!/^https?:\/\//i.test(url) && !url.startsWith('/')) return text;
    return `<a href="${url}" rel="noopener nofollow" target="_blank">${text}</a>`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  return out;
}

export function renderMarkdown(md: string): string {
  const escaped = escapeHtml(md || '');
  const lines = escaped.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Fenced code block.
    if (/^```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // consume closing fence
      out.push(`<pre><code>${buf.join('\n')}</code></pre>`);
      continue;
    }
    // Heading.
    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      const level = Math.min(6, h[1].length);
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }
    // Blockquote (consecutive lines starting with ">").
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i++;
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
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|>\s?|\s*[-*]\s+|\s*\d+\.\s+|```)/.test(lines[i])) {
      buf.push(lines[i]);
      i++;
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

export async function bustEdgeCache(env: Env, slug: string, id: number): Promise<void> {
  try {
    const cache = (caches as any).default;
    if (!cache) return;
    const base = env.APP_URL || 'https://axal.vc';
    await cache.delete(new Request(`${base}/api/news`));
    await cache.delete(new Request(`${base}/api/news/${slug}`));
    await cache.delete(new Request(`${base}/api/news/cover/${id}`));
  } catch (e) {
    console.warn('[newsRender] cache bust failed:', (e as Error).message);
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
    if (authorUserId) {
      await cache.delete(new Request(`${base}/api/articles/by-author/${authorUserId}`));
    }
  } catch (e) {
    console.warn('[newsRender] article cache bust failed:', (e as Error).message);
  }
}
