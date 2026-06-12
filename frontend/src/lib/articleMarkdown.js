/**
 * Task #4 — Frontend verbatim port of the worker's renderMarkdown.
 *
 * Produces bare HTML tags (no Tailwind classes) so the container's
 * `prose dark:prose-invert` styles take over. The algorithm is kept
 * byte-identical to the worker's newsRender.ts so the editor preview
 * matches the public reader output.
 */

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inline(s) {
  // Inline transforms operate on already-escaped HTML.
  // Order matters: code spans first, then images, then links, then bold, then italic.
  let out = s;
  out = out.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, url) => {
    // Allow absolute http(s) OR root-relative ("/api/articles/:id/image/...")
    // URLs only. The (?!\/) guard rejects protocol-relative "//evil.com".
    if (!/^https?:\/\//i.test(url) && !/^\/(?!\/)/.test(url)) return '';
    return `<img alt="${alt}" src="${url}" loading="lazy" />`;
  });
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, url) => {
    if (!/^https?:\/\//i.test(url) && !/^\/(?!\/)/.test(url)) return text;
    return `<a href="${url}" rel="noopener nofollow" target="_blank">${text}</a>`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  return out;
}

export function renderMarkdown(md) {
  const escaped = escapeHtml(md || '');
  const lines = escaped.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Fenced code block. Tolerate leading indentation on the fence.
    if (/^\s*```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // consume closing fence
      out.push(`<pre><code>${buf.join('\n')}</code></pre>`);
      continue;
    }
    // Heading. Leading whitespace is tolerated.
    const h = line.match(/^\s*(#{1,6})\s+(.+)$/);
    if (h) {
      const level = Math.min(6, h[1].length);
      out.push(`<h${level}>${inline(h[2].trim())}</h${level}>`);
      i++;
      continue;
    }
    // Blockquote (consecutive lines starting with ">", leading indent allowed).
    // NB: input is HTML-escaped, so the ">" marker is "&gt;" by now.
    if (/^\s*&gt;\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*&gt;\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*&gt;\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`);
      continue;
    }
    // Unordered list.
    if (/^\s*[-*]\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        buf.push(`<li>${inline(lines[i].replace(/^\s*[-*]\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ul>${buf.join('')}</ul>`);
      continue;
    }
    // Ordered list.
    if (/^\s*\d+\.\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        buf.push(`<li>${inline(lines[i].replace(/^\s*\d+\.\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ol>${buf.join('')}</ol>`);
      continue;
    }
    // Blank line.
    if (!line.trim()) { i++; continue; }
    // Paragraph: gather consecutive non-empty lines.
    const buf = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*```/.test(lines[i]) &&
      !/^\s*(#{1,6})\s+/.test(lines[i]) &&
      !/^\s*&gt;\s?/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    if (buf.length) {
      const para = buf.join(' ').replace(/^\s+/, '').replace(/\s+$/, '');
      if (para) out.push(`<p>${inline(para)}</p>`);
    }
  }
  return out.join('\n');
}

export function wordsAndMinutes(md) {
  const words = (md || '').trim().split(/\s+/).filter(Boolean).length;
  return { words, minutes: Math.max(1, Math.round(words / 220)) };
}

export function slugify(s) {
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
