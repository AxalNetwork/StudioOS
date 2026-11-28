/**
 * D8994 (#8994) — the Help guide for Share outside Axal (`capital/share-evidence`) says what the shipped feature does.
 *
 * What is pinned, and why:
 *   - the guide is placed in Raising & cap table with Raise · Evidence as its page, is readable by founders and admins
 *     only (the roles the route admits), is not a public guide, and founders find it by search;
 *   - every label a step quotes is drawn by the page that the step names, so a renamed button fails here first;
 *   - the numbers it gives (expiry 1 to 90 days, 14 by default; 1 to 100 views, 10 by default; an 80-character label;
 *     a 200-character covering line) are the Worker's and the composer's own;
 *   - the reader's refusal pages are named by the Worker's own titles, and no other;
 *   - the reader's page is public (no guard on `/share/evidence/:token`) and mounts no Eadwyn, as the guide says;
 *   - every open uses one view, as the Worker's UPDATE counts it;
 *   - the guide's own words never call Eadwyn an advisor or its output advice or a recommendation (Voice).
 *
 * Run:
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/help_evidence_share_8994.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SECTIONS, PUBLIC_HELP_ANCHORS, filterSectionsForRole } from '../src/pages/docs/sections/index.js';
import { GUIDE_PLACEMENT, HELP_SURFACES, canOpenSurface, guidePlacement } from '../src/pages/docs/guidePlacement.js';
import { buildDocsRecords } from '../src/lib/docs/search.js';
import { LINK_LIMITS, COVERING_LINE_MAX, NOTHING_SENT } from '../src/pages/cycles/evidence/shareOutsideModel.js';
import { readRoutesSource } from './_routesSource.mjs';
import { codeOnly } from './_codeOnly.mjs';

const ANCHOR = 'capital/share-evidence';
const src = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const guide = SECTIONS.find((s) => s.id === 'capital')?.subsections.find((g) => g.id === 'share-evidence');
const text = (g) => [g.overview, ...(g.beforeYouStart || []), ...(g.howto || []), ...(g.tips || []), ...(g.pitfalls || [])].join(' \n ');
const WORKER = 'cloudflare-worker/src/services/raiseEvidenceShare.ts';

test('the guide is placed in Raising & cap table, opens Raise · Evidence, and is the founders’ and admins’', () => {
  assert.ok(guide, `${ANCHOR} is in the manifest`);
  assert.deepEqual(GUIDE_PLACEMENT[ANCHOR], { area: 'raising', surface: '/raise/evidence', appliesTo: ['founder'] });
  assert.equal(guidePlacement(ANCHOR).areaTitle, 'Raising & cap table');
  assert.deepEqual(HELP_SURFACES['/raise/evidence'], { label: 'Raise · Evidence', roles: ['admin', 'founder'], lab: true });
  const routes = codeOnly(readRoutesSource());
  assert.match(routes, /<Route path="\/raise\/evidence" element=\{guard\(labRoles\(\['admin', 'founder'\]\)/);
  assert.match(routes, /<Route path="\/raise\/evidence\/shared" element=\{guard\(labRoles\(\['admin', 'founder'\]\)/);
  assert.deepEqual(guide.roles, ['admin', 'founder']);
  for (const role of ['founder', 'admin']) {
    assert.ok(filterSectionsForRole(SECTIONS, role).some((s) => s.subsections.some((g) => `${s.id}/${g.id}` === ANCHOR)), `${role} reads it`);
    assert.equal(canOpenSurface(HELP_SURFACES['/raise/evidence'], { role }), true, `${role} can open Raise · Evidence`);
  }
  for (const role of ['investor', 'partner', 'advisor', 'exploring', 'public']) {
    assert.ok(!filterSectionsForRole(SECTIONS, role).some((s) => s.subsections.some((g) => `${s.id}/${g.id}` === ANCHOR)), `${role} does not`);
  }
  assert.ok(!PUBLIC_HELP_ANCHORS.has(ANCHOR), 'not a public guide (D4637 approves those one by one)');
  assert.ok(buildDocsRecords('founder').some((r) => r.anchor === ANCHOR), 'a founder finds it by search');
  assert.ok(!buildDocsRecords('investor').some((r) => r.anchor === ANCHOR), 'an investor does not');
});

test('the guide is a task: before you start, steps with an outcome, and pitfalls', () => {
  assert.ok(guide.beforeYouStart.length >= 2);
  assert.doesNotMatch(guide.howto[0], /^(Sign in|Only|Prerequisite)/, 'a prerequisite belongs in Before you start');
  assert.ok(guide.howto.some((s) => s.startsWith('Outcome:')));
  assert.ok(guide.pitfalls.length >= 3);
  const founder = filterSectionsForRole(SECTIONS, 'founder');
  for (const link of guide.related) {
    const [section, id] = link.href.slice(1).split('/');
    assert.ok(founder.find((s) => s.id === section)?.subsections.some((g) => g.id === id), `a founder can follow ${link.href}`);
  }
});

test('every label the guide quotes is drawn by the page it names', () => {
  const labels = [
    ['frontend/src/pages/cycles/evidence/RaiseEvidence.jsx', ['Share outside Axal', 'Add evidence', 'Shared links']],
    ['frontend/src/pages/cycles/evidence/ShareOutside.jsx', ['Evidence pack', 'Who reads it', 'I confirm an NDA with this reader is signed outside Axal.',
      'Day the NDA was signed', 'Label', 'Expires after (days)', 'View limit', 'The reader sees', 'Items in this pack', 'Create pack', 'Download PDF',
      'Pack ready', 'Copy link', 'give them Data room access', 'Nothing is shared beyond Private yet, so there is no pack to make.', 'Revoke link',
      'Make a new pack', 'PDF copies']],
    ['frontend/src/pages/cycles/evidence/shareOutsideModel.js', ['Before an NDA: coverage only', 'An NDA is signed outside Axal', 'Summary with figure',
      'Summary, no figure', 'Summary · Not recorded', 'Value withheld', 'Live', 'Expired', 'Used up', 'Revoked', 'Changed since sent', 'Could not be compared']],
    ['frontend/src/pages/cycles/evidence/ShareReadiness.jsx', ['Share outside Axal', 'Output', 'Readiness snapshot', 'Who it is for', 'Covering line',
      'Views allowed', 'Create link']],
    ['frontend/src/pages/cycles/evidence/ShareDrafts.jsx', ['Ask Eadwyn', 'Use Eadwyn’s draft', 'Accept selection']],
    ['frontend/src/pages/share/EvidencePackPage.jsx', ['Evidence pack', 'As of', 'This pack does not update', 'What is on record', 'Claims these items back',
      'Founder’s note']],
    ['frontend/src/lib/railPages.js', ['Fundraising readiness']],
    [WORKER, ['Not scored yet', 'Team is assessed by a person']],
  ];
  const all = text(guide);
  for (const [file, words] of labels) {
    const code = codeOnly(src(file));
    for (const w of words) {
      assert.ok(all.includes(w), `the guide quotes “${w}”`);
      assert.ok(code.includes(w), `${file} draws “${w}”`);
    }
  }
  assert.ok(all.includes(`“${NOTHING_SENT}”`), 'the made sheet’s own sentence, word for word');
});

test('the numbers are the Worker’s and the composer’s own', () => {
  const worker = src(WORKER);
  const defaults = /LINK_DEFAULTS = \{ expires_in_days: (\d+), view_limit: (\d+) \}/.exec(worker);
  const bounds = /LINK_BOUNDS = \{ expires_in_days: \[(\d+), (\d+)\], view_limit: \[(\d+), (\d+)\], label: (\d+),/.exec(worker);
  assert.ok(defaults && bounds, 'the Worker states its defaults and bounds');
  const [, days, views] = defaults.map(Number);
  const [, dLo, dHi, vLo, vHi, label] = bounds.map(Number);
  assert.deepEqual([...LINK_LIMITS.expires_in_days, ...LINK_LIMITS.view_limit, LINK_LIMITS.label], [dLo, dHi, vLo, vHi, label], 'the composer checks the same bounds');
  assert.match(src('frontend/src/pages/cycles/evidence/ShareOutside.jsx'), new RegExp(`expires_in_days: ${days}, view_limit: ${views} \\}\\);`), 'the composer starts at the Worker’s defaults');
  const steps = guide.howto.join(' ');
  assert.ok(steps.includes(`Expires after (days), from ${dLo} to ${dHi} (${days} unless you change it)`));
  assert.ok(steps.includes(`View limit, from ${vLo} to ${vHi} (${views} unless you change it)`));
  assert.ok(steps.includes(`in up to ${label} characters`));
  assert.match(worker, new RegExp(`COVERING_LINE_MAX = ${COVERING_LINE_MAX};`));
  assert.ok(steps.includes(`(at most ${COVERING_LINE_MAX} characters)`));
  // A snapshot shows every readiness item but Product-market fit (`SNAPSHOT_AREAS`).
  assert.match(worker, /SNAPSHOT_AREAS = READINESS_ITEMS\.filter\(\(i\) => i\.key !== 'pmf'\)/);
  const cycle = src('cloudflare-worker/src/services/raiseCycle.ts');
  const items = cycle.slice(cycle.indexOf('export const READINESS_ITEMS'), cycle.indexOf('] as const;', cycle.indexOf('export const READINESS_ITEMS')));
  const keys = [...items.matchAll(/key: '([a-z_]+)'/g)].map((m) => m[1]).filter((k) => k !== 'pmf');
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  assert.ok(steps.includes(`sees the ${words[keys.length]} readiness areas`), `${keys.length} areas`);
  assert.ok(keys.includes('team'), 'Team is one of them');
});

test('the reader’s refusal pages are named by the Worker’s own titles, and none uses a view', () => {
  const worker = src(WORKER);
  const block = worker.slice(worker.indexOf('export const REFUSALS'), worker.indexOf('} as const;', worker.indexOf('export const REFUSALS')));
  const titles = [...block.matchAll(/title: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(titles, ['This link does not open anything', 'This link has expired',
    'This link has been opened as many times as its sender allowed', 'This link was stopped by the founder']);
  const outcome = guide.howto.find((s) => s.startsWith('Outcome:'));
  for (const t of titles) assert.ok(outcome.includes(t), `the outcome names “${t}”`);
  for (const quoted of outcome.matchAll(/This link [a-z ]+/g)) assert.ok(titles.some((t) => t.startsWith(quoted[0].trim())), `“${quoted[0]}” is a Worker title`);
  assert.match(outcome, /none uses a view/);
  // The one UPDATE that counts a view admits only a live link: a refusal changes nothing.
  assert.match(worker, /SET view_count = view_count \+ 1, last_viewed_at = \?\s+WHERE token_hash = \? AND output = \? AND revoked_at IS NULL AND view_count < view_limit AND datetime\(expires_at\) > datetime\(\?\)/);
});

test('the reader’s page is public, mounts no Eadwyn, and every open uses one view', () => {
  const routes = codeOnly(readRoutesSource());
  assert.match(routes, /<Route path="\/share\/evidence\/:token" element=\{<EvidencePackPage \/>\} \/>/, 'no guard: no sign-in');
  const page = codeOnly(src('frontend/src/pages/share/EvidencePackPage.jsx'));
  assert.doesNotMatch(page, /Eadwyn|WorkerRail|AssistRail|EadwynPanel/, 'no Eadwyn on the reader’s page');
  assert.match(page, /useEffect\(\(\) => \{[\s\S]*?raiseEvidenceShareApi\.openShared\(token\)/, 'the page asks the Worker on every open');
  assert.match(guide.overview, /no sign-in/);
  assert.match(text(guide), /There is no sign-in and no Eadwyn\./);
  assert.match(guide.pitfalls.join(' '), /Every open uses one view, including the same reader opening the page again or reloading it\./);
});

test('the guide’s own words never put Eadwyn in regulated terms', () => {
  const all = [guide.title, text(guide), ...guide.related.map((l) => l.label)].join(' \n ');
  assert.doesNotMatch(all, /\b(advisor|adviser|advice|advise[sd]?|recommend\w*|fiduciary)\b/i);
  assert.match(guide.tips[0], /Accept selection only ticks rows/, 'Eadwyn proposes; the founder makes the pack');
});
