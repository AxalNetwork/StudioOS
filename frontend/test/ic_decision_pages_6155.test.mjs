// #6155 (D6155): the IC decision pages stop offering controls the Worker
// refuses, add Recuse, show conditions, light the Deals row, and say tallies
// in words and numbers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  canChangeDecision, recusalBody, ownRecusal, tallyText, canOpenCommitRoom, AUTHOR_ONLY_LINE, RECUSAL_FINAL_LINE,
} from '../src/pages/icDecisionModel.js';
import { SIDEBAR_GROUPS } from '../src/sidebarConfig.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, '../src', rel), 'utf8');

test('the author rule matches PUT /api/ic/:uid: the author or an Admin, nobody else', () => {
  const record = { created_by: 7 };
  assert.equal(canChangeDecision({ id: 7, role: 'partner' }, record), true, 'the author');
  assert.equal(canChangeDecision({ id: 7, role: 'investor' }, { created_by: '7' }), true, 'an id read as text is still the author');
  assert.equal(canChangeDecision({ id: 9, role: 'admin' }, record), true, 'an Admin');
  assert.equal(canChangeDecision({ id: 9, role: 'Admin' }, record), true, 'the Worker lowercases the role');
  assert.equal(canChangeDecision({ id: 9, role: 'partner' }, record), false, 'another partner');
  assert.equal(canChangeDecision({ id: 9, role: 'investor' }, record), false, 'another investor');
  assert.equal(canChangeDecision({ id: 9, role: 'partner' }, { created_by: null }), false, 'a record with no author');
  assert.equal(canChangeDecision({ role: 'partner' }, { created_by: null }), false, 'no id never matches no author');
  assert.equal(canChangeDecision(null, record), false);
});

test('the detail page gates Save memo, Record decision and Outcome on the author rule', () => {
  const src = read('pages/ICDecisionPage.jsx');
  assert.doesNotMatch(src, /canWrite/, 'the role-only gate is gone');
  assert.match(src, /const canChange = canChangeDecision\(user, d\);/);
  assert.match(src, /\{canChange \? \(\s*<>\s*<textarea/, 'the memo editor is the author’s');
  assert.match(src, /\{canChange && \(\s*<section[^>]*>\s*<h2[^>]*>Record decision/, 'Record decision and Outcome are the author’s');
  assert.match(src, /\{AUTHOR_ONLY_LINE\}/, 'everyone else reads one line saying who can change it');
  assert.match(AUTHOR_ONLY_LINE, /or an Admin/);
});

test('a recusal sends the declared conflict as its rationale, and nothing without one', () => {
  assert.deepEqual(recusalBody('  I hold shares in the company  '), { vote: 'recused', rationale: 'I hold shares in the company' });
  assert.equal(recusalBody('   '), null);
  assert.equal(recusalBody(undefined), null);
  const src = read('pages/ICDecisionPage.jsx');
  assert.match(src, /const body = recusalBody\(declaration\);\s*if \(!body\) return;/);
  assert.match(src, /await api\.icVote\(uid, body\)/);
  assert.match(src, /Declare the conflict/);
  assert.match(src, /\{RECUSAL_FINAL_LINE\}/, 'the control says it is final');
  assert.match(RECUSAL_FINAL_LINE, /final/);
  // A refused later vote shows the Worker's own words: the catch keeps e.message.
  assert.match(src, /const recuse = async[\s\S]*?catch \(e\) \{ fail\(e\); \}/);
});

test('a member who recused is told so and offered no further vote', () => {
  const votes = [{ user_id: 3, vote: 'yes' }, { user_id: 4, vote: 'recused', rationale: 'Family tie' }];
  assert.equal(ownRecusal({ id: 4 }, votes)?.rationale, 'Family tie');
  assert.equal(ownRecusal({ id: 3 }, votes), null, 'a yes is not a recusal');
  assert.equal(ownRecusal({ id: 5 }, votes), null);
  assert.equal(ownRecusal(null, votes), null);
  const src = read('pages/ICDecisionPage.jsx');
  assert.match(src, /\{canVote && !recusal && \(/);
});

test('tallies are words and numbers, recused beside them, Not recorded never 0', () => {
  assert.equal(tallyText({ yes: 3, no: 1, abstain: 0, recused: 2 }), 'Invest 3 · Pass 1 · Abstain 0 · Recused 2');
  assert.equal(tallyText({ yes: 2, no: 0, abstain: 1 }), 'Invest 2 · Pass 0 · Abstain 1 · Recused Not recorded');
  assert.equal(tallyText(null), 'Votes not recorded');
  for (const file of ['pages/ICDecisionPage.jsx', 'pages/ICDecisionsPage.jsx']) {
    const src = read(file);
    assert.match(src, /tallyText\(d\.tally\)/, `${file} uses the shared tally text`);
    assert.doesNotMatch(src, /👍|👎|➖/u, `${file} carries no emoji tally`);
  }
});

test('conditions use author controls, and Commit admits the owner-approved partner role', () => {
  assert.equal(canOpenCommitRoom('admin'), true);
  assert.equal(canOpenCommitRoom('investor'), true);
  assert.equal(canOpenCommitRoom('partner'), true, 'D6154: partners use Commit only');
  const app = read('App.jsx');
  assert.match(app, /path="\/deals\/commit" element=\{guard\(\['admin', 'partner', 'investor'\]/, 'the guard this rule mirrors');
  const src = read('pages/ICDecisionPage.jsx');
  assert.match(src, /\{canOpenCommitRoom\(role\) && \(\s*<Link to="\/deals\/commit"/);
  assert.match(src, /CONDITION_WORDS\[cond\.status\]/);
  assert.match(src, /canChange\?<form/);assert.match(src,/api\.icAddCondition/);
});

test('a failed read is Unreadable with Try again on both pages', () => {
  const detail = read('pages/ICDecisionPage.jsx');
  assert.match(detail, /DataState state=\{errState\} reason=\{`This IC record could not be read\./);
  assert.match(detail, /onClick=\{load\}[\s\S]{0,300}Try again/);
  const list = read('pages/investor/deals/CommitZone.jsx');
  assert.match(list, /room === UNAVAILABLE/);assert.match(list,/The committee record could not be read/);
  assert.match(list, /onRetry=\{load\}/);
});

test('/ic and /ic/:uid light the Deals row', () => {
  const lit = (row, path) => (row.match || [row.to]).some((p) => path === p || path.startsWith(`${p}/`));
  const deals = Object.values(SIDEBAR_GROUPS).flat().flatMap((g) => g.items || []).filter((r) => r.label === 'Deals');
  assert.ok(deals.length > 0, 'a Deals row exists');
  for (const row of deals) {
    assert.ok(lit(row, '/ic'), '/ic');
    assert.ok(lit(row, '/ic/abc123'), '/ic/:uid');
    assert.ok(!lit(row, '/icons'), 'a path that only starts with the letters does not light it');
  }
});
