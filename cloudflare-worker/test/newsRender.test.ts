// Task #18 — Markdown renderer indentation tolerance.
//
// Article bodies are stored with a uniform leading indent on every line
// (authors paste pre-indented text). The original renderer only matched
// headings/blockquotes/fences when the marker was the very first character,
// so every `## ...` heading leaked into the page as literal "## ..." text.
//
// These checks lock in that indented Markdown renders as real structure and
// that stray leading whitespace never leaks into paragraph output.

import test from 'node:test';
import assert from 'node:assert/strict';

import { renderMarkdown, isValidArticleImageName } from '../src/services/newsRender.ts';

test('indented heading renders as a real heading, not literal text', () => {
  const html = renderMarkdown('  ## Why this matters');
  assert.match(html, /<h2>Why this matters<\/h2>/);
  assert.doesNotMatch(html, /##/);
});

test('all heading levels tolerate leading indentation', () => {
  const html = renderMarkdown('    # Big\n  ### Small');
  assert.match(html, /<h1>Big<\/h1>/);
  assert.match(html, /<h3>Small<\/h3>/);
});

test('indented blockquotes and lists render as structure', () => {
  const html = renderMarkdown('  > a quote\n\n  - one\n  - two');
  assert.match(html, /<blockquote>a quote<\/blockquote>/);
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
});

test('indented paragraph text is trimmed, no leading whitespace leaks', () => {
  const html = renderMarkdown('  Hello world');
  assert.match(html, /<p>Hello world<\/p>/);
  assert.doesNotMatch(html, /<p>\s+Hello/);
});

test('an indented heading still breaks the preceding paragraph', () => {
  const html = renderMarkdown('  Intro line\n  ## Section');
  assert.match(html, /<p>Intro line<\/p>/);
  assert.match(html, /<h2>Section<\/h2>/);
});

// Task #4 — image URL policy: root-relative accepted, protocol-relative rejected
test('root-relative image URL is accepted in renderMarkdown', () => {
  const html = renderMarkdown('![alt](/api/articles/1/image/img-abc.png)');
  assert.match(html, /^<p><img alt="alt" src="\/api\/articles\/1\/image\/img-abc\.png" loading="lazy" \/><\/p>$/);
});

test('protocol-relative image URL is rejected in renderMarkdown', () => {
  const html = renderMarkdown('![alt](//evil.com/x.png)');
  // Rejected image becomes an empty paragraph, not a bare `<img>` tag.
  assert.equal(html, '<p></p>');
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /evil\.com/);
});

test('root-relative link is accepted, protocol-relative link is rejected', () => {
  const html = renderMarkdown('[text](/about) [bad](//evil.com)');
  assert.match(html, /^<p><a href="\/about" rel="noopener nofollow" target="_blank">text<\/a> bad<\/p>$/);
  assert.match(html, /bad/);
  assert.doesNotMatch(html, /evil\.com/);
});

// Task #4 — inline-image filename validation
test('isValidArticleImageName accepts valid minted filenames', () => {
  assert.ok(isValidArticleImageName('img-550e8400-e29b-41d4-a716-446655440000.png'));
  assert.ok(isValidArticleImageName('img-550e8400.png'));
  assert.ok(isValidArticleImageName('img-abc.png'));
  assert.ok(isValidArticleImageName('img-abc.jpg'));
  assert.ok(isValidArticleImageName('img-abc.webp'));
  assert.ok(isValidArticleImageName('img-abc.gif'));
});

test('isValidArticleImageName rejects path traversal and bad extensions', () => {
  assert.equal(isValidArticleImageName('cover-abc.png'), false);
  assert.equal(isValidArticleImageName('img-abc..png'), false);
  assert.equal(isValidArticleImageName('img-abc.exe'), false);
  assert.equal(isValidArticleImageName('../etc/passwd'), false);
  assert.equal(isValidArticleImageName('img-550e8400-e29b-41d4-a716-446655440000.svg'), false);
  assert.equal(isValidArticleImageName(''), false);
  assert.equal(isValidArticleImageName(null as unknown as string), false);
});
