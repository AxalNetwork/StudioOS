/**
 * D1098 (#2963) — Vercel's parts on Prototype / MVP (VC2) and Product roadmap
 * (VC3), drawn from stubbed `parts.vercel` reads. The words are
 * `vercelDeploys.js`'s; this holds them and the two parts.
 *
 *   - Nothing measured is drawn as zero: a week before the first deploy, a
 *     share with nothing finished and a median with no build say so.
 *   - "In production since" and "Live on" appear only when the read says the
 *     SHA matched; a release without a match is a dashed "No matching deploy".
 *   - Empty, Unreadable (with Try again) and Reconnect are VC5's.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import MvpFromVercel from '../src/pages/cycles/MvpFromVercel.jsx';
import RoadmapFromVercel from '../src/pages/cycles/RoadmapFromVercel.jsx';
import {
  deployBars, deployNotes, deploySummary, duration, liveView, mustHaveView, partState, previewHref, reconnectText, releaseMark, shortDay,
} from '../src/pages/cycles/vercelDeploys.js';

const h = React.createElement;
const wrap = (el) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/build/prototype-mvp?project_id=101'] }, el));
const words = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, '\'').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const MVP = {
  state: 'ok', reason: null, projects: 1, connection: { as_of: '2026-10-23T09:12:00Z', reconnect: null },
  live: [{ state: 'live', label: 'Live', since: '2026-10-03T14:20:00.000Z', name: 'acme-web', domain: 'app.acme.example', commit: '9f3c2e1', build_seconds: 161, error_code: null }],
  must_haves: [
    { feature_id: 1, title: 'Patient intake form', pr_state: 'built', preview: { state: 'READY', at: '2026-10-02T10:00:00Z', url: 'https://intake-pr.vercel.app' }, preview_reason: null,
      in_production_since: '2026-10-03T14:20:00.000Z', production_reason: null },
    { feature_id: 2, title: 'Clinician dashboard', pr_state: 'in_review', preview: { state: 'BUILDING', at: '2026-10-22T10:00:00Z', url: null }, preview_reason: null,
      in_production_since: null, production_reason: 'No production deploy carries this pull request\'s merge commit yet.' },
    { feature_id: 3, title: 'Export to PDF', pr_state: 'in_progress', preview: null, preview_reason: 'Not recorded: no preview deploy for this pull request yet.',
      in_production_since: null, production_reason: 'Needs the GitHub connection\'s commit links: no merge commit is recorded for this pull request.' },
  ],
};

const weeks = (counts) => counts.map((count, i) => ({ week_of: new Date(Date.UTC(2026, 7, 3) + i * 7 * 86_400_000).toISOString().slice(0, 10), count }));
const ROADMAP = {
  state: 'ok', reason: null, connection: { as_of: '2026-10-23T09:12:00Z', reconnect: null },
  weeks: weeks([null, null, 3, 0, 2, 4, 1, 2, 3, 1, 2, 1]),
  failed_share: 6, failed_reason: null, median_build_seconds: 150, median_reason: null,
  events: [{ kind: 'rollback', at: '2026-10-12T10:00:00Z' }],
  releases: [
    { release_id: 3, tag: 'v1.2', state: 'live', live_on: '2026-10-03T14:20:00.000Z' },
    { release_id: 2, tag: 'v1.1', state: 'no_match', live_on: null },
    { release_id: 1, tag: 'v1.0', state: 'needs_github', live_on: null },
  ],
};

test('the words: days, durations, links', () => {
  assert.equal(shortDay('2026-10-03T14:20:00.000Z'), '3 Oct');
  assert.equal(shortDay('2026-08-24'), '24 Aug');
  assert.equal(shortDay('soon'), null);
  assert.deepEqual([duration(161), duration(45), duration(60), duration(null), duration(-1)], ['2m 41s', '45s', '1m 00s', null, null]);
  assert.equal(previewHref('https://intake-pr.vercel.app'), 'https://intake-pr.vercel.app');
  for (const bad of ['http://x.vercel.app', 'javascript:alert(1)', 'https://x.vercel.app/path', null]) assert.equal(previewHref(bad), null, String(bad));
});

test('the Live strip: "Live at [domain]" with Ready since, the last deploy\'s commit and build; failing and not deployed say so', () => {
  assert.deepEqual(liveView(MVP.live[0]), { title: 'Live at app.acme.example', name: 'acme-web', pill: 'Ready since 3 Oct, 14:20', tone: 'ok',
    detail: 'Last production deploy · commit 9f3c2e1 · build 2m 41s' });
  const failing = liveView({ state: 'failing', since: '2026-10-20T09:00:00Z', domain: null, commit: 'aaaaaaa', build_seconds: null, error_code: 'BUILD_FAILED' });
  assert.deepEqual([failing.title, failing.pill, failing.tone, failing.detail], ['Failing', 'Failing since 20 Oct, 09:00', 'bad', 'Last production deploy · commit aaaaaaa · BUILD_FAILED']);
  const none = liveView({ state: 'not_deployed', since: null });
  assert.deepEqual([none.title, none.pill, none.detail], ['Not deployed', 'Not deployed', 'No production deploy yet.']);
  assert.equal(liveView({ state: 'something' }).pill, 'Not recorded');
  // Someone outside the venture: the read leaves out the name and the domain.
  assert.deepEqual([liveView({ ...MVP.live[0], name: null, domain: null }).title, liveView({ ...MVP.live[0], name: null }).name], ['Live', null]);
});

test('each must-have: GitHub\'s state, the Preview pill or why not, and "In production since" only when the read matched the SHA', () => {
  const [a, b, c] = MVP.must_haves.map(mustHaveView);
  assert.deepEqual([a.status, a.preview, a.previewHref, a.production], ['Built', 'Preview Ready', 'https://intake-pr.vercel.app', 'In production since 3 Oct']);
  assert.deepEqual([b.status, b.preview, b.previewHref, b.production], ['In review', 'Preview Building', null, null]);
  assert.match(b.productionNote, /^No production deploy carries/);
  assert.deepEqual([c.preview, c.previewNote], [null, 'Not recorded: no preview deploy for this pull request yet.']);
  // A date the read did not give is never invented from a preview's time.
  assert.equal(mustHaveView({ ...MVP.must_haves[1], in_production_since: null }).production, null);
  const html = wrap(h(MvpFromVercel, { vercel: MVP }));
  const text = words(html);
  for (const w of ['From Vercel', 'Live at app.acme.example', 'Ready since 3 Oct, 14:20', 'Patient intake form', 'Preview Ready', 'In production since 3 Oct', 'Preview Building', 'Not recorded: no preview deploy for this pull request yet.']) {
    assert.ok(text.includes(w), w);
  }
  assert.match(html, /id="from-vercel"/);
  assert.match(html, /href="https:\/\/intake-pr\.vercel\.app" target="_blank" rel="noopener noreferrer"/);
  assert.equal((html.match(/In production since/g) || []).length, 1, 'only the must-have whose SHA matched');
});

test('the Deploys strip: a week before the first deploy is not recorded, a measured quiet week is a flat line, never the other way round', () => {
  const bars = deployBars(ROADMAP.weeks);
  assert.equal(bars.length, 12);
  assert.deepEqual(bars.slice(0, 4).map((b) => [b.measured, b.count]), [[false, null], [false, null], [true, 3], [true, 0]]);
  assert.equal(bars[0].label, 'Week of 3 Aug: not recorded, before the first deploy Vercel read');
  assert.equal(bars[3].label, 'Week of 24 Aug: no deploys');
  assert.equal(bars[5].height, 100);
  assert.equal(deploySummary(ROADMAP), 'Failed 6% · median build 2m 30s · 1 rollback');
  assert.deepEqual(deployNotes(ROADMAP), ['↺ Rollback on 12 Oct.', 'The week of 24 Aug had no deploys.']);
  const nothing = { weeks: weeks(Array(12).fill(null)), failed_share: null, failed_reason: 'No production deploy finished in these 12 weeks.', median_build_seconds: null,
    median_reason: 'Not recorded: no build finished in the last 12 weeks.', events: [] };
  assert.equal(deploySummary(nothing), 'Failed: not recorded · median build: not recorded · 0 rollbacks');
  assert.deepEqual(deployNotes(nothing), [nothing.failed_reason, nothing.median_reason]);
  const html = wrap(h(RoadmapFromVercel, { vercel: ROADMAP }));
  assert.match(html, /data-testid="vercel-week-0"[^>]*data-count="not-recorded"/);
  assert.match(html, /data-testid="vercel-week-3"[^>]*data-count="0"/);
  assert.match(html, /class="overflow-x-auto" data-testid="vercel-deploys-scroll"/, 'VC7: the strip scrolls inside its card');
  assert.ok(words(html).includes('Deploys to production, last 12 weeks'));
});

test('releases: "Live on" only on a match; otherwise a dashed pill says why', () => {
  assert.deepEqual(ROADMAP.releases.map(releaseMark), [
    { tag: 'v1.2', text: 'Live on 3 Oct', tone: 'ok', dashed: false },
    { tag: 'v1.1', text: 'No matching deploy', tone: 'muted', dashed: true },
    { tag: 'v1.0', text: 'Needs GitHub’s commit links', tone: 'muted', dashed: true },
  ]);
  assert.equal(releaseMark({ tag: 'v2', state: 'live', live_on: null }).text, 'No matching deploy', 'no date, no Live on');
  const html = wrap(h(RoadmapFromVercel, { vercel: ROADMAP }));
  assert.equal((html.match(/Live on/g) || []).length, 1);
  assert.match(html, /border-dashed" data-testid="vercel-release-mark-1"/);
});

test('VC5: empty names Choose projects, Unreadable offers Try again, Reconnect says how old the figures are and still draws them', () => {
  assert.equal(partState(undefined), null);
  assert.equal(wrap(h(MvpFromVercel, { vercel: undefined })), '', 'no read, no part');
  const empty = wrap(h(MvpFromVercel, { vercel: { state: 'empty', reason: 'x' } }));
  assert.ok(words(empty).includes('Vercel has not brought anything to this venture yet. Choose projects'));
  assert.match(empty, /href="\/account\/connectors\/vercel"/);
  const bad = wrap(h(RoadmapFromVercel, { vercel: { state: 'unreadable', reason: 'What Vercel brought could not be read.' }, reload: () => {} }));
  assert.ok(words(bad).includes('Vercel could not be read. The rest of this page is current.'));
  assert.match(bad, /<button/);
  assert.ok(!bad.includes('vercel-week-'), 'no strip, no zero');
  const lapsed = { ...ROADMAP, connection: { as_of: '2026-10-20T08:00:00Z', reconnect: { since: '2026-10-20T09:00:00Z', project: 'acme-web' } } };
  assert.equal(reconnectText(lapsed), 'Vercel’s sign-in for acme-web expired on 20 Oct. Figures are as of 20 Oct.');
  assert.equal(reconnectText({ connection: { as_of: null, reconnect: { since: null, project: null } } }), 'Vercel’s sign-in has expired. Figures are as of the last sync.');
  const html = wrap(h(RoadmapFromVercel, { vercel: lapsed }));
  assert.ok(words(html).includes('Reconnect Vercel'));
  assert.ok(html.includes('vercel-week-11'), 'the figures still draw, dated');
});
