/**
 * D4640 (#4640) — Help Center audit package 4: a reader moves from a question
 * to a guide, and on to an answer or safe support, on desktop and on a phone,
 * without losing the question.
 *
 * What is pinned, and why:
 *   - a result keeps its search in both addresses: `/help?q=` replaces the
 *     home's entry before the guide opens (so Back returns to the results)
 *     and the guide opens at `?q=`; Enter and a plain click take that one
 *     path, a modifier click is the browser's;
 *   - the guide offers the results again, a search at every width (prefilled
 *     with the question) and related guides that keep it;
 *   - Get help sits after the guide and before "Did this answer it?": a ticket
 *     that carries the guide's link and the search and nothing else, chat only
 *     for a plan the Worker serves, a private security report, the status;
 *     signed out, sign in or the private advisory; account recovery signed out
 *     keeps its own block;
 *   - nothing found adds chat (same eligibility) and the status page;
 *   - on a phone, while a query is typed the browsing sections are not drawn,
 *     so the results sit directly under the search; clearing brings them back;
 *   - the results say what the search reads: release notes are not searched,
 *     with a link to them when the viewer can read them.
 *
 * Run:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/help_journeys_4640.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';
import { renderedText } from './_renderedText.mjs';
import { SECTIONS, filterSectionsForRole } from '../src/pages/docs/sections/index.js';
import { createDocsFuse } from '../src/lib/docs/search.js';
import { helpAreas } from '../src/pages/docs/guidePlacement.js';
import {
  QUERY_MAX, RELEASE_NOTES_ANCHOR, cleanQuery, guideHrefFor, guideOutline, guideTicketDraft, isPlainClick, searchGuides,
  searchHref, searchScope,
} from '../src/pages/docs/v2/helpV2.js';
import { GuideSupport, HelpArticle, HelpPhoneView, NothingFound, SearchResults } from '../src/pages/docs/DocsLayout.jsx';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const html = (el, entry = '/help') => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [entry] }, el));
const count = (s, needle) => s.split(needle).length - 1;
const founder = filterSectionsForRole(SECTIONS, 'founder');
const anon = filterSectionsForRole(SECTIONS, 'public');
const noop = () => {};
const layout = () => codeOnly(read('frontend/src/pages/docs/DocsLayout.jsx'));

const fakeFuse = (n) => ({
  search: (_q, { limit } = {}) => Array.from({ length: Math.min(n, limit ?? n) }, (_, i) => ({
    item: { anchor: i % 2 ? 'capital/cap-table' : 'validate-grow/data-room', sectionId: 'x', sectionTitle: 'X', subsectionTitle: `Guide ${i}`, text: 'share it' },
  })),
});

// ── The addresses ───────────────────────────────────────────────────────────

test('the search travels as one clean line in both addresses', () => {
  assert.equal(cleanQuery('  share\n  class  '), 'share class');
  assert.equal(cleanQuery(null), '');
  assert.equal(cleanQuery('x'.repeat(500)).length, QUERY_MAX, 'a question, not a document');
  assert.equal(searchHref('cap table'), '/help?q=cap%20table');
  assert.equal(searchHref('   '), '/help', 'no query, the plain home');
  assert.equal(searchHref('a&b=c#d'), '/help?q=a%26b%3Dc%23d', 'the query is encoded, never parsed as more address');
  assert.equal(guideHrefFor('validate-grow/data-room', ' share '), '/help/validate-grow/data-room?q=share');
  assert.equal(guideHrefFor('validate-grow/data-room', ''), '/help/validate-grow/data-room');
});

test('only a plain left click is taken over; a new tab or a modifier is the browser\'s', () => {
  const click = (over = {}) => ({ button: 0, metaKey: false, altKey: false, ctrlKey: false, shiftKey: false, ...over });
  assert.equal(isPlainClick(click()), true);
  for (const over of [{ button: 1 }, { metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }]) {
    assert.equal(isPlainClick(click(over)), false, JSON.stringify(over));
  }
  assert.equal(isPlainClick(null), false);
});

test('opening a result keeps the results behind it: replace the home with ?q=, then open the guide with it', () => {
  const src = layout();
  assert.match(src, /const openGuide = \(anchor\) => \{\s*navigate\(searchHref\(trimmedQuery\), \{ replace: true \}\);\s*navigate\(guideHrefFor\(anchor, trimmedQuery\)\);\s*\};/);
  assert.match(src, /if \(!isPlainClick\(e\)\) return;\s*e\.preventDefault\(\);\s*openGuide\(anchor\);/);
  assert.match(src, /if \(r\) \{ e\.preventDefault\(\); openGuide\(r\.anchor\); \}/, 'Enter takes the same path');
  // Both homes hand the results that path.
  assert.equal(count(src, 'onOpen={s.onOpen}'), 2);
  // The clear button gives focus back to the field it emptied.
  assert.match(src, /onClick=\{\(\) => \{ setQuery\(''\); searchInputRef\?\.current\?\.focus\(\); \}\} aria-label="Clear search"/);
});

test('each result links to its guide with the search, and the list says what the search reads', () => {
  const opened = [];
  const out = html(h(SearchResults, { search: searchGuides(fakeFuse(3), 'share'), query: 'share', onOpen: (_e, a) => opened.push(a), scope: searchScope(founder) }));
  assert.equal(count(out, 'href="/help/validate-grow/data-room?q=share"'), 2);
  assert.equal(count(out, 'href="/help/capital/cap-table?q=share"'), 1);
  assert.match(out, /data-testid="help-search-scope"/);
  assert.match(renderedText(out), /Searches guide titles and text\. Release notes are not searched\. Read What's new →/);
  assert.match(out, new RegExp(`href="/help/${RELEASE_NOTES_ANCHOR}"`));
  assert.doesNotMatch(html(h(SearchResults, { search: searchGuides(fakeFuse(3), 'share'), query: 'share' })), /help-search-scope/, 'no scope given, no line');
});

test('the scope names the release notes only for a viewer who can open them', () => {
  assert.deepEqual(searchScope(founder).notes, { anchor: RELEASE_NOTES_ANCHOR, label: 'Read What\'s new' });
  const pub = searchScope(anon);
  assert.equal(pub.notes, null, 'signed out the release notes are not a public guide, so no dead link');
  assert.equal(pub.line, 'Searches guide titles and text.');
  // The claim is true: the index holds no release-note text, only the guide's own fields.
  const notes = founder.find((s) => s.id === 'changelog').subsections[0];
  assert.ok(notes.markdownUrl, 'its body is a separate file');
  const rec = createDocsFuse('founder').getIndex().docs.find((d) => d.anchor === RELEASE_NOTES_ANCHOR);
  assert.ok(rec && !/CHANGELOG/.test(rec.text));
});

// ── Nothing found ───────────────────────────────────────────────────────────

test('nothing found: the ticket, chat only with the plan, the status page and the scope', () => {
  const fuse = createDocsFuse('founder');
  const base = { query: 'qqqzzz', fuse, user: { role: 'founder' }, onQuery: noop, onTicket: noop, publicCount: 6, scope: searchScope(founder) };
  const without = html(h(NothingFound, base));
  assert.match(without, /data-testid="help-none-ticket"/);
  assert.doesNotMatch(without, /help-none-chat/);
  assert.match(without, /href="\/status"/);
  assert.match(without, /data-testid="help-search-scope"/);
  assert.match(html(h(NothingFound, { ...base, chatAvailable: true })), /data-testid="help-none-chat"[^>]*>Message the team</);
  assert.match(layout(), /chatAvailable=\{canUseCustomerChat\(user\)\} onOpenChat=\{onOpenChat\} scope=\{scope\}/, 'the homes ask the Worker\'s own rule');
  const out = html(h(NothingFound, { ...base, user: null, fuse: createDocsFuse('public'), chatAvailable: true }));
  assert.doesNotMatch(out, /help-none-ticket|help-none-chat/, 'signed out: neither needs a member');
});

// ── The guide ───────────────────────────────────────────────────────────────

const guide = (props = {}, entry = '/help/validate-grow/data-room?q=share') => html(h(HelpArticle, {
  sections: founder, area: 'validate-grow', guide: 'data-room', user: { role: 'founder' }, onOpenTicket: noop, ...props,
}), entry);

test('a guide opened from a search offers the results again and keeps the question', () => {
  const out = guide({ query: 'share' });
  const text = renderedText(out);
  assert.match(out, /data-testid="help-guide-back-results" href="\/help\?q=share"/);
  assert.match(text, /Results for “share”/);
  // A search at every width: above the guide below 1024px, in the right column from it.
  assert.match(out, /<div class="mb-4 lg:hidden"><form role="search"/);
  assert.match(out, /id="help-guide-search-top"[^>]*value="share"/);
  assert.match(out, /id="help-guide-search"[^>]*value="share"/);
  assert.equal(count(out, 'role="search"'), 2);
  // Related guides keep it too.
  assert.match(out, /href="\/help\/validate-grow\/due-diligence\?q=share"/);
  // Without a search, no back link, an empty field, plain related links.
  const plain = guide({}, '/help/validate-grow/data-room');
  assert.doesNotMatch(plain, /help-guide-back-results/);
  assert.match(plain, /id="help-guide-search-top"[^>]*value=""/);
  assert.match(plain, /href="\/help\/validate-grow\/due-diligence"/);
  assert.doesNotMatch(plain, /\?q=/);
  // The guide's search opens the home's results: that is how a reader changes topic.
  assert.match(layout(), /if \(cleanQuery\(q\)\) navigate\(searchHref\(q\)\);/);
});

test('Get help sits after the guide and before "Did this answer it?"', () => {
  const out = guide({ query: 'share' });
  const at = (needle) => out.indexOf(needle);
  assert.ok(at('id="related"') > 0);
  assert.ok(at('data-testid="help-guide-support"') > at('id="related"'), 'after the guide');
  assert.ok(at('data-testid="help-feedback"') > at('data-testid="help-guide-support"'), 'before the feedback');
  const text = renderedText(out);
  assert.match(text, /Need more help with this\?/);
  assert.match(text, /A ticket carries this guide’s link and your search, “share”\. You see and edit it before Submit\./);
  assert.match(text, /no secrets or confidential records/);
  assert.match(out, /data-testid="help-guide-support-ticket"/);
  assert.match(out, /data-testid="help-guide-support-security"/);
  assert.match(out, /<nav aria-label="On this page"[\s\S]*href="#get-help"/);
  assert.deepEqual(
    guideOutline({ overview: 'x' }, { related: 1, support: true, feedback: true }).map((o) => o.id),
    ['overview', 'related', 'get-help', 'feedback'],
  );
});

test('Get help: chat only for a plan the Worker serves; signed out, sign in or the private advisory', () => {
  const base = { query: '', onOpenTicket: noop, onOpenChat: noop, onSecurity: noop };
  assert.doesNotMatch(html(h(GuideSupport, { ...base, user: { role: 'founder', subscription_tier: 'free' } })), /help-guide-support-chat/);
  assert.match(html(h(GuideSupport, { ...base, user: { role: 'founder', subscription_tier: 'studio' } })), /data-testid="help-guide-support-chat"/);
  assert.match(html(h(GuideSupport, { ...base, user: { role: 'advisor' } })), /help-guide-support-chat/);
  assert.match(renderedText(html(h(GuideSupport, { ...base, user: { role: 'founder' } }))), /A ticket carries this guide’s link\. You see/, 'no search, none named');
  const out = html(h(GuideSupport, { ...base, user: null }));
  assert.match(out, /href="\/login\?next=%2Fhelp%2Ftickets%3Fnew%3D1"/);
  assert.match(out, /security\/advisories\/new/);
  assert.doesNotMatch(out, /help-guide-support-(ticket|chat|security)/);
  // The status line draws nothing until the probe answers, then a word and a glyph.
  assert.doesNotMatch(out, /help-status-line/);
  assert.match(html(h(GuideSupport, { ...base, user: null, overall: 'degraded' })), /data-testid="help-status-line"[\s\S]*Some systems degraded/);
  // Signed out, a public guide gets the block; account recovery keeps its own.
  const pub = html(h(HelpArticle, { sections: anon, area: 'getting-started', guide: 'roles', user: null }));
  assert.match(pub, /data-testid="help-guide-support"/);
  const recovery = html(h(HelpArticle, { sections: anon, area: 'account', guide: 'auth-recovery', user: null }));
  assert.doesNotMatch(recovery, /help-guide-support/);
  assert.match(renderedText(recovery), /Still can’t get in\?/);
});

test('a ticket from a guide carries its link and the search, and nothing else', () => {
  assert.deepEqual(guideTicketDraft({ anchor: 'validate-grow/data-room', title: 'Data Room', missing: '', query: '  share\nclass ' }), {
    title: 'Question about “Data Room”',
    description: 'From the guide: /help/validate-grow/data-room\nSearched for: “share class”',
  });
  assert.deepEqual(guideTicketDraft({ anchor: 'a/b', title: 'T', missing: 'Revoke one.', query: 'x' }), {
    title: 'Revoke one.', description: 'From the guide: /help/a/b\nSearched for: “x”\n\nRevoke one.',
  });
  // The page hands the guide's search to both tickets: Get help and the after-No one.
  const src = layout();
  assert.match(src, /const openTicket = \(missing = ''\) => onOpenTicket\(\{ anchor, title: sub\.title, missing, query: q \}\);/);
  assert.match(src, /onOpenTicket: openTicket \}\}/);
  assert.match(src, /guideTicketDraft\(\{ anchor, title, missing, query: q \}\)/);
  assert.match(src, /query=\{urlQuery\}/);
});

test('a guide opened inside Help takes focus on its title; one loaded from outside does not', () => {
  const src = layout();
  assert.match(src, /if \(location\.key === 'default'\) return;\s*headingRef\.current\?\.focus\(\{ preventScroll: true \}\);/);
  assert.match(guide(), /<h1 tabindex="-1"/);
});

test('a guide takes back the shell\'s padding only inside the shell, so on its own it never scrolls sideways', () => {
  const src = layout();
  assert.match(src, /route \? '\[\[data-app-main\]_&\]:-mx-4 \[\[data-app-main\]_&\]:-my-4 md:\[\[data-app-main\]_&\]:-mx-6 md:\[\[data-app-main\]_&\]:-my-6 '/);
  assert.doesNotMatch(src, /route \? '-mx-4/, 'an unscoped negative margin pushes a standalone guide off the left edge');
  // The shell's main column is the element the variant names.
  assert.match(read('frontend/src/App.jsx'), /data-app-main className=/);
});

// ── The phone ───────────────────────────────────────────────────────────────

test('phone: while a query is typed the results sit directly under the search; clearing brings browsing back', () => {
  const areas = helpAreas(founder);
  const popular = { status: 'ok', cards: [{ anchor: 'getting-started/roles', title: 'Roles', views: 3, area: 'Getting started' }] };
  const search = h('div', { 'data-testid': 'box' });
  const results = h('div', { 'data-testid': 'results' });
  const browsing = html(h(HelpPhoneView, { popular, areas, search, children: results }));
  assert.match(browsing, /help-phone-popular/);
  assert.match(browsing, /help-phone-area/);
  assert.match(browsing, /help-phone-ticket/);
  const searching = html(h(HelpPhoneView, { popular, areas, search, browsing: false, children: results }));
  assert.doesNotMatch(searching, /help-phone-popular|help-phone-area|help-phone-ticket/);
  const box = searching.indexOf('data-testid="box"');
  assert.ok(box > 0 && searching.indexOf('data-testid="results"') > box);
  const src = layout();
  assert.match(src, /search=\{box\} browsing=\{!trimmedQuery\}>/);
  assert.match(src, /\{!trimmedQuery && user && <YourTicketsCard isAdmin=\{role === 'admin'\} \/>\}/);
  // The ticket stays one tap away while searching.
  assert.match(src, /data-testid="help-phone-need-help"/);
});
