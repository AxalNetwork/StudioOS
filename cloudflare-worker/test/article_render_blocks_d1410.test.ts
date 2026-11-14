/**
 * D1410 (#3893) — the divider, the callout and the link card in the article
 * renderer (`renderMarkdown`, `services/newsRender.ts`), which writes the
 * published article's HTML.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs --test cloudflare-worker/test/article_render_blocks_d1410.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cardParts, renderMarkdown } from '../src/services/newsRender.ts';

test('a line holding only --- is a divider; inside a fence it stays code', () => {
  assert.equal(renderMarkdown('Intro\n\n---\n\nAfter'), '<p>Intro</p>\n<hr>\n<p>After</p>');
  assert.equal(renderMarkdown('Intro\n---\nAfter'), '<p>Intro</p>\n<hr>\n<p>After</p>', 'it ends the paragraph above it');
  assert.equal(renderMarkdown('  ---  '), '<hr>');
  assert.equal(renderMarkdown('```\n---\n```'), '<pre><code>---</code></pre>');
  assert.equal(renderMarkdown('a --- b'), '<p>a --- b</p>', 'only a line holding nothing else');
  assert.equal(renderMarkdown('----'), '<p>----</p>');
});

test('a callout: [!note], [!tip] and [!warning] open an aside; any other blockquote is unchanged', () => {
  for (const kind of ['note', 'tip', 'warning']) {
    assert.equal(renderMarkdown(`> [!${kind}]\n> Read this **first**.`), `<aside class="article-callout" data-kind="${kind}"><p>Read this <strong>first</strong>.</p></aside>`);
  }
  assert.equal(renderMarkdown('> [!TIP]\n> Shout.'), '<aside class="article-callout" data-kind="tip"><p>Shout.</p></aside>', 'the kind is read in any case');
  assert.equal(renderMarkdown('> [!note]'), '<aside class="article-callout" data-kind="note"></aside>', 'an empty callout');
  assert.equal(renderMarkdown('> [!danger]\n> Not a kind.'), '<blockquote>[!danger] Not a kind.</blockquote>', 'an unknown kind stays a blockquote');
  assert.equal(renderMarkdown('> A quote.\n> [!note]'), '<blockquote>A quote. [!note]</blockquote>', 'only the first line opens a callout');
  assert.equal(renderMarkdown('> Plain.'), '<blockquote>Plain.</blockquote>');
});

test('HTML inside a callout is escaped', () => {
  const html = renderMarkdown('> [!warning]\n> <script>alert(1)</script> <img src=x onerror="y">');
  assert.equal(html, '<aside class="article-callout" data-kind="warning"><p>&lt;script&gt;alert(1)&lt;/script&gt; &lt;img src=x onerror=&quot;y&quot;&gt;</p></aside>');
  assert.doesNotMatch(html, /<script|<img/);
});

test('a link card: the stored title and description, else the domain and the URL; never fetched', () => {
  const plain = renderMarkdown('[card](https://www.Example.com/post?a=1&b=2)');
  assert.equal(plain, '<a class="article-card" href="https://www.Example.com/post?a=1&amp;b=2" rel="noopener noreferrer nofollow" target="_blank">'
    + '<span class="article-card-title">example.com</span><span class="article-card-description">https://www.Example.com/post?a=1&amp;b=2</span>'
    + '<span class="article-card-domain">example.com</span></a>');
  const stored = renderMarkdown('[card: A <made-up> study — What it found](http://research.example.test/study)');
  assert.equal(stored, '<a class="article-card" href="http://research.example.test/study" rel="noopener noreferrer nofollow" target="_blank">'
    + '<span class="article-card-title">A &lt;made-up&gt; study</span><span class="article-card-description">What it found</span>'
    + '<span class="article-card-domain">research.example.test</span></a>', 'the stored text is escaped');
  assert.deepEqual(cardParts('Only a title', 'https://ex.example'), { title: 'Only a title', description: 'https://ex.example', domain: 'ex.example' });
  assert.match(renderMarkdown('See [card](https://ex.example) here'), /^<p>See <a href="https:\/\/ex.example"[^>]*>card<\/a> here<\/p>$/, 'a card shares its paragraph with nothing');
  assert.doesNotMatch(renderMarkdown('[card](https://a.example)\n[card](https://b.example)'), /article-card/, 'two lines are a paragraph, not a card');
});

test('a card that is not http(s) is refused and rendered as text', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', '/api/articles/1', '//evil.example/x', 'ftp://files.example/x']) {
    const html = renderMarkdown(`[card](${url})`);
    assert.doesNotMatch(html, /article-card/, url);
    assert.doesNotMatch(html, /href="(javascript|data|\/\/|ftp)/i, url);
    assert.match(html, /^<p>/, `${url} is a paragraph`);
  }
  assert.equal(cardParts(undefined, 'javascript:alert(1)'), null);
});

test('the blocks leave the rest of the renderer as it was', () => {
  assert.equal(renderMarkdown('# Title\n\n- one\n- two\n\nText with [a link](https://ex.example).'),
    '<h1>Title</h1>\n<ul><li>one</li><li>two</li></ul>\n<p>Text with <a href="https://ex.example" rel="noopener nofollow" target="_blank">a link</a>.</p>');
  assert.equal(renderMarkdown('<b>raw</b>'), '<p>&lt;b&gt;raw&lt;/b&gt;</p>', 'no raw HTML passes');
});
