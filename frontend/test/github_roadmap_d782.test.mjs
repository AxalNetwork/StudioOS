/**
 * D782 (#2111) — Product roadmap draws its "From GitHub" part from the module
 * read's `parts.github`: the milestone groups with their targets, each item's
 * Shipped mark linking to its release, and the Releases strip. The words are
 * `roadmapGithub.js`'s; this holds them and the page, from a stubbed read.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import RoadmapFromGithub from '../src/pages/cycles/RoadmapFromGithub.jsx';
import { groupCount, groupTarget, releaseHref, releaseView, releasesCount, shippedMark } from '../src/pages/cycles/roadmapGithub.js';

const h = React.createElement;
const draw = (github) => renderToStaticMarkup(h(MemoryRouter, { initialEntries: ['/build/product-roadmap?project_id=101'] }, h(RoadmapFromGithub, { github })));
const words = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, '\'').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

const V10 = 'https://github.com/acme/app/releases/tag/v1.0';
const V11 = 'https://github.com/acme/app/releases/tag/v1.1';
const GITHUB = {
  state: 'ok', reason: null, releases_total: 2,
  groups: [
    { title: 'v1.0', due: '2026-11-30', shipped: 2, items: [
      { id: 1, title: 'Export to CSV', column: 'Done', shipped: { tag: 'v1.0', url: V10 } },
      { id: 2, title: 'Fix login', column: 'Done', shipped: { tag: 'v1.1', url: V11 } },
    ] },
    { title: 'Later', due: null, shipped: 0, items: [{ id: 3, title: 'Dark mode', column: 'Next', shipped: null }] },
  ],
  releases: [
    { id: 902, repository: 'acme/app', tag: 'v1.1', name: 'Release v1.1', published_at: '2026-10-09T12:00:00Z', url: V11, prerelease: false, shipped: 2, items: [{ id: 2, title: 'Fix login' }, { id: 5, title: 'Faster import' }] },
    { id: 901, repository: 'acme/app', tag: 'v1.0', name: 'v1.0', published_at: '2026-10-02T12:00:00Z', url: V10, prerelease: true, shipped: 1, items: [{ id: 1, title: 'Export to CSV' }] },
  ],
};

test('the part draws each milestone as a group, with its target, and each item\'s Shipped mark linking to its release', () => {
  // Mutation checked: drop the mark → no github-shipped link; draw no target → "Target 2026-11-30" is missing.
  const out = draw(GITHUB);
  assert.match(out, /id="from-github"/);
  assert.match(out, /data-testid="github-group-0"/);
  assert.match(words(out), /v1\.0 Target 2026-11-30 · 2 items · 2 shipped/);
  assert.match(words(out), /Later No target: the milestone has no due date · 1 item/);
  assert.match(out, new RegExp(`<a href="${V10.replace(/[./]/g, '\\$&')}" target="_blank" rel="noopener noreferrer"[^>]*data-testid="github-shipped-0-0">Shipped in v1\\.0</a>`));
  assert.match(out, /data-testid="github-shipped-0-1">Shipped in v1\.1</);
  assert.doesNotMatch(out, /github-shipped-1-0/, 'an unshipped item has no mark');
  assert.match(out, /<a [^>]*href="\/build\/product-roadmap\/1\?project_id=101"[^>]*>Export to CSV<\/a>/, 'the item opens its record');
});

test('the Releases strip: newest first, each linking to GitHub, with what it shipped', () => {
  // Mutation checked: draw no strip → github-release-0 is missing.
  const out = draw(GITHUB);
  assert.match(out, /data-testid="github-releases-count">2 releases</);
  const first = out.slice(out.indexOf('github-release-0'), out.indexOf('github-release-1'));
  assert.match(first, new RegExp(`href="${V11.replace(/[./]/g, '\\$&')}"`));
  assert.match(words(first), /v1\.1 · Release v1\.1 2026-10-09 · acme\/app 2 items shipped Fix login · Faster import/);
  const second = out.slice(out.indexOf('github-release-1'));
  assert.match(words(second), /v1\.0 2026-10-02 · Pre-release · acme\/app 1 item shipped Export to CSV/, 'a name equal to the tag is not repeated');
});

test('with nothing from GitHub the part says so; an unreadable read says Unreadable, never an empty strip', () => {
  const none = draw({ state: 'empty', groups: [], releases: [], releases_total: 0, reason: 'No milestone or release from GitHub yet. Connect GitHub and sync to bring them in.' });
  assert.match(none, /data-testid="github-none">No milestone or release from GitHub yet/);
  assert.doesNotMatch(none, /github-releases"/);
  const bad = draw({ state: 'unreadable', groups: [], releases: [], releases_total: null, reason: 'GitHub\'s milestones and releases could not be read.' });
  assert.match(words(bad), /Unreadable: GitHub's milestones and releases could not be read\./);
  assert.doesNotMatch(bad, /0 releases|No release yet/, 'never a zero');
  assert.equal(draw(undefined), '', 'nothing when the read carries no part');
  const noGroups = draw({ ...GITHUB, groups: [] });
  assert.match(noGroups, /data-testid="github-groups-none">No roadmap item sits in a GitHub milestone\./);
});

test('the words, alone: a link out only to a release page on github.com', () => {
  assert.equal(releaseHref(V10), V10);
  for (const bad of ['javascript:alert(1)', 'https://evil.example/acme/app/releases/tag/v1', 'http://github.com/acme/app/releases/tag/v1', '/build/x', null]) assert.equal(releaseHref(bad), null, String(bad));
  assert.deepEqual(shippedMark({ shipped: { tag: 'v1', url: 'https://evil.example/x' } }), { text: 'Shipped in v1', href: null }, 'an off-site URL is text');
  assert.equal(shippedMark({ shipped: null }), null);
  assert.equal(groupTarget({ due: 'soon' }), 'No target: the milestone has no due date');
  assert.equal(groupCount({ items: [{}], shipped: 0 }), '1 item');
  assert.equal(releaseView({ shipped: 0, items: [] }).shipped, 'No roadmap item shipped');
  assert.equal(releaseView({ tag: 'v2', shipped: 14, items: Array.from({ length: 10 }, (_, i) => ({ title: `i${i}` })) }).more, 4);
  assert.equal(releaseView({ tag: 'v2', published_at: null }).date, 'Not published');
  assert.equal(releasesCount({ releases: [{}, {}], releases_total: 30 }), 'Showing 2 of 30 releases');
  assert.equal(releasesCount({ releases: [{}], releases_total: 1 }), '1 release');
});

test('Build draws the part on Product roadmap', () => {
  // Mutation checked: drop the 'product-roadmap' part → this fails.
  const route = readFileSync(new URL('../src/pages/cycles/CycleRoute.jsx', import.meta.url), 'utf8');
  assert.match(route, /'product-roadmap': \(data\) => <RoadmapFromGithub github=\{data\?\.parts\?\.github\} \/>/);
});
