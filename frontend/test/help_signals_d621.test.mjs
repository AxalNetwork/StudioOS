/**
 * D621 (#1280 step 2) — the Help Center's "Popular this week" and "Did this
 * answer it?", wired to D603's stores (`routes/help_center.ts`), and the
 * answers shown to an admin on the home.
 *
 * What is pinned, and why:
 *   - the popular cards follow the route's order, and a guide this reader
 *     cannot open is left out, never shown as a dead card;
 *   - a read in flight draws no figure, and a failed read says so: never a
 *     week nobody read anything, or a guide nobody answered;
 *   - a no opens one field, capped at the Worker's limit, and the note says
 *     who reads the answers, which is true: an admin, on the home, with no name;
 *   - the admin's view carries counts and texts only.
 *
 * Run:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/help_signals_d621.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { codeOnly } from './_codeOnly.mjs';

import {
  MISSING_MAX, POPULAR_ASKED, POPULAR_DAYS, POPULAR_SHOWN, adminFeedbackView, answeredLine, feedbackFrom, guideFor,
  popularGuides, viewsLine,
} from '../src/pages/docs/helpCenter.js';
import {
  ADMIN_ROWS, GuideAnswersAdminView, GuideFeedbackView, PopularGuidesView,
} from '../src/pages/docs/HelpSignals.jsx';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const count = (s, needle) => s.split(needle).length - 1;
const WORKER = read('cloudflare-worker/src/routes/help_center.ts');
// A literal pattern per constant, so no expression is built from a string.
const workerConst = (re) => Number(re.exec(WORKER)?.[1]);

const SECTIONS = [
  { id: 'capital', title: 'Capital', subsections: [{ id: 'cap-table', title: 'Cap tables' }, { id: 'calls', title: 'Capital calls' }] },
  { id: 'start', title: 'Getting started', subsections: [{ id: 'welcome', title: 'Welcome' }, { id: 'profile', title: 'Your profile' }] },
  { id: 'data', title: 'Data rooms', subsections: [{ id: 'room', title: 'Preparing a data room' }, { id: 'export', title: 'Exporting a data room' }] },
];

test('the page asks the route for what it can serve, and caps what it was told to', () => {
  assert.equal(POPULAR_ASKED, workerConst(/export const POPULAR_MAX_LIMIT = (\d+);/), 'ask for the most the route returns, so dropped guides leave room');
  assert.ok(POPULAR_DAYS >= 1 && POPULAR_DAYS <= workerConst(/export const POPULAR_MAX_DAYS = (\d+);/));
  assert.equal(POPULAR_DAYS, 7, 'the canvas says "last 7 days"');
  assert.equal(POPULAR_SHOWN, 4, 'the canvas draws four cards');
  assert.equal(MISSING_MAX, workerConst(/export const MISSING_MAX = (\d+);/), "the field's cap is the Worker's");
});

test('popular cards: the route\'s order, only guides this reader can open, at most four', () => {
  const reply = { window_days: 7, guides: [
    { anchor: 'capital/calls', views: 1240 },
    { anchor: 'admin/secret', views: 990 },
    { anchor: 'start/welcome', views: 980 },
    { anchor: 'start/profile', views: 0 },
    { anchor: 'data/room', views: 870 },
    { anchor: 'capital/cap-table', views: 640 },
    { anchor: 'start/missing-guide', views: 600 },
    { anchor: 'data/export', views: 300 },
  ] };
  assert.deepEqual(popularGuides(reply, SECTIONS), [
    { anchor: 'capital/calls', title: 'Capital calls', area: 'Capital', views: 1240 },
    { anchor: 'start/welcome', title: 'Welcome', area: 'Getting started', views: 980 },
    { anchor: 'data/room', title: 'Preparing a data room', area: 'Data rooms', views: 870 },
    { anchor: 'capital/cap-table', title: 'Cap tables', area: 'Capital', views: 640 },
  ]);
  assert.deepEqual(popularGuides({ guides: [] }, SECTIONS), []);
  assert.equal(popularGuides({ window_days: 7 }, SECTIONS), null, 'no list is a failed read, not an empty week');
  assert.equal(popularGuides(null, SECTIONS), null);
  assert.equal(guideFor('capital', SECTIONS), null);
  assert.equal(viewsLine(1240), '1,240 views');
  assert.equal(viewsLine(1), '1 view');
});

test('the reader\'s own answer: none, yes, no with what was missing, or unreadable', () => {
  assert.deepEqual(feedbackFrom({ anchor: 'capital/calls', feedback: null }), { state: 'none' });
  assert.deepEqual(feedbackFrom({ anchor: 'a/b', feedback: { answer: 'yes', missing: 'stray', updated_at: 'x' } }),
    { state: 'answered', answer: 'yes', missing: null }, 'a yes carries no missing text');
  assert.deepEqual(feedbackFrom({ anchor: 'a/b', feedback: { answer: 'no', missing: 'The fee table' } }),
    { state: 'answered', answer: 'no', missing: 'The fee table' });
  assert.deepEqual(feedbackFrom({ anchor: 'a/b', feedback: { answer: 'no', missing: null } }),
    { state: 'answered', answer: 'no', missing: null });
  assert.deepEqual(feedbackFrom({ anchor: 'a/b', feedback: { answer: 'maybe' } }), { state: 'unreadable' });
  assert.deepEqual(feedbackFrom({ anchor: 'a/b' }), { state: 'unreadable' }, 'a reply without the field is not "no answer"');
  assert.deepEqual(feedbackFrom(null), { state: 'unreadable' });
  assert.equal(answeredLine('yes'), 'You said this answered it.');
  assert.equal(answeredLine('no'), 'You said this did not answer it.');
});

test('the admin view: counts and texts, each naming its guide, and nothing about who answered', () => {
  const reply = {
    guides: [{ anchor: 'capital/calls', yes: 3, no: 5, user_id: 9 }, { anchor: 'old/guide', yes: 1, no: 0 }],
    missing: [{ anchor: 'capital/calls', text: 'The fee table', at: '2026-10-06 10:00:00', email: 'x@example.test' }],
  };
  const v = adminFeedbackView(reply, SECTIONS);
  assert.deepEqual(v, {
    guides: [
      { anchor: 'capital/calls', title: 'Capital calls', area: 'Capital', yes: 3, no: 5 },
      { anchor: 'old/guide', title: 'old/guide', area: null, yes: 1, no: 0 },
    ],
    missing: [{ anchor: 'capital/calls', title: 'Capital calls', area: 'Capital', text: 'The fee table', at: '2026-10-06 10:00:00' }],
    yes: 4,
    no: 5,
  }, 'a field the route might add about a member never passes through');
  assert.equal(adminFeedbackView({ guides: [] }, SECTIONS), null);
  assert.equal(adminFeedbackView(null, SECTIONS), null);
});

// ── Rendered ─────────────────────────────────────────────────────────────────

const CARDS = popularGuides({ guides: [
  { anchor: 'capital/calls', views: 1240 }, { anchor: 'start/welcome', views: 980 },
  { anchor: 'data/room', views: 870 }, { anchor: 'capital/cap-table', views: 640 },
] }, SECTIONS);

test('Popular this week: loading, unreadable, an empty week, and four ranked cards', () => {
  const loading = html(h(PopularGuidesView, { read: { status: 'loading', cards: [] } }));
  assert.match(loading, /Popular this week/);
  assert.match(loading, /By views, last 7 days/);
  assert.match(loading, /aria-busy="true"/);
  assert.doesNotMatch(loading, /views ·|help-popular-none/);
  const failed = html(h(PopularGuidesView, { read: { status: 'error', cards: [] }, onRetry: () => {} }));
  assert.match(failed, /role="alert"/);
  assert.match(failed, /The most-read guides could not be read\. This is not a sign nobody reads them\./);
  assert.match(failed, />Try again</);
  assert.doesNotMatch(failed, /help-popular-none|help-popular-card/, 'a failed read is not an empty week');
  assert.match(html(h(PopularGuidesView, { read: { status: 'ok', cards: [] } })), /No views are recorded for these guides this week\./);
  const out = html(h(PopularGuidesView, { read: { status: 'ok', cards: CARDS } }));
  assert.equal(count(out, 'data-testid="help-popular-card"'), 4);
  for (const r of ['01', '02', '03', '04']) assert.ok(out.includes(`>${r}<`), `rank ${r}`);
  assert.match(out, /href="\/help\/capital\/calls"/);
  assert.match(out, /1,240 views · Capital/);
  assert.equal(count(out, 'bg-violet-50'), 1, 'only the first rank is violet, as the canvas draws it');
});

const IDLE = { busy: false, failed: false };
const fb = (props) => html(h(GuideFeedbackView, { mode: 'idle', missing: '', save: IDLE, ...props }));

test('Did this answer it?: loading draws no buttons; no answer offers Yes and No with the note', () => {
  const loading = fb({ read: { state: 'loading' } });
  assert.match(loading, /Did this answer it\?/);
  assert.match(loading, /aria-busy="true"/);
  assert.doesNotMatch(loading, /data-testid="help-feedback-(yes|no)"/);
  const none = fb({ read: { state: 'none' } });
  assert.match(none, /data-testid="help-feedback-yes"[^>]*>Yes</);
  assert.match(none, /data-testid="help-feedback-no"[^>]*>No</);
  assert.match(none, /A no opens one field asking what was missing\. Axal’s admins read the answers, without your name\./);
  assert.doesNotMatch(none, /whoever wrote the guide/i, 'no guide records its author, so the note never promises one');
});

test('Did this answer it?: an answer reads back, with what was missing, and can be changed', () => {
  const yes = fb({ read: { state: 'answered', answer: 'yes', missing: null } });
  assert.match(yes, /You said this answered it\./);
  assert.match(yes, /Change your answer/);
  assert.doesNotMatch(yes, /data-testid="help-feedback-yes"/);
  const no = fb({ read: { state: 'answered', answer: 'no', missing: 'The fee table' } });
  assert.match(no, /You said this did not answer it\./);
  assert.match(no, /data-testid="help-feedback-missing"[^>]*>The fee table</);
  const changing = fb({ read: { state: 'answered', answer: 'yes', missing: null }, mode: 'changing' });
  assert.match(changing, /data-testid="help-feedback-yes"/);
  assert.match(changing, /Keep my answer/);
});

test('Did this answer it?: a no opens one field, counted against the Worker\'s cap', () => {
  const asking = fb({ read: { state: 'none' }, mode: 'asking', missing: 'The fee' });
  assert.match(asking, /What was missing\?/);
  assert.match(asking, /maxLength="500"/);
  assert.match(asking, />7 of 500</);
  assert.match(asking, /data-testid="help-feedback-send"[^>]*>Send</);
  assert.doesNotMatch(asking, /data-testid="help-feedback-yes"/, 'the choice is made; the field is the next step');
});

test('Did this answer it?: an unreadable answer still lets the reader answer, and a failed save says so', () => {
  const un = fb({ read: { state: 'unreadable' } });
  assert.match(un, /Your earlier answer could not be read\. A new answer replaces it\./);
  assert.match(un, /data-testid="help-feedback-yes"/);
  const failed = fb({ read: { state: 'none' }, save: { busy: false, failed: true } });
  assert.match(failed, /role="alert"[^>]*>Your answer was not saved\. Try again\./);
  const busy = fb({ read: { state: 'none' }, save: { busy: true, failed: false } });
  assert.match(busy, /disabled=""[^>]*data-testid="help-feedback-yes"/);
});

const ANSWERS = adminFeedbackView({
  guides: Array.from({ length: ADMIN_ROWS + 2 }, (_, i) => ({ anchor: i === 0 ? 'old/guide' : 'capital/calls', yes: i, no: 10 - i })),
  missing: [{ anchor: 'capital/calls', text: 'The fee table', at: '2026-10-06 10:00:00' }],
}, SECTIONS);

test('the admin answers: loading, unreadable, none, and the rows with what was missing', () => {
  assert.match(html(h(GuideAnswersAdminView, { read: { status: 'loading', view: null } })), /aria-busy="true"/);
  const failed = html(h(GuideAnswersAdminView, { read: { status: 'error', view: null }, onRetry: () => {} }));
  assert.match(failed, /The answers could not be read\./);
  assert.doesNotMatch(failed, /help-answers-none|help-answers-row/);
  const none = html(h(GuideAnswersAdminView, { read: { status: 'ok', view: adminFeedbackView({ guides: [], missing: [] }, SECTIONS) } }));
  assert.match(none, /No member has answered yet\./);
  const some = html(h(GuideAnswersAdminView, { read: { status: 'ok', view: ANSWERS }, all: false }));
  assert.equal(count(some, 'data-testid="help-answers-row"'), ADMIN_ROWS);
  assert.match(some, /data-testid="help-answers-all"[^>]*>Show all</);
  assert.match(some, /title="This guide is no longer in the Help Center\."/);
  assert.match(some, /The fee table/);
  assert.match(some, /Capital calls · 2026-10-06/);
  assert.match(some, /data-testid="help-answers-meta"[^>]*>21 yes · 49 no · no names</);
  const every = html(h(GuideAnswersAdminView, { read: { status: 'ok', view: ANSWERS }, all: true }));
  assert.equal(count(every, 'data-testid="help-answers-row"'), ADMIN_ROWS + 2);
  assert.doesNotMatch(every, /help-answers-all/);
});

// ── Wiring ───────────────────────────────────────────────────────────────────

const layout = codeOnly(read('frontend/src/pages/docs/DocsLayout.jsx'));
const signals = codeOnly(read('frontend/src/pages/docs/HelpSignals.jsx'));

test('the layout mounts each part where the canvas draws it, and the admin card for an admin only', () => {
  assert.match(layout, /\{!trimmedQuery && <PopularGuides sections=\{visibleSections\} \/>\}/,
    'popular sits under the browse grid, not under search results');
  assert.match(layout, /\{role === 'admin' && <GuideAnswersAdmin sections=\{visibleSections\} \/>\}/);
  assert.match(layout, /<GuideFeedback anchor=\{`\$\{section\.id\}\/\$\{sub\.id\}`\} \/>/);
  const article = layout.slice(layout.indexOf('function HelpArticle('), layout.indexOf('function HelpHome('));
  assert.ok(article.indexOf('<GuideFeedback') < article.indexOf('id="related"'), 'the answer comes before Related, as on the canvas');
});

test('each part reads its own store, through the module file, and a failure is never an empty answer', () => {
  assert.match(signals, /import \{ helpCenterApi \} from '\.\.\/\.\.\/lib\/api\/helpCenter';/);
  assert.match(signals, /helpCenterApi\.popular\(\{ days: POPULAR_DAYS, limit: POPULAR_ASKED \}\)/);
  assert.match(signals, /helpCenterApi\.recordView\(anchor\)/);
  assert.match(signals, /helpCenterApi\.myFeedback\(anchor\)/);
  assert.match(signals, /helpCenterApi\.saveFeedback\(anchor, answer, answer === 'no' \? missing\.trim\(\) : undefined\)/);
  assert.match(signals, /helpCenterApi\.adminFeedback\(\)/);
  assert.match(signals, /setRead\(cards \? \{ status: 'ok', cards \} : \{ status: 'error', cards: \[\] \}\)/);
  assert.match(signals, /setRead\(view \? \{ status: 'ok', view \} : \{ status: 'error', view: null \}\)/);
  assert.match(signals, /if \(alive\) setRead\(\{ state: 'unreadable' \}\)/);
  assert.match(signals, /setSave\(\{ busy: false, failed: true \}\)/);
  assert.match(signals, /onNo=\{\(\) => \{ setSave\(\{ busy: false, failed: false \}\); setMode\('asking'\); \}\}/,
    'a no opens the field; it is saved by Send, with or without text');
  assert.match(signals, /onYes=\{\(\) => send\('yes'\)\}/);
});
