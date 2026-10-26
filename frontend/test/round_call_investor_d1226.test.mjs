/**
 * D1226 (#3225), CLS13: the investor's round-call page. It names the company
 * and no other investor, an amount is Indicated and never committed, the NDA
 * and the founder's grant gate the data room, a closed call is read-only, and
 * the founder's and counsel's views are not the investor's. Each rendered
 * check is mutation-checked at the bottom.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformWithOxc } from 'vite';
import { renderedText } from './_renderedText.mjs';
import * as actual from '../src/pages/founder/RoundCallPage.jsx';

const PAGE = 'frontend/src/pages/founder/RoundCallPage.jsx';
const on = new Proxy({}, { get: () => () => {} });
const call = { uid: 'call', project_id: 1, name: 'Seed extension', amount_cents: 150000000, instrument: 'safe', terms: 'Recorded terms', minimum_cheque_cents: 2500000,
  target_close: '2099-11-15', sent_at: '2098-10-01 09:00:00', state: 'sent', deck_version: 7, valuation_cap_cents: 1000000000, discount_bps: null, pre_money_cents: null };
// Fields an investor's read never carries, planted to prove the page would not draw them.
const leaks = { recipients: [{ name: 'Other Investor', email: 'other@example.test', commitment_cents: 9900000 }],
  progress: { received: 3, opened: 2, data_room_requests: 1, commitments: 1, committed_cents: 9900000, target_cents: 150000000 } };
const investor = (o = {}) => ({ viewer: 'investor', company: { name: 'Acme Robotics' }, call, deck: null, read_only: false, recipient: { commitment_cents: null, data_room_requested_at: null },
  questions: [{ uid: 'q', question: 'What is the runway?', answer: null, asked_at: '2098-10-02 10:00:00', name: 'Nosy Name' }],
  data_room: { recorded: true, nda_signed: false, has_grant: false, path: null }, ...leaks, ...o });
const base = { busy: false, error: '', message: '', amount: '', question: '', answers: {}, target: '', reference: '', recipientPage: 0 };
const html = (m, data, s = {}) => renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(m.RoundCallPageView, { state: { ...base, data, ...s }, on })));
/** The `<button>` whose text is exactly `label`: its opening tag, or 'MISSING'. */
function button(markup, label) {
  for (const m of markup.matchAll(/<button\b[^>]*>(.*?)<\/button>/g)) if (renderedText(m[1]) === label) return m[0].slice(0, m[0].indexOf('>') + 1);
  return 'MISSING';
}

const checks = {
  nameless(m) {
    const text = renderedText(html(m, investor()));
    assert.deepEqual([/Other Investor|other@example|Nosy Name/.test(text), text.includes('You asked on')], [false, true], 'no other investor, and no name on a question');
  },
  company(m) {
    const markup = html(m, investor()), text = renderedText(markup);
    assert.deepEqual([text.includes('A private round call from Acme Robotics'), text.includes('Deals › Round calls › Acme Robotics'), markup.includes('href="/deals"'),
      text.includes('Seed extension · sent to you on 01/10/2098 · closes 15/11/2099')], [true, true, true, true]);
    const unnamed = renderedText(html(m, investor({ company: { name: null } })));
    assert.deepEqual([unnamed.includes('A private round call from'), unnamed.includes('Round calls › Seed extension'), unnamed.includes('Your question for')], [false, true, false]);
    assert.ok(html(m, investor({ company: { name: null } })).includes('placeholder="Your question for the founders"'));
  },
  indicated(m) {
    const done = renderedText(html(m, investor({ recipient: { commitment_cents: 5000000 } })));
    assert.equal(/commit/i.test(done), false, 'the investor never reads Commit');
    assert.match(done, /Indicated · \$50,000\./);
    assert.match(done, /This records your intention\. It is not a payment or a signed investment\./);
    assert.notEqual(button(html(m, investor()), 'Indicate an amount'), 'MISSING');
  },
  range(m) {
    const at = (amount) => button(html(m, investor(), { amount }), 'Indicate an amount').includes(' disabled=""');
    assert.deepEqual([at(''), at('24999'), at('25000'), at('1500000'), at('1500001'), at('abc')], [true, true, false, false, true, true]);
    assert.match(renderedText(html(m, investor(), { amount: '100' })), /outside the call’s minimum cheque and target/);
  },
  nda(m) {
    const room = (o, r = {}) => html(m, investor({ data_room: { recorded: true, nda_signed: false, has_grant: false, path: null, ...o }, recipient: { commitment_cents: null, data_room_requested_at: null, ...r } }));
    const unsigned = room({ has_grant: true, path: '/research/diligence/g' }), signed = room({ nda_signed: true }), asked = room({ nda_signed: true }, { data_room_requested_at: '2098-10-03' }),
      open = room({ nda_signed: true, has_grant: true, path: '/research/diligence/g' }), none = room({ recorded: false });
    assert.deepEqual([unsigned.includes('/research/diligence/g'), renderedText(unsigned).includes('Sign the NDA to ask for access'), button(unsigned, 'Request the NDA') !== 'MISSING', button(unsigned, 'Ask for access')],
      [false, true, true, 'MISSING'], 'without the NDA the room stays shut, whatever the grant');
    assert.deepEqual([button(signed, 'Ask for access') !== 'MISSING', signed.includes('/research/diligence/'), renderedText(asked).includes('You asked for access on 03/10/2098'), button(asked, 'Ask for access')], [true, false, true, 'MISSING']);
    assert.deepEqual([open.includes('href="/research/diligence/g"'), renderedText(none).includes('Not recorded · no data room is linked')], [true, true]);
  },
  closed(m) {
    const closed = html(m, investor({ call: { ...call, state: 'closed' }, read_only: true })), text = renderedText(closed);
    assert.deepEqual([text.includes('This call is closed.'), text.includes('You can no longer indicate an amount or ask a question.'), button(closed, 'Indicate an amount'), button(closed, 'Ask a question'), button(closed, 'Request the NDA'),
      closed.includes('<textarea'), closed.includes('data-testid="indicate-amount"'), text.includes('Recorded terms'), text.includes('Open the deck')], [true, true, 'MISSING', 'MISSING', 'MISSING', false, false, true, true]);
    const status = (data) => renderedText(html(m, data)).match(/A private round call from Acme Robotics(Open|Closed|Paused)/)?.[1];
    assert.deepEqual([status(investor()), status(investor({ read_only: true, call: { ...call, state: 'closed' } })), status(investor({ read_only: true, call: { ...call, state: 'awaiting_counsel' } }))], ['Open', 'Closed', 'Paused']);
  },
  plain(m) {
    assert.equal(m.plainTerms(call), 'A SAFE for up to $1,500,000 with a valuation cap of $10,000,000. The smallest cheque is $25,000, and the call closes on 15/11/2099.');
    assert.equal(m.plainTerms({ ...call, instrument: 'convertible_note', discount_bps: 2000 }), 'A convertible note for up to $1,500,000 with a valuation cap of $10,000,000 and a 20% discount. The smallest cheque is $25,000, and the call closes on 15/11/2099.');
    assert.equal(m.plainTerms({ ...call, instrument: 'equity', valuation_cap_cents: null, pre_money_cents: 800000000, minimum_cheque_cents: null }), 'A priced equity round for up to $1,500,000 with a pre-money valuation of $8,000,000. The call closes on 15/11/2099.');
    assert.equal(m.plainTerms({ ...call, instrument: 'other' }), null);
    const text = renderedText(html(m, investor({ call: { ...call, valuation_cap_cents: null } })));
    assert.match(text, /Valuation capNot recorded/, 'a missing term reads Not recorded, never a zero');
  },
  others(m) {
    const founder = renderedText(html(m, { ...investor(), viewer: 'counsel', counsel_approved: false, call: { ...call, state: 'awaiting_counsel' }, read_only: true }));
    assert.deepEqual([founder.includes('Record counsel’s approval'), founder.includes('Other Investor · other@example.test'), founder.includes('A private round call from')], [true, true, false], 'counsel keeps its own view');
  },
};
for (const [name, check] of Object.entries(checks)) test('D1226 ' + name, () => check(actual));

