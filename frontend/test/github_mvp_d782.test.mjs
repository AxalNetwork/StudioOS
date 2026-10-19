/**
 * D782 (#2112) — Prototype / MVP draws its "From GitHub" part from the module
 * read's `parts.github`: each fed must-have with GitHub's state and its pull
 * request link, and each release's checks, in then not in. The words are
 * `mvpGithub.js`'s; this holds them and the page, from a stubbed read.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import MvpFromGithub from '../src/pages/cycles/MvpFromGithub.jsx';
import { mustHaveView, pullHref, pullNumber, releaseCheckView, releaseChecksCount, releaseHref } from '../src/pages/cycles/mvpGithub.js';

const h = React.createElement;
const draw = (github) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/build/prototype-mvp?project_id=101'] }, h(MvpFromGithub, { github })));
const words = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, '\'').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
/** The rendered element carrying `testid`, from its opening `<` to the end of its tag's first close. */
const piece = (html, testid, close) => {
  const at = html.indexOf(`data-testid="${testid}"`);
  assert.ok(at >= 0, `${testid} is not drawn`);
  return html.slice(html.lastIndexOf('<', at), html.indexOf(close, at) + close.length);
};

const P5 = 'https://github.com/acme/app/pull/5';
const V11 = 'https://github.com/acme/app/releases/tag/v1.1';
const GITHUB = {
  state: 'ok', reason: null, releases_total: 2,
  must_haves: [
    { id: 1, title: 'Sketch onboarding', state: 'planned', label: 'Planned', url: 'https://github.com/acme/app/pull/1', must_have: true },
    { id: 3, title: 'Login with Google', state: 'in_review', label: 'In review', url: 'https://github.com/acme/app/pull/3', must_have: true },
    { id: 5, title: 'Search', state: 'built', label: 'Built', url: P5, must_have: true },
    { id: 7, title: 'Old idea', state: 'dropped', label: 'Dropped', url: 'https://github.com/acme/app/pull/7', must_have: false },
  ],
  releases: [
    { id: 901, repository: 'acme/app', tag: 'v1.1', name: 'Release v1.1', published_at: '2026-10-09T12:00:00Z', url: V11,
      in: [{ id: 6, title: 'Dark mode' }], not_in: [{ id: 1, title: 'Sketch onboarding' }, { id: 3, title: 'Login with Google' }] },
    { id: 900, repository: 'acme/app', tag: 'v1.0', name: 'v1.0', published_at: '2026-10-02T12:00:00Z', url: null,
      in: [{ id: 5, title: 'Search' }], not_in: [] },
  ],
};

