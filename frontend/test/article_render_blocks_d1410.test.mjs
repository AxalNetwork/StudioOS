/**
 * D1410 (#3893) — the editor's preview draws the divider, the callout and the
 * link card as the Worker renders them (`renderMarkdown`,
 * `cloudflare-worker/test/article_render_blocks_d1410.test.ts` holds the same
 * cases), and the Insert… list names them.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/article_render_blocks_d1410.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import { CALLOUT_KINDS, cardParts, remarkArticleBlocks } from '../src/pages/articles/articleBlocks.js';
import { ARTICLE_BLOCKS, SLASH_BLOCKS } from '../src/pages/articles/articleCanvas.js';

/** The preview's HTML, without the newlines react-markdown puts between blocks. */
const preview = (md) => renderToStaticMarkup(React.createElement(ReactMarkdown, { remarkPlugins: [remarkArticleBlocks] }, md))
  .replace(/>\n</g, '><').replace(/<hr\/>/g, '<hr>');

test('a line holding only --- is a divider, under a paragraph too; inside a fence it stays code', () => {
  assert.equal(preview('Intro\n\n---\n\nAfter'), '<p>Intro</p><hr><p>After</p>');
  assert.equal(preview('Intro\n---\nAfter'), '<p>Intro</p><hr><p>After</p>', 'not a heading, as the Worker reads it');
  assert.equal(preview('Title\n==='), '<h1>Title</h1>', 'a === heading is unchanged');
  assert.equal(preview('## Heading'), '<h2>Heading</h2>');
  assert.equal(preview('```\n---\n```'), '<pre><code>---\n</code></pre>');
});

test('a callout: [!note], [!tip] and [!warning] open an aside; any other blockquote is unchanged', () => {
  for (const kind of CALLOUT_KINDS) {
    assert.equal(preview(`> [!${kind}]\n> Read this **first**.`), `<aside class="article-callout" data-kind="${kind}"><p>Read this <strong>first</strong>.</p></aside>`);
  }
  assert.equal(preview('> [!TIP]\n> Shout.'), '<aside class="article-callout" data-kind="tip"><p>Shout.</p></aside>');
  assert.equal(preview('> [!danger]\n> Not a kind.'), '<blockquote><p>[!danger]\nNot a kind.</p></blockquote>');
  assert.equal(preview('> Plain.'), '<blockquote><p>Plain.</p></blockquote>');
  const html = preview('> [!warning]\n> <script>alert(1)</script>');
  assert.doesNotMatch(html, /<script/, 'HTML inside a callout is never drawn');
  assert.match(html, /^<aside class="article-callout" data-kind="warning">/);
});

test('a link card: the stored title and description, else the domain and the URL; only http(s)', () => {
  assert.equal(preview('[card](https://www.Example.com/post?a=1&b=2)'),
    '<a class="article-card" href="https://www.Example.com/post?a=1&amp;b=2" rel="noopener noreferrer nofollow" target="_blank">'
    + '<span class="article-card-title">example.com</span><span class="article-card-description">https://www.Example.com/post?a=1&amp;b=2</span>'
    + '<span class="article-card-domain">example.com</span></a>');
  assert.equal(preview('[card: A made-up study — What it found](http://research.example.test/study)'),
    '<a class="article-card" href="http://research.example.test/study" rel="noopener noreferrer nofollow" target="_blank">'
    + '<span class="article-card-title">A made-up study</span><span class="article-card-description">What it found</span>'
    + '<span class="article-card-domain">research.example.test</span></a>');
  for (const url of ['javascript:alert(1)', '/api/articles/1', '//evil.example/x', 'ftp://files.example/x']) {
    const html = preview(`[card](${url})`);
    assert.doesNotMatch(html, /article-card|href="javascript/i, url);
  }
  assert.doesNotMatch(preview('See [card](https://ex.example) here'), /article-card/, 'a card shares its paragraph with nothing');
  assert.deepEqual(cardParts('Only a title', 'https://ex.example'), { title: 'Only a title', description: 'https://ex.example', domain: 'ex.example' });
  assert.equal(cardParts(undefined, 'javascript:alert(1)'), null);
});

test('the Insert… list names the three, each with the Markdown the reader renders; both previews draw them', () => {
  assert.deepEqual(ARTICLE_BLOCKS.map((b) => b.kind), ['divider', 'callout_note', 'callout_tip', 'callout_warning', 'card']);
  assert.deepEqual(ARTICLE_BLOCKS.map((b) => b.label), ['Divider', 'Callout · Note', 'Callout · Tip', 'Callout · Warning', 'Link card']);
  for (const b of ARTICLE_BLOCKS) {
    const sample = b.kind === 'card' ? b.markdown.replace('(https://)', '(https://ex.example)') : `${b.markdown}Body.`;
    assert.match(preview(sample), /<hr>|article-callout|article-card/, `${b.kind}'s Markdown renders as its block`);
  }
  assert.ok(!SLASH_BLOCKS.some((b) => ARTICLE_BLOCKS.some((x) => x.kind === b.kind)), 'no kind twice');
  const author = readFileSync(new URL('../src/pages/ArticleAuthorPage.jsx', import.meta.url), 'utf8');
  assert.match(author, /const ARTICLE_REMARK = \[remarkArticleBlocks\];/);
  assert.match(author, /<ReactMarkdown remarkPlugins=\{ARTICLE_REMARK\}>\{editing\.body_markdown/);
  const drawer = readFileSync(new URL('../src/pages/admin/contentQueue/ReviewDrawer.jsx', import.meta.url), 'utf8');
  assert.match(drawer, /<ReactMarkdown remarkPlugins=\{\[remarkArticleBlocks\]\}>\{article\.body_markdown/);
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  for (const cls of ['.article-callout', '.article-card', '.article-card-title', '.article-card-description', '.article-card-domain']) assert.ok(css.includes(`${cls} {`), cls);
});