test('D1226 the investor Deals row lights on a round call', () => {
  const src = readFileSync('frontend/src/sidebarConfig.js', 'utf8');
  assert.match(/label: 'Deals',\s*\n?\s*match: \[([^\]]*)\]/.exec(src)?.[1] || '', /'\/round-calls'/);
});

async function altered(old, replacement, index) {
  let source = readFileSync(PAGE, 'utf8');
  if (!source.includes(old)) throw Error('Stale mutation: ' + old);
  source = source.replace(old, replacement);
  const { code } = await transformWithOxc(source, resolve(PAGE), { jsx: { runtime: 'automatic' } });
  const req = createRequire(pathToFileURL(resolve(PAGE)));
  const js = code.replace(/^(import [^;]*? from )(['"])([^'"]+)\2/gm, (_m, head, q, spec) => {
    let target;
    if (spec.startsWith('.')) {
      target = resolve(dirname(PAGE), spec);
      if (existsSync(target) && statSync(target).isDirectory()) target = ['.jsx', '.js'].map((e) => resolve(target, 'index' + e)).find(existsSync);
      else if (!existsSync(target)) target = ['.jsx', '.js', '.ts'].map((e) => target + e).find(existsSync);
    } else target = req.resolve(spec);
    return head + q + pathToFileURL(target).href + q;
  });
  return import('data:text/javascript;base64,' + Buffer.from(js + '\n// d1226-' + index).toString('base64'));
}
const probes = [
  ['nameless', "if(s.data.viewer==='investor')return", 'if(false)return'],
  ['nameless', 'You asked on {callDate(q.asked_at)}', '{q.name} asked on {callDate(q.asked_at)}'],
  ['company', "{company?`A private round call from ${company}`:'A private round call'}", "{'A private round call'}"],
  ['company', '<span>{company||c.name}</span>', '<span>{c.name}</span>'],
  ['indicated', '>Indicate an amount</button>', '>Commit with an amount</button>'],
  ['indicated', 'Indicated · {moneyCents(mine.commitment_cents)}.', 'Committed · {moneyCents(mine.commitment_cents)}.'],
  ['range', 'const outOfRange=cents!=null&&', 'const outOfRange=false&&'],
  ['nda', 'room.path&&room.nda_signed&&room.has_grant', 'room.path'],
  ['nda', ':mine.data_room_requested_at?', ':false?'],
  ['closed', '{!d.read_only&&<><textarea data-testid="question"', '{true&&<><textarea data-testid="question"'],
  ['closed', "const status=d.read_only?", 'const status=false?'],
  ['plain', "c.discount_bps!=null&&'a '+(c.discount_bps/100)+'% discount'", 'false'],
  ['plain', "...(c.instrument==='equity'?[['Pre-money valuation',moneyCents(c.pre_money_cents)]]:[['Valuation cap',moneyCents(c.valuation_cap_cents)]]),", "['Valuation cap','$0'],"],
];
for (const [index, [name, old, replacement]] of probes.entries()) test(`D1226 mutation ${index}: ${name}`, async () => {
  const mod = await altered(old, replacement, index);
  assert.throws(() => checks[name](mod), assert.AssertionError);
  checks[name](actual);
});
