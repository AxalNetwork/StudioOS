/**
 * #5936 (D4838 part 10, PP03c) — Draft proposal from a lead, to the owner's answer A.
 *
 *   · Leads' card offers Draft proposal, which opens the opportunity sheet with the lead's draft;
 *   · a lead with no draft offers Write a draft; Save draft writes shape, price and scope;
 *   · a saved draft shows Edit and Discard, and Discard asks in place, naming the lead;
 *   · an Eadwyn draft reads "Eadwyn proposal · not sent", and every label says not sent;
 *   · the Eadwyn band is scoped to the lead and shows its cost before the run;
 *   · a failed read is Unreadable with Try again; nothing anywhere says a proposal was sent.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/lead_proposal_draft_5936.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { h, mountForm, propsOf } from './_form_d695.mjs';
import LeadProposalDraft, { draftBody, draftLabel, draftPrice } from '../src/pages/partner/pipeline/LeadProposalDraft.jsx';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const AI = { spend: null, loading: false };

function stubApi({ draft = null, fail = false } = {}) {
  const calls = [];
  let stored = draft;
  return {
    calls,
    get: async (needId) => { calls.push(['get', needId]); if (fail) throw Object.assign(new Error('down'), { status: 500 }); return { need_id: needId, draft: stored }; },
    save: async (needId, body) => { calls.push(['save', needId, body]); stored = { uid: 'd', need_id: needId, currency: 'USD', origin: stored?.origin || body.origin || 'manual', ...body }; return { ok: true, draft: stored }; },
    discard: async (needId) => { calls.push(['discard', needId]); stored = null; return { ok: true }; },
  };
}

test('#5936: the pure rules — label, price and the write body', () => {
  assert.equal(draftLabel({ origin: 'eadwyn' }), 'Eadwyn proposal · not sent');
  assert.equal(draftLabel({ origin: 'manual' }), 'Draft proposal · not sent');
  assert.equal(draftPrice({ price_cents: 1250000, currency: 'USD' }), '$12,500.00');
  assert.equal(draftPrice({ price_cents: null }), null, 'no price is Not recorded, never $0');
  assert.deepEqual(draftBody({ shape: 'retainer', price: '12,500', currency: 'usd', scope: ' Monthly ' }, 'manual').body,
    { shape: 'retainer', price_cents: 1250000, currency: 'USD', scope: 'Monthly', origin: 'manual' });
  assert.equal(draftBody({ shape: '', price: '', currency: 'USD', scope: '' }).error, 'Add a shape, a price or a scope, or discard the draft.');
  assert.match(draftBody({ price: '-4', currency: 'USD' }).error, /zero or more/);
  assert.match(draftBody({ price: 'lots', currency: 'USD' }).error, /zero or more/);
  assert.match(draftBody({ scope: 'x', currency: 'dollars' }).error, /three-letter/);
  assert.equal(draftBody({ scope: 'x', currency: 'USD' }).body.origin, undefined, 'an edit sends no origin, so the store keeps it');
});

test('#5936: no draft → Write a draft → Save draft writes the fields; nothing says sent', async () => {
  const api = stubApi();
  const s = await mountForm(h(LeadProposalDraft, { needId: 7, leadName: 'Verwood', api, ai: AI }));
  try {
    await s.flush();
    assert.ok(s.by('lead-draft-none'));
    await s.click('Write a draft');
    await act(async () => { propsOf(s.by('lead-draft-shape')).onChange({ target: { value: 'fixed_project' } }); });
    await act(async () => { propsOf(s.by('lead-draft-price')).onChange({ target: { value: '18000' } }); });
    await act(async () => { propsOf(s.by('lead-draft-scope')).onChange({ target: { value: 'Rebuild onboarding' } }); });
    await s.submit();
    await act(async () => { await tick(); });
    const save = api.calls.find((c) => c[0] === 'save');
    assert.deepEqual(save, ['save', 7, { shape: 'fixed_project', price_cents: 1800000, currency: 'USD', scope: 'Rebuild onboarding', origin: 'manual' }]);
    assert.ok(s.by('lead-draft-label'));
    assert.match(s.text(), /Draft proposal · not sent/);
    assert.match(s.text(), /Draft saved\. It has not been sent\./);
    assert.doesNotMatch(s.text().replace(/not (?:been )?sent|nothing is sent/g, ''), /\bsent\b/i, 'no line says a proposal was sent');
  } finally { await s.unmount(); }
});

test('#5936: an Eadwyn draft is marked, Edit keeps its origin, and Discard asks in place naming the lead', async () => {
  const api = stubApi({ draft: { uid: 'd', need_id: 7, shape: 'retainer', price_cents: null, currency: 'USD', scope: 'Eight weeks', origin: 'eadwyn' } });
  const s = await mountForm(h(LeadProposalDraft, { needId: 7, leadName: 'Verwood', api, ai: AI }));
  try {
    await s.flush();
    assert.match(s.text(), /Eadwyn proposal · not sent/);
    assert.match(s.text(), /Retainer/);
    await s.click('Edit');
    await act(async () => { propsOf(s.by('lead-draft-scope')).onChange({ target: { value: 'Ten weeks' } }); });
    await s.submit();
    await act(async () => { await tick(); });
    const save = api.calls.find((c) => c[0] === 'save');
    assert.equal(save[2].origin, undefined, 'an edit sends no origin');
    assert.match(s.text(), /Eadwyn proposal · not sent/, 'still marked after an edit');
    await s.click('Discard');
    assert.ok(s.by('lead-draft-discard-confirm'));
    assert.match(s.text(), /Discard the draft proposal for Verwood\? The lead stays on your list\./);
    assert.equal(api.calls.filter((c) => c[0] === 'discard').length, 0, 'nothing discarded before the confirm');
    await s.click('Discard draft');
    await act(async () => { await tick(); });
    assert.deepEqual(api.calls.filter((c) => c[0] === 'discard'), [['discard', 7]]);
    assert.ok(s.by('lead-draft-none'));
  } finally { await s.unmount(); }
});

test('#5936: a failed read is Unreadable with Try again, and draws no Eadwyn band or empty state', async () => {
  const api = stubApi({ fail: true });
  const s = await mountForm(h(LeadProposalDraft, { needId: 7, leadName: 'Verwood', api, ai: AI }));
  try {
    await s.flush();
    assert.ok(s.by('lead-draft-unreadable'));
    assert.equal(s.by('lead-draft-none'), undefined, 'a failed read is not "no draft"');
    assert.doesNotMatch(s.text(), /Draft with Eadwyn/);
  } finally { await s.unmount(); }
});

test('#5936: wiring — Leads opens the sheet with the draft; the band is scoped, priced first and never sends', () => {
  const zone = read('frontend/src/pages/partner/pipeline/LeadsZone.jsx');
  assert.match(zone, /data-testid="lead-draft-proposal"[^>]*>\s*Draft proposal/);
  assert.match(zone, /<OpportunitySheet[\s\S]*opportunity=\{\{ needId: drafting\?\.need_id \}\}[\s\S]*editors=\{\{ Overview: <LeadProposalDraft needId=\{drafting\?\.need_id\}/);
  assert.match(zone, /<ZoneDraft\s+surface="pipeline\/leads"\s+scoped/, "the page band keeps to its own unscoped drafts");
  const draft = read('frontend/src/pages/partner/pipeline/LeadProposalDraft.jsx');
  assert.match(draft, /surface="pipeline\/leads" scopeKey=\{String\(needId\)\} scoped/);
  assert.match(draft, / ai=\{ai\}/, 'the cost is shown before the run (D424)');
  assert.match(draft, /label="Eadwyn proposal · not sent"/);
  assert.match(draft, /save\(\{ \.\.\.formOf\(draft\), scope: item\.body \}, 'eadwyn'\)/);
  assert.doesNotMatch(draft, />\s*Send\b/, 'there is no Send');
  const api = read('frontend/src/lib/api/partnerLeadDrafts.js');
  for (const method of ['PUT', 'DELETE']) assert.match(api, new RegExp(`method: '${method}'`));
  const worker = read('cloudflare-worker/src/routes/partner_pipeline.ts');
  for (const route of ["get('/leads/:needId/draft'", "put('/leads/:needId/draft'", "delete('/leads/:needId/draft'"]) assert.ok(worker.includes(route), route);
});
