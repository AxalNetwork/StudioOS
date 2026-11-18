/**
 * D7168 (#7168) — My funds and the fund dossier (canvas D7033, FND-S01 to
 * FND-S05): the Directory's map by catalogue uid, the count strip's scope,
 * paging, per-field drafts that a save of another field never discards, the
 * conflict Sheet, Write into the note waiting for the note, and the identity
 * block and public record.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/research_my_funds_7168.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import FundDossier from '../src/pages/research/FundDossier.jsx';
import { IdentityBand, PublicRecordCard } from '../src/pages/research/FundIdentity.jsx';
import {
  acceptWaitReason, combineNotes, countScopeLine, dirtyFields, dossierMap, draftsFrom, identityChip,
  mergeDrafts, offsetOf, pageLine,
} from '../src/pages/research/myFundsRead.js';
import { api } from '../src/lib/api.js';
import { mountContracts } from './_contracts_dom.mjs';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const byTid = (ui, id) => ui.nodes().find((n) => ui.props(n)?.['data-testid'] === id) || null;
const textOf = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(textOf).join('') : n.textContent || '');
const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));

// ── The readings ────────────────────────────────────────────────────────────

test('the Directory opens each vehicle by catalogue uid: two names that normalise alike open two entries', () => {
  const map = dossierMap([
    { catalogue_uid: 'atlas-a-i', uid: 'f_7Q2K' },
    { catalogue_uid: 'atlasai', uid: 'f_9M4T' },
  ], { 'new-one': 'f_NEW', atlasai: 'f_STALE' });
  assert.equal(map.get('atlas-a-i'), 'f_7Q2K');
  assert.equal(map.get('atlasai'), 'f_9M4T', 'the list as read wins over a stale created row');
  assert.equal(map.get('new-one'), 'f_NEW');
  assert.equal(map.has('Atlas AI'), false, 'no key is a name');
});

test('the count strip says what it counts, and the page line pages past 500', () => {
  assert.equal(countScopeLine({ counts_scope: 'all_saved', saved_count: 1284 }),
    'Counted over all 1,284 funds you saved, whatever the page or filter.');
  assert.equal(countScopeLine({ items: [] }), 'Counted over your 500 most recently saved funds.',
    'a Worker that does not page is the newest 500, and the strip says so');
  assert.equal(countScopeLine(null), null);
  const p = pageLine(1284, 50, 0);
  assert.deepEqual([p.text, p.pageText], ['Showing 1–50 of 1,284', 'Page 1 of 26']);
  const last = pageLine(1284, 50, 1250);
  assert.deepEqual([last.from, last.to, last.page], [1251, 1284, 26]);
  assert.equal(pageLine(0, 50, 0), null);
  assert.equal(offsetOf(26, 1284), 1250);
  assert.equal(offsetOf(99, 1284), 1250, 'a page past the end is the last page');
  assert.equal(offsetOf(0, 1284), 0);
});

test('every row names its identity, never inferred from a name', () => {
  assert.deepEqual(identityChip({ identity: 'linked', catalogue_uid: 'atlas-a-i' }), { kind: 'linked', label: 'Catalogue · atlas-a-i' });
  assert.deepEqual(identityChip({ identity: 'own' }), { kind: 'own', label: 'Your own record' });
  assert.deepEqual(identityChip({ identity: 'legacy' }), { kind: 'legacy', label: 'Needs a choice' });
});

test('a save refreshes the fields it sent and the idle ones, and keeps unsaved text in the rest', () => {
  const opened = { note: 'Led two seeds.', thesis: 'Physical work.', cheque_min_cents: 15_000_000, stage_fit: null };
  const typing = { ...draftsFrom(opened), note: 'Led two seeds.\nAsk about reserves.' };
  assert.deepEqual(dirtyFields(typing, opened), ['note']);
  // A stage save answers with the stored row; nobody sent the note.
  const afterStage = { ...opened, stage_fit: 'right', thesis: 'Physical work, first cheque to A.' };
  const kept = mergeDrafts(typing, opened, afterStage, []);
  assert.equal(kept.note, 'Led two seeds.\nAsk about reserves.', 'changing the stage discarded the note being typed');
  assert.equal(kept.thesis, 'Physical work, first cheque to A.', 'an idle field follows the stored row');
  // Saving the note itself takes the stored value.
  const afterNote = { ...afterStage, note: 'Led two seeds.\nAsk about reserves.' };
  assert.deepEqual(dirtyFields(mergeDrafts(kept, afterStage, afterNote, ['note']), afterNote), []);
  assert.equal(draftsFrom({ cheque_min_cents: null }).lo, '', 'a blank cheque stays blank');
});

test('Combine both keeps the saved text and adds only the lines it lacks; Accept waits on an unsaved note', () => {
  assert.equal(combineNotes('Led two seeds.\nIntro on 24 Nov.', 'Led two seeds.\nAsk about reserves.'),
    'Led two seeds.\nIntro on 24 Nov.\nAsk about reserves.');
  assert.equal(combineNotes('', 'Mine.'), 'Mine.');
  assert.equal(combineNotes('Same.', 'Same.'), 'Same.');
  assert.match(acceptWaitReason(true), /^Save your note first\./);
  assert.equal(acceptWaitReason(false), null);
});

// ── The identity block and the public record ────────────────────────────────

test('a linked entry opens its catalogue vehicle by id; a legacy entry offers the chooser and links nothing by name', () => {
  const linked = html(h(IdentityBand, { fund: { uid: 'f_7Q2K', identity: 'linked', catalogue_uid: 'atlas-a-i' }, onChoose() {} }));
  assert.match(linked, /href="\/research\/funds\/catalog\/atlas-a-i"[^>]*>Open catalogue vehicle →</);
  assert.doesNotMatch(linked, /Choose the record/);
  const legacy = html(h(IdentityBand, { fund: { uid: 'f_9M4T', identity: 'legacy', catalogue_uid: null }, onChoose() {} }));
  assert.match(legacy, /<button[^>]*>Choose the record…<\/button>/);
  assert.doesNotMatch(legacy, /\/research\/funds\/catalog\//);
  const own = html(h(IdentityBand, { fund: { uid: 'f_K8P5', identity: 'own' }, onChoose() {} }));
  assert.match(own, />Link to a catalogue vehicle…</);
});

test('the public record is read-only and states Unavailable or withdrawn instead of showing facts', () => {
  const ok = html(h(PublicRecordCard, { record: { state: 'ok', record: { uid: 'dawncapital', name: 'Dawn Capital', hq: 'UK', source: { name: 'EuroTech VC Funds', url: 'https://list.example' } } } }));
  assert.match(ok, /data-state="ok"/);
  assert.match(ok, /dawncapital/);
  assert.match(ok, /You cannot edit these facts\./);
  assert.doesNotMatch(ok, /<input|<textarea/, 'a public fact is editable');
  const down = html(h(PublicRecordCard, { record: { state: 'unavailable', reason: 'The catalogue could not be read.' } }));
  assert.match(down, /Unavailable\./);
  assert.match(down, /stay editable/);
  const gone = html(h(PublicRecordCard, { record: { state: 'withdrawn', status: 410, reason: 'Its facts are no longer shown.' } }));
  assert.match(gone, /The public record was withdrawn\./);
  assert.doesNotMatch(gone, /<dl/);
  const none = html(h(PublicRecordCard, { record: { state: 'not_linked', reason: 'Nothing is borrowed from a similar name.' } }));
  assert.match(none, /Nothing is borrowed from a similar name\./);
});

// ── The dossier, mounted ────────────────────────────────────────────────────

const ROW = (extra = {}) => ({
  uid: 'f_7Q2K', name: 'Sample Fund', identity: 'linked', catalogue_uid: 'atlas-a-i', stage_fit: null, path: null,
  status: 'researching', note: 'Led two seeds.', thesis: 'Physical work.', pass_reason: null, source_url: null,
  cheque_min_cents: null, cheque_max_cents: null, intended_allocation_cents: null, updated_at: '2026-11-18T10:00:00.000Z',
  overlap_note: 'No raise target on the active company, so there is no ask to compare.',
  public_record: { state: 'ok', record: { uid: 'atlas-a-i', name: 'Sample Vehicle' } }, ...extra,
});

async function mountDossier({ update, draft = null } = {}) {
  const real = { ...api.research };
  const writes = [];
  let stored = ROW();
  api.research.fundGet = async () => ({ ...stored });
  api.research.fundUpdate = async (uid, body) => {
    writes.push(body);
    if (update) return update(body, (next) => { stored = next; });
    const { expected_updated_at: _, ...rest } = body;
    stored = { ...stored, ...rest, updated_at: `2026-11-18T10:0${writes.length}:00.000Z` };
    return stored;
  };
  api.research.zoneDrafts = async () => ({ items: draft ? [draft] : [] });
  api.research.fundReports = async () => ({ items: [] });
  const oldMedia = globalThis.matchMedia;
  globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  const ui = await mountContracts(h(Routes, null, h(Route, { path: '/research/funds/:uid', element: h(FundDossier) })), '/research/funds/f_7Q2K', { id: 1, role: 'founder' });
  for (let i = 0; i < 4; i += 1) await ui.flush();
  const note = () => byTid(ui, 'fund-dossier-note');
  const select = (label) => ui.nodes().find((n) => n.tagName === 'SELECT' && ui.props(n)?.['aria-label'] === label);
  return {
    ui, writes, note, select,
    type: async (value) => { await act(async () => { ui.props(note()).onChange({ target: { value } }); }); },
    close: async () => { await ui.unmount(); Object.assign(api.research, real); globalThis.matchMedia = oldMedia; },
  };
}

test('changing the stage sends only stage_fit with the stamp it read, and the typed note stays unsaved', async () => {
  const m = await mountDossier();
  try {
    await m.type('Led two seeds.\nAsk about reserves.');
    assert.match(textOf(m.ui.nodes()[0]), /Unsaved changes/);
    await act(async () => { m.ui.props(m.select('Stage fit for Sample Fund')).onChange({ target: { value: 'right' } }); });
    for (let i = 0; i < 4; i += 1) await m.ui.flush();
    assert.deepEqual(m.writes[0], { stage_fit: 'right', expected_updated_at: '2026-11-18T10:00:00.000Z' });
    assert.equal(m.ui.props(m.note()).value, 'Led two seeds.\nAsk about reserves.', 'the stage save discarded the note');
    assert.match(textOf(byTid(m.ui, 'fund-dossier-announce')), /^Stage fit saved\./);
    await m.ui.click('Save note');
    for (let i = 0; i < 4; i += 1) await m.ui.flush();
    assert.deepEqual(m.writes[1], { note: 'Led two seeds.\nAsk about reserves.', expected_updated_at: '2026-11-18T10:01:00.000Z' },
      'the note save names the stamp the stage save left');
    assert.match(textOf(byTid(m.ui, 'fund-dossier-save-line')), /All changes saved/);
  } finally { await m.close(); }
});

test('a note changed elsewhere opens the conflict Sheet with both versions; keeping the saved one discards mine', async () => {
  const saved = ROW({ note: 'Led two seeds.\nIntro on 24 Nov.', updated_at: '2026-11-18T10:05:00.000Z' });
  const m = await mountDossier({
    update: async () => { throw Object.assign(new Error('This fund changed since you opened it.'), { status: 409, code: 'fund_changed', data: { item: saved } }); },
  });
  try {
    await m.type('Led two seeds.\nAsk about reserves.');
    await m.ui.click('Save note');
    for (let i = 0; i < 4; i += 1) await m.ui.flush();
    const sheet = byTid(m.ui, 'fund-dossier-conflict');
    assert.ok(sheet, 'no conflict Sheet');
    assert.match(textOf(byTid(m.ui, 'fund-conflict-saved')), /Intro on 24 Nov\./);
    assert.match(textOf(byTid(m.ui, 'fund-conflict-mine')), /Ask about reserves\./);
    assert.equal(m.ui.props(m.note()).value, 'Led two seeds.\nAsk about reserves.', 'nothing is overwritten before a choice');
    await m.ui.click('Keep the saved version');
    for (let i = 0; i < 2; i += 1) await m.ui.flush();
    assert.equal(byTid(m.ui, 'fund-dossier-conflict'), null);
    assert.equal(m.ui.props(m.note()).value, 'Led two seeds.\nIntro on 24 Nov.');
  } finally { await m.close(); }
});

test('a failed save keeps the draft and says so', async () => {
  const m = await mountDossier({ update: async () => { throw Object.assign(new Error('Server error.'), { status: 500 }); } });
  try {
    await m.type('Unsaved words.');
    await m.ui.click('Save note');
    for (let i = 0; i < 4; i += 1) await m.ui.flush();
    assert.equal(m.ui.props(m.note()).value, 'Unsaved words.');
    assert.match(m.ui.text(), /Note did not save\. Your text is still here\. Nothing was lost\./);
    assert.match(m.ui.text(), /Save failed · draft kept/);
  } finally { await m.close(); }
});

test('Write into the note waits while the note has unsaved text, with the reason', async () => {
  const draft = { uid: 'd1', body: 'A brief.', accepted: false, cost_usd: 0 };
  const m = await mountDossier({ draft });
  try {
    const accept = () => m.ui.nodes().find((n) => n.tagName === 'BUTTON' && textOf(n).trim() === 'Write into the note');
    assert.ok(accept(), 'the draft is drawn');
    assert.equal(m.ui.props(accept()).disabled, false);
    await m.type('Typed but not saved.');
    assert.equal(m.ui.props(accept()).disabled, true, 'Accept would append after a note with unsaved text');
    assert.match(textOf(byTid(m.ui, 'zone-draft-accept-blocked')), /^Save your note first\./);
  } finally { await m.close(); }
});

// ── My funds, source ────────────────────────────────────────────────────────

test('My funds reads a page from the Worker by keys the Directory does not own, and maps by catalogue uid', () => {
  const zone = read('frontend/src/pages/research/FundsZone.jsx');
  assert.match(zone, /const search = params\.get\('mq'\) \|\| '';/);
  assert.match(zone, /params\.get\('mpage'\)/);
  assert.match(zone, /researchMyFundsApi\.list\(\{/);
  assert.doesNotMatch(zone, /api\.research\.funds\(\)/, 'the newest-500 read is back');
  assert.match(zone, /data-testid="my-funds-count-scope"/);
  const profile = read('frontend/src/pages/research/FundCatalogProfile.jsx');
  assert.match(profile, /researchMyFundsApi\.list\(\{ catalogue_uid: uid, limit: 1 \}\)/);
  assert.doesNotMatch(profile, /normalize\(x\.name\)/, 'the catalog page matches your entry by name again');
});
