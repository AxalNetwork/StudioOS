// D1408 (#3694) — the Article Authoring canvas on the member's article pages.
// The pure rules in `pages/articles/articleCanvas.js`, the rail key, and the
// wiring each part's source must keep.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ARTICLE_ACTIONS, LIBRARY_TABS, assistInput, chargedLine, draftAudience, formatMarkdown, holdsLine, imageAsk,
  imageMarkdown, libraryRows, libraryStats, placeText, proposalMarkdown, refusalMessage, searchPreview, tabCounts, tabOf, usd,
} from '../src/pages/articles/articleCanvas.js';
import { pageKeyFor } from '../src/lib/railPages.js';

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

test('AR1: each status lands in one tab; approved with a publish time is Scheduled', () => {
  assert.deepEqual(LIBRARY_TABS.map((t) => t.label), ['Drafts', 'In review', 'Scheduled', 'Published']);
  assert.equal(tabOf({ status: 'draft' }), 'drafts');
  assert.equal(tabOf({ status: 'changes_requested' }), 'drafts');
  assert.equal(tabOf({ status: 'rejected' }), 'drafts');
  assert.equal(tabOf({ status: 'submitted' }), 'review');
  assert.equal(tabOf({ status: 'in_review' }), 'review');
  assert.equal(tabOf({ status: 'approved' }), 'review');
  assert.equal(tabOf({ status: 'approved', publish_at: '2026-11-02 09:00:00' }), 'scheduled');
  assert.equal(tabOf({ status: 'published' }), 'published');
  assert.deepEqual(tabCounts([{ status: 'draft' }, { status: 'draft' }, { status: 'published' }, { status: 'in_review' }]),
    { drafts: 2, review: 1, scheduled: 0, published: 1 });
});

test('AR1: search, tag and sort; the stats come from the rows', () => {
  const items = [
    { id: 1, status: 'draft', title: 'Pricing for seed', tags: ['pricing'], updated_at: '2026-10-30 10:00:00', word_count: 300 },
    { id: 2, status: 'draft', title: 'Hiring', subtitle: 'first ten', tags: ['team'], updated_at: '2026-10-31 10:00:00', word_count: 900 },
    { id: 3, status: 'published', title: 'Old', published_at: '2026-01-01 00:00:00', views: 40 },
    { id: 4, status: 'published', title: 'New', published_at: '2026-10-20 00:00:00', views: 2 },
  ];
  assert.deepEqual(libraryRows(items).map((a) => a.id), [2, 1], 'last edited first');
  assert.deepEqual(libraryRows(items, { sort: 'words' }).map((a) => a.id), [2, 1]);
  assert.deepEqual(libraryRows(items, { sort: 'title' }).map((a) => a.id), [2, 1]);
  assert.deepEqual(libraryRows(items, { query: 'TEN' }).map((a) => a.id), [2], 'subtitle matches');
  assert.deepEqual(libraryRows(items, { tag: 'pricing' }).map((a) => a.id), [1]);
  assert.deepEqual(libraryRows(items, { tab: 'published' }).map((a) => a.id).sort(), [3, 4]);
  assert.deepEqual(libraryStats(items, Date.parse('2026-10-31T00:00:00Z')), { publishedLast30: 1, views: 42 });
});

test('AR3: the cost lines read micro-dollars; an unread charge is never $0', () => {
  assert.equal(usd(6000), '$0.006');
  assert.equal(usd(24000), '$0.024');
  assert.equal(usd(1_200_000), '$1.20');
  assert.equal(holdsLine(6000), 'Holds up to $0.006 · you pay what it uses');
  assert.equal(holdsLine(undefined), 'You pay what it uses');
  assert.equal(chargedLine(4000, 6000), 'Charged $0.004 of $0.006 held · the rest is released');
  assert.equal(chargedLine(null, 6000), 'Charge not recorded yet · see Usage');
});

