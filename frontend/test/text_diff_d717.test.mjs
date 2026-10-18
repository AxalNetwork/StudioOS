// D717 (#1782) decision 9 — version compare's pure diff (frontend/src/lib/textDiff.js).
// Word by word; above WORD_CAP words a side, line by line, and it says so.
import test from 'node:test';
import assert from 'node:assert/strict';
import { diffText, metaChanges, WORD_CAP, EDIT_BUDGET } from '../src/lib/textDiff.js';

const side = (d, ops) => d.parts.filter((p) => ops.includes(p.op)).map((p) => p.text).join('');

test('D717 an insertion, a deletion and a replacement are marked word by word, and both texts rebuild exactly', () => {
  const ins = diffText('The Fund pays the fee.', 'The Fund pays the quarterly fee.');
  assert.equal(ins.mode, 'words');
  assert.deepEqual(ins.parts.filter((p) => p.op !== 'eq'), [{ op: 'ins', text: 'quarterly ' }]);

  const del = diffText('The GP may, at its sole discretion, waive the fee.', 'The GP may waive the fee.');
  assert.deepEqual(del.parts.filter((p) => p.op !== 'eq').map((p) => p.op), ['del', 'ins']);
  assert.equal(side(del, ['eq', 'del']), 'The GP may, at its sole discretion, waive the fee.');
  assert.equal(side(del, ['eq', 'ins']), 'The GP may waive the fee.');

  const swap = diffText('Section 4.2 applies.', 'Section 5.1 applies.');
  assert.deepEqual(swap.parts, [{ op: 'eq', text: 'Section ' }, { op: 'del', text: '4.2 ' }, { op: 'ins', text: '5.1 ' }, { op: 'eq', text: 'applies.' }]);
  assert.equal(swap.inserted, 1);
  assert.equal(swap.deleted, 1);
});

test('D717 an unchanged text has one equal part and no changes; empty sides are whole insertions or deletions', () => {
  const same = diffText('No change.\n\nAt all.', 'No change.\n\nAt all.');
  assert.equal(same.changed, false);
  assert.deepEqual(same.parts, [{ op: 'eq', text: 'No change.\n\nAt all.' }]);
  assert.deepEqual(diffText('', 'New body.').parts, [{ op: 'ins', text: 'New body.' }]);
  assert.deepEqual(diffText('Old body.', '').parts, [{ op: 'del', text: 'Old body.' }]);
  assert.deepEqual(diffText('', '').parts, []);
});

test('D717 random edits always rebuild both sides', () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const text = () => Array.from({ length: Math.floor(rnd() * 40) }, () => ['fund', 'fee', 'GP', 'LP', '{{x}}'][Math.floor(rnd() * 5)])
    .join(rnd() < 0.2 ? '\n' : ' ');
  for (let i = 0; i < 400; i++) {
    const a = text(); const b = text();
    const d = diffText(a, b);
    assert.equal(side(d, ['eq', 'del']), a, `case ${i}`);
    assert.equal(side(d, ['eq', 'ins']), b, `case ${i}`);
    assert.equal(d.changed, a !== b, `case ${i}`);
  }
});

test('D717 above the word cap the compare goes line by line and says so', () => {
  assert.equal(WORD_CAP, 20000);
  const big = Array.from({ length: WORD_CAP + 1 }, (_, i) => `w${i}`).join(' ');
  const d = diffText(`${big}\nlast line`, `${big}\nchanged line`);
  assert.equal(d.mode, 'lines');
  assert.equal(d.capped, true);
  assert.equal(d.reason, 'word_cap');
  assert.deepEqual(d.parts.filter((p) => p.op !== 'eq'), [{ op: 'del', text: 'last line' }, { op: 'ins', text: 'changed line' }]);
  const under = diffText('a b c', 'a x c', { cap: 3 });
  assert.equal(under.mode, 'words', 'exactly the cap is still word by word');
  assert.equal(diffText('a b c d', 'a b c e', { cap: 3 }).mode, 'lines');
  assert.equal(diffText('a b c d', 'a b', { cap: 3 }).mode, 'lines', 'one side over the cap is enough');
  assert.equal(diffText('a b', 'a b c d', { cap: 3 }).mode, 'lines');
});

test('D717 past the edit budget it falls back to lines, then to the whole text, and stays fast', () => {
  const a = Array.from({ length: 5000 }, (_, i) => `a${i}`).join(' ');
  const b = Array.from({ length: 5000 }, (_, i) => `b${i}`).join(' ');
  const t = Date.now();
  const d = diffText(a, b);
  assert.ok(Date.now() - t < 2000, 'a wholly different text does not stall the tab');
  assert.equal(d.reason, 'edit_budget');
  assert.equal(side(d, ['eq', 'del']), a);
  assert.equal(side(d, ['eq', 'ins']), b);
  const lines = (p) => Array.from({ length: EDIT_BUDGET + 10 }, (_, i) => `${p}${i}`).join('\n');
  const whole = diffText(lines('x'), lines('y'), { cap: 10 });
  assert.equal(whole.mode, 'whole');
  assert.deepEqual(whole.parts.map((p) => p.op), ['del', 'ins']);
});

test('D717 title, kind and party changes are listed above the text; null means from the slug', () => {
  assert.deepEqual(metaChanges({ title: 'PPM', doc_kind: null, axal_party: 'gp' }, { title: 'PPM v2', doc_kind: 'agreement', axal_party: 'gp' }), [
    { field: 'title', from: 'PPM', to: 'PPM v2' },
    { field: 'kind', from: null, to: 'agreement' },
  ]);
  assert.deepEqual(metaChanges({ title: 'A', axal_party: 'fund' }, { title: 'A', axal_party: null }), [{ field: 'party', from: 'fund', to: null }]);
  assert.deepEqual(metaChanges({ title: 'A' }, { title: 'A' }), []);
});
