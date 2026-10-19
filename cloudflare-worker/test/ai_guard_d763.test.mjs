/**
 * D763 (#2020, part 1) — the guard's rules as plain code (services/ai/guard.ts):
 * slicing, the verdict parser, the category policy and the refusal copy. No
 * binding: part 2's hooks in `run()` are tested with it.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/ai_guard_d763.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GUARD_CATEGORIES, GUARD_COPY, GUARD_SLICE_CHARS, WELLBEING_PATH, combine, decide, parseVerdict, refusalFor, sliceForGuard,
} from '../src/services/ai/guard.ts';

const words = (n, word = 'word') => Array.from({ length: n }, () => word).join(' ');

// ---------------------------------------------------------------------------
// Slicing
// ---------------------------------------------------------------------------

test('a text at or under the limit is one slice; an empty text has none', () => {
  assert.deepEqual(sliceForGuard(''), []);
  assert.deepEqual(sliceForGuard('hello'), ['hello']);
  const exact = 'x'.repeat(GUARD_SLICE_CHARS);
  assert.deepEqual(sliceForGuard(exact), [exact]);
  assert.equal(GUARD_SLICE_CHARS, 2000);
});

test('no slice is over 2,000 characters, and the slices join back to the text exactly', () => {
  const texts = [
    'y'.repeat(5000),
    words(1500),
    `${words(300)}.\n\n${words(300)}! ${words(300)}?\n\n\n${words(500)}`,
    Array.from({ length: 40 }, (_, i) => `Paragraph ${i}. ${words(20)}.`).join('\n\n'),
    `${'é'.repeat(2500)}\n\n${'漢'.repeat(2500)}`,
  ];
  for (const t of texts) {
    const slices = sliceForGuard(t);
    assert.equal(slices.join(''), t);
    for (const s of slices) {
      assert.ok(s.length > 0, 'no empty slice');
      assert.ok(s.length <= GUARD_SLICE_CHARS, `a slice of ${s.length}`);
    }
  }
  assert.equal(sliceForGuard('y'.repeat(5000)).length, 3, 'a 5,000-character text is three slices');
});

test('a slice ends at the last paragraph break inside it, before any sentence end', () => {
  const first = `${'a'.repeat(1200)}. More here.\n\n`;
  const text = `${first}${'b'.repeat(500)}. ${'c'.repeat(900)}`;
  const slices = sliceForGuard(text);
  assert.equal(slices[0], first, 'cut after the blank line');
  assert.equal(slices.join(''), text);
});

test('with no paragraph break, a slice ends after the last sentence end inside it', () => {
  const head = `${'a'.repeat(900)}. ${'b'.repeat(700)}? `;
  const text = `${head}${'c'.repeat(1500)}`;
  const slices = sliceForGuard(text);
  assert.equal(slices[0], head);
  assert.equal(slices[1], 'c'.repeat(1500));
});

test('with neither, a slice is cut at the limit', () => {
  const slices = sliceForGuard('z'.repeat(4100));
  assert.deepEqual(slices.map((s) => s.length), [2000, 2000, 100]);
});

test('a decimal point or a full stop with no space after it is not a sentence end', () => {
  const text = `${'a'.repeat(1000)} 3.14 e.g.x ${'b'.repeat(1500)}`;
  assert.deepEqual(sliceForGuard(text).map((s) => s.length), [2000, text.length - 2000]);
});

// ---------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------

test('safe and unsafe are read, with the codes in order and once each', () => {
  assert.deepEqual(parseVerdict('safe'), { verdict: 'safe' });
  assert.deepEqual(parseVerdict('  Safe \n'), { verdict: 'safe' });
  assert.deepEqual(parseVerdict('unsafe\nS1'), { verdict: 'unsafe', codes: ['S1'] });
  assert.deepEqual(parseVerdict('unsafe\nS10,S2, s10'), { verdict: 'unsafe', codes: ['S10', 'S2'] });
  assert.deepEqual(parseVerdict('UNSAFE\r\nS6'), { verdict: 'unsafe', codes: ['S6'] });
  assert.deepEqual(parseVerdict('unsafe'), { verdict: 'unsafe', codes: [] });
  assert.deepEqual(parseVerdict('unsafe\nS99'), { verdict: 'unsafe', codes: [] }, 'an unknown code is dropped');
});

test('anything else is unreadable, and unreadable is never safe', () => {
  for (const out of [undefined, null, 42, {}, '', '   ', 'yes', 'safe enough', 'The content is safe.', 'safe\nS1', 'S1', 'unsafe\nS1\nmore', 'unsafe S1']) {
    const v = parseVerdict(out);
    assert.deepEqual(v, { verdict: 'unreadable' }, JSON.stringify(out));
    assert.deepEqual(decide(v), { action: 'fail' });
  }
});

// ---------------------------------------------------------------------------
// The policy
// ---------------------------------------------------------------------------

test('S6 and S7 log; every other code blocks', () => {
  const codes = Object.keys(GUARD_CATEGORIES);
  assert.deepEqual(codes, Array.from({ length: 14 }, (_, i) => `S${i + 1}`));
  for (const c of codes) {
    const d = decide({ verdict: 'unsafe', codes: [c] });
    assert.equal(d.action, c === 'S6' || c === 'S7' ? 'log' : 'block', c);
    assert.deepEqual(d.codes, [c]);
  }
  assert.deepEqual(decide({ verdict: 'unsafe', codes: ['S6', 'S7'] }), { action: 'log', codes: ['S6', 'S7'] });
  assert.deepEqual(decide({ verdict: 'unsafe', codes: ['S6', 'S1'] }), { action: 'block', codes: ['S6', 'S1'] });
  assert.deepEqual(decide({ verdict: 'unsafe', codes: [] }), { action: 'block', codes: [] }, 'unsafe with no code we know blocks');
  assert.deepEqual(decide({ verdict: 'safe' }), { action: 'pass' });
});

test('slices combine: a failure fails, else a block blocks, else a log logs', () => {
  const pass = { action: 'pass' }, fail = { action: 'fail' };
  const log = (c) => ({ action: 'log', codes: [c] }), block = (c) => ({ action: 'block', codes: [c] });
  assert.deepEqual(combine([]), pass);
  assert.deepEqual(combine([pass, pass]), pass);
  assert.deepEqual(combine([pass, log('S6'), log('S7'), log('S6')]), { action: 'log', codes: ['S6', 'S7'] });
  assert.deepEqual(combine([log('S6'), block('S1'), block('S10'), block('S1')]), { action: 'block', codes: ['S1', 'S10'] });
  assert.deepEqual(combine([block('S1'), fail, pass]), fail);
});

// ---------------------------------------------------------------------------
// The copy
// ---------------------------------------------------------------------------

test("each refusal has Eadwyn's words and names no category", () => {
  assert.deepEqual(refusalFor('input', ['S1'], 'founder'), { message: GUARD_COPY.input, link: null });
  assert.deepEqual(refusalFor('output', ['S10'], 'admin'), { message: GUARD_COPY.output, link: null });
  assert.deepEqual(refusalFor('unavailable', [], 'founder'), { message: GUARD_COPY.unavailable, link: null });
  for (const message of Object.values(GUARD_COPY)) {
    assert.doesNotMatch(message, /\bS\d{1,2}\b/, 'no code in the copy');
    for (const { name } of Object.values(GUARD_CATEGORIES)) assert.equal(message.toLowerCase().includes(name.toLowerCase()), false, name);
  }
});

test('S11 has its own words; the Wellbeing link is drawn for a founder and an admin only', () => {
  for (const role of ['founder', 'admin', 'Founder']) {
    assert.deepEqual(refusalFor('input', ['S11'], role), { message: GUARD_COPY.selfHarm, link: { href: WELLBEING_PATH, label: 'Open Wellbeing' } }, role);
  }
  assert.equal(WELLBEING_PATH, '/wellbeing');
  for (const role of ['investor', 'partner', 'advisor', '', null, undefined]) {
    assert.deepEqual(refusalFor('output', ['S1', 'S11'], role), { message: GUARD_COPY.selfHarm, link: null }, String(role));
  }
  assert.deepEqual(refusalFor('unavailable', ['S11'], 'founder'), { message: GUARD_COPY.unavailable, link: null },
    'a guard that could not answer says so, whatever an earlier slice said');
});