test('AR3: the eight D1409 options, each press carrying what it needs', () => {
  assert.deepEqual(ARTICLE_ACTIONS.map((a) => a.option), [
    'draft:article-outline', 'draft:article-section', 'rewrite:article', 'draft:article-continue',
    'draft:article-headlines', 'draft:article-seo', 'draft:article-newsletter', 'check:article-facts',
  ]);
  assert.ok(assistInput('draft:article-outline', {}).error);
  assert.deepEqual(assistInput('draft:article-outline', { brief: ' Seed pricing ' }), { input: { brief: 'Seed pricing' } });
  assert.ok(assistInput('draft:article-section', { brief: 'x' }).error, 'a section needs its heading');
  assert.deepEqual(assistInput('draft:article-section', { heading: 'Why', brief: 'b' }), { input: { heading: 'Why', brief: 'b' } });
  assert.ok(assistInput('rewrite:article', {}).error, 'a rewrite needs a selection');
  assert.deepEqual(assistInput('rewrite:article', { selection: 'Long text.', tone: 'plainer' }), { input: { selection: 'Long text.', tone: 'plainer' } });
  assert.equal(assistInput('draft:article-continue', { cursorContext: 'a'.repeat(5000) }).input.cursor_context.length, 4000);
  assert.deepEqual(assistInput('draft:article-headlines'), { input: {} });
  assert.deepEqual(assistInput('check:article-facts'), { input: {} });
  assert.deepEqual(assistInput('check:article-facts', { selection: 'Claim.' }), { input: { selection: 'Claim.' } });
  assert.equal(assistInput('draft:nope').error, 'unknown_option');
});

test('AR3: a proposal places its Markdown; Replace swaps the selection, Insert goes below its paragraph', () => {
  assert.equal(proposalMarkdown({ rail_option: 'draft:article-outline', payload: { outline_markdown: '## A' } }), '## A');
  assert.equal(proposalMarkdown({ payload: { heading: 'Why', markdown: 'Text' } }), '## Why\n\nText');
  assert.equal(proposalMarkdown({ payload: { before: 'x', after: 'y' } }), 'y');
  assert.equal(proposalMarkdown({ payload: { headlines: ['a'] } }), null, 'headlines place nothing in the body');
  assert.equal(proposalMarkdown({ payload: { seo_title: 'a', excerpt: 'b' } }), null);
  const body = 'One two three.\n\nNext para.';
  assert.equal(placeText(body, 'Two', { start: 4, end: 13, mode: 'replace' }).body, 'One Two.\n\nNext para.');
  assert.equal(placeText(body, 'Inserted.', { start: 4, end: 4, mode: 'below' }).body, 'One two three.\n\nInserted.\n\nNext para.');
  assert.equal(placeText('', 'First.', { start: 0 }).body, 'First.\n');
  assert.equal(placeText(body, 'End.', { start: body.length }).body, `${body}\n\nEnd.\n`);
});

test('AR3/AR4: a refusal reads as a sentence, with the top-up for a balance', () => {
  assert.equal(refusalMessage({ status: 402, data: { error: 'budget_user_day' } }).topUp, true);
  // The balance codes are matched whole (CodeQL: every alternative anchored), with or without a 402.
  for (const c of ['budget_user_day', 'budget_user_month', 'spend_limit', 'insufficient_tokens']) assert.equal(refusalMessage({ data: { error: c } }).topUp, true, c);
  for (const c of ['over_spend_limit', 'not_budget_user_day', 'spend_limit_x']) assert.equal(refusalMessage({ data: { error: c } }).topUp, undefined, c);
  assert.match(refusalMessage({ data: { error: 'assist_off' } }).text, /AIRail/);
  assert.match(refusalMessage({ data: { error: 'real_person' } }).text, /real people/);
  assert.equal(refusalMessage({ data: { error: 'real_person', message: 'Canvas sentence.' } }).text, 'Canvas sentence.');
  assert.match(refusalMessage({ status: 413 }).text, /storage plan/);
  assert.match(refusalMessage({ data: { error: 'nothing_proposed' } }).text, /nothing to propose/);
  assert.equal(refusalMessage({}).code, 'failed');
});

