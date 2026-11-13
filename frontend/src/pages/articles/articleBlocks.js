/**
 * D1410 (#3893) — the divider, the callout and the link card, as the editor's
 * preview draws them. The published article is the Worker's HTML
 * (`renderMarkdown`, `cloudflare-worker/src/services/newsRender.ts`); this
 * remark plugin makes `react-markdown` draw the same elements, with the same
 * classes, so the preview shows what readers will see.
 *
 *   · divider:   a line holding only `---`                → `<hr>`
 *   · callout:   a blockquote opening `> [!note|tip|warning]`
 *                → `<aside class="article-callout" data-kind="…">`
 *   · link card: a paragraph holding only `[card](https://…)` or
 *                `[card: Title — description](https://…)` → a bordered card
 *
 * A card is never fetched: its title and description are the ones stored in
 * its Markdown, else the link's domain and the URL. Only http(s) makes one.
 * Pure: no request, no React.
 */

export const CALLOUT_KINDS = Object.freeze(['note', 'tip', 'warning']);
const CALLOUT_OPEN = /^\[!(note|tip|warning)\][ \t]*(?:\n|$)/i;
const CARD_TEXT = /^card(?::\s*([\s\S]*))?$/;

/** The card's parts, as the Worker's `cardParts` reads them, or null when the URL makes no card. */
export function cardParts(stored, url) {
  const host = String(url || '').match(/^https?:\/\/([^/?#:\s]+)/i);
  if (!host) return null;
  const domain = host[1].toLowerCase().replace(/^www\./, '');
  const [title, ...rest] = String(stored || '').split(' — ');
  return { title: title.trim() || domain, description: rest.join(' — ').trim() || url, domain };
}

const textOf = (node) => (node.type === 'text' || node.type === 'inlineCode' ? node.value : (node.children || []).map(textOf).join(''));
const span = (cls, value) => ({ type: 'element', tagName: 'span', properties: { className: [cls] }, children: [{ type: 'text', value }] });

function callout(node) {
  const first = node.children?.[0];
  const text = first?.type === 'paragraph' ? first.children?.[0] : null;
  const open = text?.type === 'text' ? text.value.match(CALLOUT_OPEN) : null;
  if (!open) return;
  text.value = text.value.slice(open[0].length);
  if (!text.value) first.children.shift();
  if (!first.children.length) node.children.shift();
  node.data = { ...node.data, hName: 'aside', hProperties: { className: ['article-callout'], dataKind: open[1].toLowerCase() } };
}

function card(node) {
  const kids = (node.children || []).filter((k) => !(k.type === 'text' && !k.value.trim()));
  if (kids.length !== 1 || kids[0].type !== 'link') return;
  const label = textOf(kids[0]).match(CARD_TEXT);
  const parts = label ? cardParts(label[1], kids[0].url) : null;
  if (!parts) return;
  node.data = {
    ...node.data,
    hName: 'a',
    hProperties: { className: ['article-card'], href: kids[0].url, rel: 'noopener noreferrer nofollow', target: '_blank' },
    hChildren: [span('article-card-title', parts.title), span('article-card-description', parts.description), span('article-card-domain', parts.domain)],
  };
}

/**
 * `Intro` then `---` on the next line is a heading in CommonMark (a setext
 * heading); the Worker reads that `---` as a divider under a paragraph, so
 * the preview does too. Only a closing line of exactly `---` is read so.
 */
function setextDivider(node, source) {
  if (node.type !== 'heading' || node.depth !== 2 || !node.position) return null;
  // An ATX `## …` heading is one line, so its last line is never `---`.
  if (source.split('\n')[node.position.end.line - 1]?.trim() !== '---') return null;
  return [{ type: 'paragraph', children: node.children }, { type: 'thematicBreak' }];
}

function walk(node, source) {
  if (!Array.isArray(node.children)) return;
  const out = [];
  for (const child of node.children) {
    const split = setextDivider(child, source);
    if (split) { out.push(...split); continue; }
    if (child.type === 'blockquote') callout(child);
    if (child.type === 'paragraph') card(child);
    walk(child, source);
    out.push(child);
  }
  node.children = out;
}

/** The remark plugin: `<ReactMarkdown remarkPlugins={[remarkArticleBlocks]}>`. */
export function remarkArticleBlocks() {
  return (tree, file) => walk(tree, String(file?.value ?? ''));
}
