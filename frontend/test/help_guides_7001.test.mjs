/**
 * D7001 (#7001, plan key X19): the five public Help guides say what the product does. The onboarding guide follows
 * `MEMBERSHIP_STEPS` in order, the role names match registration and the Trust Center (staff-only marked), the
 * recovery button reads "Recover my account" with the review fallback in the first paragraph, Contact support repeats
 * the public-tracker warning beside its ticket button, and every search suggestion finds a public guide.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { SECTIONS, PUBLIC_HELP_ANCHORS } from '../src/pages/docs/sections/index.js';
import { MEMBERSHIP_STEPS } from '../src/lib/registerCopy.js';
import { profileName } from '../src/pages/trust/memberTrustModel.js';
import { createDocsFuse } from '../src/lib/docs/search.js';
import { guidePlacement } from '../src/pages/docs/guidePlacement.js';
import {
  RECOVERY_ACTION, SEARCH_SUGGESTIONS, TRACKER_WARNING, TRACKER_WARNING_ANCHOR, TRACKER_WARNING_LINK,
  goToTarget, searchGuides, searchSuggestions,
} from '../src/pages/docs/v2/helpV2.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, '..', rel), 'utf8');
const guide = (anchor) => {
  const [area, id] = anchor.split('/');
  return SECTIONS.find((s) => s.id === area)?.subsections.find((g) => g.id === id);
};
const text = (g) => [g.overview, ...(g.howto || []), ...(g.tips || []), ...(g.pitfalls || [])].join(' \n ');

// The five steps, in MEMBERSHIP_STEPS's own order, each by the words that sentence uses.
const STEPS = [
  ['Account created', /create your account/i],
  ['Email confirmed', /confirm your email/i],
  ['Membership reviewed and agreement sent', /reviews your membership and sends an agreement/i],
  ['Agreement signed', /after you sign it/i],
  ['Workspace enabled', /enables your workspace/i],
];

test('the step list is MEMBERSHIP_STEPS: every step is in that sentence, in that order', () => {
  let at = -1;
  for (const [, re] of STEPS) {
    const i = MEMBERSHIP_STEPS.search(re);
    assert.ok(i > at, `${re} is in MEMBERSHIP_STEPS after the step before it`);
    at = i;
  }
});

test('onboarding names every step of MEMBERSHIP_STEPS in order, and its overview is that sentence', () => {
  const g = guide('getting-started/onboarding');
  assert.ok(g.overview.startsWith(MEMBERSHIP_STEPS), 'the overview opens with MEMBERSHIP_STEPS');
  assert.deepEqual(g.howto.map((h) => h.split(' — ')[0]), STEPS.map(([name]) => name));
  const all = text(g);
  assert.doesNotMatch(all, /4[–-]8|four to eight/i, 'the old question count is gone');
  assert.doesNotMatch(all, /\b(\d+\s*(hours?|days?|business days?)|within)\b/i, 'no review time is promised');
});

test('roles: the registration roles and Explorer by their Trust Center names; Admin is marked staff only', () => {
  const g = guide('getting-started/roles');
  const names = g.howto.map((h) => h.split(' — ')[0]);
  for (const role of ['founder', 'investor', 'partner', 'advisor', 'exploring']) {
    assert.ok(names.includes(profileName(role)), `${profileName(role)} is listed`);
  }
  assert.ok(names.includes(`${profileName('admin')} (staff only)`), 'Admin is marked staff only');
  assert.match(g.overview, /Operating Partner/);
  assert.match(g.overview, /Explorer/);
  assert.match(g.overview, /staff-only/);
  assert.doesNotMatch(g.overview, /one of five roles/i);
});

test('account recovery: "Recover my account", and the review fallback is in the first paragraph', () => {
  assert.equal(RECOVERY_ACTION, 'Recover my account');
  assert.deepEqual(goToTarget(guidePlacement('account/auth-recovery'), null), { label: 'Recover my account', path: '/auth/recover' });
  assert.match(guide('account/auth-recovery').overview, /admin review/i);
  for (const rel of ['src/pages/docs/v2/helpV2.js', 'src/pages/docs/DocsLayout.jsx', 'src/pages/docs/sections/account.js']) {
    assert.doesNotMatch(read(rel), /Open the surface|Start recovery/, `${rel} no longer carries the old button`);
  }
});

test('contact support: the public-tracker warning sits beside the ticket button and links the private options', () => {
  assert.equal(TRACKER_WARNING_ANCHOR, 'troubleshooting/contact-support');
  assert.match(TRACKER_WARNING, /public issue tracker/);
  assert.deepEqual({ ...TRACKER_WARNING_LINK }, { label: 'Read private disclosure options', path: '/trust/disclosure' });
  assert.match(guide(TRACKER_WARNING_ANCHOR).overview, /public GitHub tracker/, 'the guide says the same thing');
  const src = read('src/pages/docs/DocsLayout.jsx');
  const go = src.indexOf('data-testid="help-guide-go"');
  const warn = src.indexOf('data-testid="help-guide-tracker-warning"');
  const body = src.indexOf('id="overview"');
  assert.ok(go > 0 && warn > go && warn < body, 'the warning follows the ticket button, before the guide body and any field');
  assert.match(src, /go && anchor === TRACKER_WARNING_ANCHOR/);
});

test('every search suggestion returns a public guide, first, from the signed-out search', () => {
  const fuse = createDocsFuse(undefined);
  assert.ok(searchSuggestions().length >= 3);
  for (const s of SEARCH_SUGGESTIONS) {
    assert.ok(PUBLIC_HELP_ANCHORS.has(s.anchor), `${s.anchor} is public`);
    const first = searchGuides(fuse, s.query).results[0];
    assert.ok(first, `"${s.query}" finds a guide`);
    assert.ok(PUBLIC_HELP_ANCHORS.has(first.anchor), `"${s.query}" first finds the public ${first.anchor}`);
    assert.equal(first.anchor, s.anchor, `"${s.query}" opens the guide it names`);
  }
  for (const gone of ['capital call', 'cap table', 'data room', 'invite an investor']) {
    assert.ok(!SEARCH_SUGGESTIONS.some((s) => s.query === gone), `${gone} is not suggested`);
  }
  assert.doesNotMatch(read('src/pages/docs/DocsLayout.jsx'), /invite an investor/);
});

test('a suggestion whose guide leaves the public index is not offered', () => {
  const had = PUBLIC_HELP_ANCHORS.has('getting-started/roles');
  PUBLIC_HELP_ANCHORS.delete('getting-started/roles');
  try {
    assert.ok(!searchSuggestions().some((s) => s.anchor === 'getting-started/roles'));
  } finally {
    if (had) PUBLIC_HELP_ANCHORS.add('getting-started/roles');
  }
});