test('AR2: the format bar edits Markdown around the selection', () => {
  assert.deepEqual(formatMarkdown('a word b', 2, 6, 'bold'), { body: 'a **word** b', start: 4, end: 8 });
  assert.equal(formatMarkdown('x', 1, 1, 'italic').body, 'x*italic text*');
  assert.equal(formatMarkdown('see', 0, 3, 'link').body, '[see](https://)');
  assert.equal(formatMarkdown('Title\nbody', 0, 5, 'h2').body, '## Title\nbody');
  assert.equal(formatMarkdown('### Old', 0, 7, 'h2').body, '## Old');
  assert.equal(formatMarkdown('a\nb', 0, 3, 'bulleted').body, '- a\n- b');
  assert.equal(formatMarkdown('a\nb', 0, 3, 'numbered').body, '1. a\n2. b');
  assert.equal(formatMarkdown('a\nb', 0, 3, 'quote').body, '> a\n> b');
  assert.equal(formatMarkdown('## H', 0, 4, 'paragraph').body, 'H');
  assert.equal(formatMarkdown('l1\nl2', 0, 5, 'code').body, '```\nl1\nl2\n```');
});

test('AR4: the image ask is checked before it is quoted', () => {
  assert.ok(imageAsk({ prompt: 'ab' }).error);
  assert.ok(imageAsk({ prompt: 'x'.repeat(401) }).error);
  assert.ok(imageAsk({ prompt: 'A desk', style: 'portrait' }).error);
  assert.ok(imageAsk({ prompt: 'A desk', aspect: '2:1' }).error);
  assert.deepEqual(imageAsk({ prompt: ' A desk ', style: 'photo', aspect: '1:1', count: 9 }).ask, { prompt: 'A desk', style: 'photo', aspect: '1:1', count: 4 });
  assert.equal(imageMarkdown({ url: 'https://axal.vc/api/articles/5/image/img-a.png' }, 'A [desk]'), '![A desk](https://axal.vc/api/articles/5/image/img-a.png)');
});

test('AR5: the search preview, and who can see a draft', () => {
  const pv = searchPreview({ title: 'T', seo_title: 'x'.repeat(70), excerpt: 'Desc', slug: 'my-post' }, 'https://axal.vc');
  assert.equal(pv.url, 'https://axal.vc/articles/my-post');
  assert.equal(pv.title.length, 60);
  assert.equal(pv.titleTooLong, true);
  assert.equal(searchPreview({ title: 'Title', subtitle: 'Sub' }).description, 'Sub');
  assert.match(draftAudience('draft'), /Only you/);
  assert.match(draftAudience('in_review'), /review team/);
  assert.match(draftAudience('published'), /Anyone/);
});

test('the article pages carry the rail under <Profile> · Articles, the key the Worker files their runs under', () => {
  assert.equal(pageKeyFor('/articles/draft', 'founder'), 'Founder · Articles');
  assert.equal(pageKeyFor('/articles/edit/41', 'investor'), 'Investor · Articles');
  assert.equal(pageKeyFor('/articles/edit/41', 'super_admin'), 'Super Admin · Articles');
  assert.equal(pageKeyFor('/articles', 'founder'), null, 'the public feed has no rail');
  const page = read('pages/ArticleAuthorPage.jsx');
  assert.match(page, /<RailFrame rail=\{rail\} data-testid="article-author-page">/);
  assert.match(page, /<WorkerRail workspace="Articles" role="investor"/);
  assert.match(page, /const rail = <ArticleRail role=\{shellRoleFor\(user\?\.role, user, readHqView\(\)\)\} \/>;/);
  const worker = readFileSync(new URL('../../cloudflare-worker/src/services/articleAssist.ts', import.meta.url), 'utf8');
  assert.match(worker, /`\$\{PROFILE_OF_ROLE\[String\(role \?\? ''\)\] \?\? 'Member'\} · Articles`/);
});