test('each fed must-have shows GitHub\'s state, links its pull request, and a Dropped one says how to undo it', () => {
  // Mutation checked: drop the state pill → github-state-2 is missing; drop the link → github-pull-2 is missing.
  const out = draw(GITHUB);
  assert.match(out, /id="from-github"/);
  assert.match(piece(out, 'github-state-0', '</span>'), />Planned<\/span>$/);
  assert.match(piece(out, 'github-state-1', '</span>'), />In review<\/span>$/);
  assert.match(piece(out, 'github-state-2', '</span>'), />Built<\/span>$/);
  const link = piece(out, 'github-pull-2', '</a>');
  assert.ok(link.startsWith(`<a href="${P5}" target="_blank" rel="noopener noreferrer"`), link);
  assert.ok(link.endsWith('>Pull request #5</a>'), link);
  assert.match(words(piece(out, 'github-must-have-3', '</li>')), /Old idea Dropped Pull request #7 Off the must-haves\. Mark it a must-have to undo\./);
  assert.doesNotMatch(words(piece(out, 'github-must-have-2', '</li>')), /Off the must-haves/, 'only a Dropped one carries the note');
  assert.ok(out.includes('href="/build/prototype-mvp/5?project_id=101"'), 'the must-have opens its record');
});

test('each release lists its checks, newest first: in, then not in', () => {
  // Mutation checked: swap in and not in → the first release reads in: Sketch onboarding.
  const out = draw(GITHUB);
  assert.match(piece(out, 'github-release-checks-count', '</span>'), />2 releases<\/span>$/);
  const first = piece(out, 'github-release-check-0', '</li>');
  assert.ok(first.includes(`href="${V11}"`), 'the release links to its page');
  assert.match(words(first), /v1\.1 · Release v1\.1 2026-10-09 In: Dark mode Not in: Sketch onboarding · Login with Google/);
  const second = piece(out, 'github-release-check-1', '</li>');
  assert.ok(!second.includes('href='), 'a release with no page is drawn as text');
  assert.match(words(second), /v1\.0 2026-10-02 In: Search Not in: Nothing was left open/, 'a name equal to the tag is not repeated');
});

test('with nothing from GitHub the part says so; an unreadable read says Unreadable, never an empty list', () => {
  const none = draw({ state: 'empty', must_haves: [], releases: [], releases_total: 0, reason: 'No pull request or release from GitHub yet. Connect GitHub and sync to bring them in.' });
  assert.match(none, /data-testid="github-none">No pull request or release from GitHub yet/);
  assert.doesNotMatch(none, /github-release-checks"/);
  const bad = draw({ state: 'unreadable', must_haves: [], releases: [], releases_total: null, reason: 'GitHub\'s pull requests and release checks could not be read.' });
  assert.match(words(bad), /Unreadable: GitHub's pull requests and release checks could not be read\./);
  assert.doesNotMatch(bad, /0 releases|No release has checked/, 'never a zero');
  assert.equal(draw(undefined), '', 'nothing when the read carries no part');
  assert.match(draw({ ...GITHUB, releases: [], releases_total: 0 }), /data-testid="github-release-checks-none">No release has checked a must-have yet\./);
  assert.match(draw({ ...GITHUB, must_haves: [] }), /data-testid="github-must-haves-none">No must-have comes from a pull request yet\./);
});

test('the words, alone: a link out only to a pull request or release page on github.com', () => {
  assert.equal(pullHref(P5), P5);
  for (const bad of ['javascript:alert(1)', 'https://evil.example/acme/app/pull/5', 'http://github.com/acme/app/pull/5', 'https://github.com/acme/app/issues/5', '/build/x', null]) {
    assert.equal(pullHref(bad), null, String(bad));
  }
  assert.equal(releaseHref(V11), V11);
  assert.equal(releaseHref('https://github.com/acme/app/pull/5'), null);
  assert.equal(pullNumber(P5), '#5');
  assert.equal(pullNumber('https://evil.example/pull/5'), null);
  assert.deepEqual(mustHaveView({ title: 'x', state: 'weird', url: 'https://evil.example/x' }), { title: 'x', label: 'Not recorded', tone: 'grey', href: null, number: null, note: null });
  assert.equal(mustHaveView({ state: 'dropped', label: 'Dropped', must_have: true }).note, null, 'an undone Dropped carries no note');
  assert.equal(releaseCheckView({ tag: 'v2', published_at: null }).date, 'Not published');
  assert.equal(releaseCheckView({ tag: 'v2', in: [] }).inText, 'No must-have newly in this release');
  assert.equal(releaseChecksCount({ releases: [{}, {}], releases_total: 30 }), 'Showing 2 of 30 releases');
  assert.equal(releaseChecksCount({ releases: [{}], releases_total: 1 }), '1 release');
});

test('Build draws the part on Prototype / MVP', () => {
  // Mutation checked: drop the 'prototype-mvp' part → this fails.
  const route = readFileSync(new URL('../src/pages/cycles/CycleRoute.jsx', import.meta.url), 'utf8');
  assert.ok(route.includes("'prototype-mvp': (data) => <MvpFromGithub github={data?.parts?.github} />,"));
});
