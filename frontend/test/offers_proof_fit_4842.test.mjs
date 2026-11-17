/**
 * #4842 (D4842) — Offers Proof and Audience fit, built to Offers v2 (OF-03, OF03b,
 * OF03c, OF-04, OF04b). Mounted with the API stubbed:
 *
 *   1. Every consent state is its own label (icon and word), named accurately,
 *      with its stored date and engagement; Declined is not called Withdrawn.
 *   2. The five chips count every item on the page and select on the card's own
 *      label; Superseded and never-asked count as Self-stated.
 *   3. A card leads with the result and the client; its second action follows
 *      its state, and a self-stated card's opens the ask.
 *   4. The empty states name the commercial outcome with one action.
 *   5. Audience fit draws one rules table; a rule with nothing to say is the
 *      primary Add reply, and opening it edits that rule.
 *   6. The sheet starts as a great-fit profile, sends a strength only on a
 *      profile, and switching kind under Advanced changes the questions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadZone, mountZone, stubApi } from './_offers_4688.mjs';

const consent = (state, o = {}) => ({
  id: Math.floor(Math.random() * 1e9), uid: `${state}-${Math.random()}`, consenter_name: 'Jo Park', consenter_role: 'COO',
  state, revision: 1, consent_given: state === 'confirmed', consent_given_at: null, withdrawn_at: null,
  requested_at: null, invite_token: state === 'requested' ? 'tok' : null, ...o,
});
const item = (id, o) => ({ id, uid: `p${id}`, kind: 'case_study', title: `Engagement ${id}`, detail: '', outcome_note: null,
  is_published: false, founder_name: null, need_title: null, consents: [], ...o });

const PROOF = [
  item(1, { outcome_note: 'Onboarding from 14 days to 5', founder_name: 'Acme', need_title: 'Acme rollout', is_published: true,
    consents: [consent('confirmed', { consent_given_at: '2026-10-18 09:00:00' })] }),
  item(2, { outcome_note: 'Seed round in 9 weeks', consents: [consent('requested', { requested_at: '2026-11-02 10:00:00' })] }),
  item(3, { outcome_note: 'Close from 12 to 4 days' }),
  item(4, { outcome_note: 'Three EU markets', consents: [consent('withdrawn', { consent_given_at: '2026-10-01 10:00:00', withdrawn_at: '2026-10-30 10:00:00' })] }),
  item(5, { outcome_note: 'Hired a CTO', consents: [consent('declined', { withdrawn_at: '2026-10-29 10:00:00' })] }),
  item(6, { outcome_note: 'Churn halved', consents: [consent('superseded', { consent_given_at: '2026-09-01 10:00:00' })] }),
];

const cards = (m) => m.nodes().filter((n) => m.props(n)?.['data-testid'] === 'proof-card');
const keyOf = (m, n) => m.props(n)['data-consent'];
// The sheet's strength control, by role: the toolbar's filter chips share its words.
const radios = (m) => m.nodes().filter((n) => n.tagName === 'BUTTON' && m.props(n)?.role === 'radio');
const pickRadio = async (m, label) => {
  const n = radios(m).find((r) => (r.textContent || '').trim() === label);
  assert.ok(n, `no ${label} radio`);
  m.props(n).onClick();
  await m.flush();
};
const buttonText = (m) => m.nodes().filter((n) => n.tagName === 'BUTTON').map((n) => (n.textContent || '').trim());

async function withProof(rows, fn, extra = {}) {
  const restore = stubApi({ listPartnerProof: async () => ({ items: rows, published_count: 1, page: 1 }), ...extra });
  const m = await mountZone(await loadZone('ProofZone.jsx'));
  try { await m.flush(); await fn(m); } finally { await m.unmount(); restore(); }
}

test('every consent state is its own label, named accurately, with its stored date', async () => {
  await withProof(PROOF, async (m) => {
    assert.deepEqual(cards(m).map((n) => keyOf(m, n)), ['approved', 'requested', 'self_stated', 'withdrawn', 'declined', 'superseded']);
    const t = m.text();
    for (const word of ['Client approved', 'Approval requested', 'Self-stated', 'Withdrawn', 'Declined', 'Superseded']) {
      assert.ok(t.includes(word), `${word} is not drawn`);
    }
    assert.match(t, /Approved 18 Oct 2026 by Jo Park, COO/);
    assert.match(t, /Requested 2 Nov 2026 from Jo Park/);
    assert.match(t, /Withdrawn 30 Oct 2026 by Jo Park, COO/);
    assert.match(t, /Declined 29 Oct 2026 by Jo Park, COO/);
    assert.match(t, /Approved 1 Sept? 2026 for an earlier wording/);
    assert.match(t, /Linked to Acme rollout/);
    assert.match(t, /No engagement linked/);
    // Only the approved card is published; the page never promises a public page.
    assert.equal((t.match(/\bPublished\./g) || []).length, 1, 'more than one card says it is published');
    assert.ok(!/Shown across Axal|public profile/.test(t));
  });
});

test('the five chips count the whole page and select on the card’s own label', async () => {
  await withProof(PROOF, async (m) => {
    const b = buttonText(m);
    for (const chip of ['All 6', 'Client approved 1', 'Approval requested 1', 'Self-stated 2', 'Withdrawn 2']) {
      assert.ok(b.includes(chip), `chip ${chip} is missing: ${b.join(' | ')}`);
    }
    await m.click('Self-stated 2'); await m.flush();
    assert.deepEqual(cards(m).map((n) => keyOf(m, n)), ['self_stated', 'superseded']);
    assert.ok(buttonText(m).includes('All 6'), 'a count changed because a chip was clicked');
    await m.click('Withdrawn 2'); await m.flush();
    assert.deepEqual(cards(m).map((n) => keyOf(m, n)), ['withdrawn', 'declined']);
    await m.click('Client approved 1'); await m.flush();
    assert.deepEqual(cards(m).map((n) => keyOf(m, n)), ['approved']);
  });
});

test('a card leads with the result and the client, and its second action follows its state', async () => {
  await withProof([PROOF[0], PROOF[2]], async (m) => {
    const [approved] = cards(m);
    const first = approved.childNodes.find((n) => n.tagName === 'H3');
    assert.equal((first.textContent || '').trim(), 'Onboarding from 14 days to 5', 'the card does not lead with the outcome');
    assert.ok(m.text().includes('Acme'));
    const b = buttonText(m);
    assert.ok(b.includes('Manage consent') && b.includes('Request client approval'));
    assert.ok(!m.hasField('Who is being asked'), 'the ask is open before it is asked for');
    await m.click('Request client approval'); await m.flush();
    assert.ok(m.hasField('Who is being asked'), 'a self-stated card’s second action does not open the ask');
    // The consent record is behind View proof, not on the card.
    assert.ok(!m.text().includes('Consent record'));
    await m.click('Manage consent'); await m.flush();
    assert.ok(m.text().includes('Consent record'), 'Manage consent does not open the consent record');
  });
});

test('the empty states name the commercial outcome with one action', async () => {
  await withProof([], async (m) => {
    assert.ok(m.text().includes('Show founders why they should hire you'));
    assert.ok(m.has('Add your first proof'));
  });
  const restore = stubApi({ listPartnerFitRules: async () => ({ items: [], unstated_count: 0 }) });
  const m = await mountZone(await loadZone('AudienceFitZone.jsx'));
  try {
    await m.flush();
    assert.ok(m.text().includes('Tell Pipeline who your firm is for'));
    assert.match(m.text(), /Nothing is declined for you\./);
    assert.ok(m.has('Add your first fit rule'));
  } finally { await m.unmount(); restore(); }
});

const RULES = [
  { id: 1, kind: 'best_fit', value: 'B2B SaaS, seed to Series A', signal: 'best_fit', statement: 'We have done this for SaaS teams.', referred_to: null, is_active: 1, floor_cents: null },
  { id: 2, kind: 'budget_floor', value: null, signal: null, statement: null, referred_to: 'Granite Advisory', is_active: 1, floor_cents: 2500000 },
];

async function withFit(fn) {
  const calls = { create: [], update: [] };
  const rows = RULES.map((r) => ({ ...r }));
  const restore = stubApi({
    listPartnerFitRules: async () => ({ items: rows, unstated_count: 1, enforcement_note: 'Pipeline ranks; nothing is auto-declined.' }),
    createPartnerFitRule: async (p) => { calls.create.push(p); return {}; },
    updatePartnerFitRule: async (id, p) => { calls.update.push([id, p]); return {}; },
  });
  const m = await mountZone(await loadZone('AudienceFitZone.jsx'));
  try { await m.flush(); await fn(m, calls); } finally { await m.unmount(); restore(); }
}

test('Audience fit is one rules table, and a rule with nothing to say is the primary Add reply', async () => {
  await withFit(async (m, calls) => {
    const t = m.text();
    assert.ok(t.includes('Pipeline uses these rules to rank and explain your leads. They never reject a founder on their own.'));
    assert.ok(t.includes('Great fit') && t.includes('Not a fit'));
    assert.ok(t.includes('Projects below $25,000'));
    assert.ok(t.includes('No reply yet'));
    assert.ok(t.includes('Granite Advisory'));
    assert.ok(m.has('Add reply') && m.has('Edit'));
    await m.click('Add reply'); await m.flush();
    assert.ok(m.editor('rule-editor'), 'Add reply does not open the sheet');
    assert.equal(m.value('Minimum engagement'), '25000', 'the sheet is not editing that rule');
    await m.fill('When someone isn’t a fit, what should we say?', 'We start at $25,000.');
    await m.click('Save rule'); await m.flush();
    assert.equal(calls.update.length, 1);
    assert.equal(calls.update[0][0], 2);
    assert.equal(calls.update[0][1].statement, 'We start at $25,000.');
    assert.equal(calls.update[0][1].signal, null, 'an exclusion was sent a strength');
  });
});

test('a new rule starts as a great-fit profile, and Advanced changes the questions', async () => {
  await withFit(async (m, calls) => {
    await m.click('+ Add fit rule'); await m.flush();
    assert.ok(m.text().includes('Who is a great fit?'));
    assert.ok(!m.hasField('Rule type'), 'the rule types lead instead of being disclosed');
    await m.fill('Client type or sector', 'Climate hardware');
    await pickRadio(m, 'Qualified');
    await m.fill('What should we say to them?', 'We know this market.');
    await m.fill('Can we point them somewhere else?', 'Kestrel');
    await m.click('Save rule'); await m.flush();
    assert.deepEqual(calls.create[0], {
      kind: 'best_fit', floor_cents: null, value: 'Climate hardware', statement: 'We know this market.', referred_to: 'Kestrel', signal: 'qualified',
    });
    await m.click('+ Add fit rule'); await m.flush();
    await m.click('Advanced rule types ▾'); await m.flush();
    assert.ok(m.hasField('Rule type'));
    await m.fill('Rule type', 'sector_declined'); await m.flush();
    assert.ok(m.text().includes('Who isn’t a fit?'), 'the questions did not follow the kind');
    assert.ok(m.hasField('Sector you decline'));
    assert.equal(radios(m).length, 0, 'an exclusion is offered a strength');
  });
});