test('each part calls only the routes it should, and nothing writes the article but the page’s save', () => {
  const panel = read('pages/articles/ArticleWritingPanel.jsx');
  assert.match(panel, /articleAuthoringApi\.quote\(articleId, option, built\.input\)/);
  assert.match(panel, /articleAuthoringApi\.assist\(articleId, option, built\.input, railPressHeaders\(option\)\)/);
  assert.match(panel, /railProposalsApi\.decide\(item\.proposal\.uid, decision\)/);
  assert.match(panel, /status: 'proposed'/);
  const sheet = read('pages/articles/ArticleImageSheet.jsx');
  for (const m of ['imagesQuote', 'imagesGenerate', 'imageDiscard', 'coverFromImage']) assert.match(sheet, new RegExp(`articleAuthoringApi\\.${m}\\(`));
  // A cover is a copy of the pick, so the pick itself is discarded right after: no orphan image in R2.
  assert.match(sheet, /coverFromImage\(articleId, img\.filename\);[\s\S]{0,120}imageDiscard\(articleId, img\.uid\)/);
  for (const src of [panel, sheet, read('pages/articles/ArticlePublishSheet.jsx'), read('pages/articles/ArticleLibrary.jsx')]) {
    assert.doesNotMatch(src, /updateDraft|\.submit\(|api\.uploadCover/, 'the page owns the save and the submit');
  }
  const page = read('pages/ArticleAuthorPage.jsx');
  // D1292's chain is unchanged; D1408 moves only the member's submit into Publish….
  assert.match(page, /onSubmit=\{async \(\) => \{ await submit\(\); setPublishOpen\(false\); \}\}/);
  assert.match(page, /data-testid="article-publish-open"/);
  // AR1's third card is the member's own public follower count, drawn only once read.
  assert.match(page, /appApi\.followStatus\('user', user\.id\)/);
  assert.match(read('pages/articles/ArticleLibrary.jsx'), /\{followers != null && \(/);
});

test('AR6e: a failed read is said, never drawn as empty', () => {
  const page = read('pages/ArticleAuthorPage.jsx');
  assert.match(page, /reportError\('ArticleAuthor:list', e\);[\s\S]{0,120}setListError\(true\);/);
  assert.match(page, /loadError=\{listError\}/);
  const lib = read('pages/articles/ArticleLibrary.jsx');
  assert.match(lib, /\{loadError && items\.length === 0 \? \(/);
  assert.match(lib, /Your articles could not be read\./);
  const panel = read('pages/articles/ArticleWritingPanel.jsx');
  assert.match(panel, /Promise\.allSettled\(OPTIONS\.map/);
  assert.match(panel, /setWaitingUnread\(results\.some\(\(r\) => r\.status === 'rejected'\)\)/);
});

test('AR5: an admin publishes now or schedules only another member\'s approved article (D1292, D484)', () => {
  const sheet = read('pages/articles/ArticlePublishSheet.jsx');
  assert.match(sheet, /const adminCanSchedule = chain === 'direct' && article\?\.status === 'approved';/);
  assert.match(sheet, /const adminCanPublish = \(chain === 'direct' \|\| chain === 'override'\) && article\?\.status !== 'published';/);
  const page = read('pages/ArticleAuthorPage.jsx');
  assert.match(page, /if \(!article \|\| chain !== 'direct'\) return false;\s*setScheduling\(true\);/);
  assert.match(page, /await adminApi\.schedule\(article\.id, iso\);/);
});

test('AR6g: on a phone the writing panel is a bottom sheet', () => {
  assert.match(read('pages/articles/ArticleWritingPanel.jsx'), /<aside className="fixed inset-x-0 bottom-0 [^"]*lg:static/);
});

test('the canvases are kept where the integration reads them', () => {
  for (const f of ['Article Authoring Page.dc.html', 'Article Authoring · Boards.dc.html']) {
    assert.ok(readFileSync(new URL(`../../design/incoming/${f}`, import.meta.url), 'utf8').length > 1000, f);
  }
});
