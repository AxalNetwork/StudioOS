/**
 * D980 (#2766) — the Deck roster at /admin/advisors-partners/deck: AP7's list,
 * reorder and slide preview, AP8's one-save card dialog, AP9a/b's
 * confirmations. It replaces D975's tests of the console it redraws; their
 * cases (Advisor by default, a legacy mentor as an Advisor, Archive asked in
 * the page, one submission, a failed write kept in its dialog, a failed list
 * that is never empty) are carried here.
 *
 * Two layers: the pure model (`advisors/deckRosterModel.js`), with its reach
 * rule held to the Worker's own (`services/decks/deckRoster.ts`); and the
 * roster mounted on a stubbed `fetch`, its controls driven through their React
 * props.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/admin_deck_roster_d980.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import AdminNetworkProfiles from '../src/pages/admin/AdminNetworkProfiles.jsx';
import { mountContracts } from './_contracts_dom.mjs';
import { deckRosterReach } from '../../cloudflare-worker/src/services/decks/deckRoster.ts';
import {
  KINDS, cardErrors, cardOf, cardPayload, confirmCopy, dropRow, filterRows, kindLabel, memberOptions, moveLine, moveRow,
  photoError, previewOf, reachOf, refusalOf, slideRole, splitRoster, tilesOf,
} from '../src/pages/admin/advisors/deckRosterModel.js';

// ---------------------------------------------------------------- fixtures

const person = (id, name, extra = {}) => ({
  id, name, kind: 'advisor', role: `Role ${id}`, company: `Company ${id}`, skills: ['Product'], display_order: id,
  is_active: true, state: 'shown', photo_url: `/api/admin/network-profiles/${id}/photo`, linked_user: null, ...extra,
});
const ROSTER = () => [
  person(1, 'Ada Placeholder', { kind: 'mentor', linked_user: { id: 41, name: 'Ada Placeholder' } }),
  person(2, 'Rhea Dummy', { kind: 'partner' }),
  person(3, 'Bea Mock', { photo_url: null }),
  person(4, 'Lio Testwell', { kind: 'partner' }),
  person(5, 'Cy Sample', { kind: 'investor', role: null }),
  person(6, 'Dee Example'),
  person(7, 'Noor Specimen', { kind: 'investor' }),
  person(8, 'Eli Fixture', { kind: 'partner' }),
  person(9, 'Ola Sample'),
  person(10, 'Pat Hidden', { is_active: false, state: 'hidden', display_order: 3 }),
  person(11, 'Kit Hidden', { is_active: false, state: 'hidden', display_order: 1 }),
];
const ARCHIVED = [person(12, 'Arch Ived', { is_active: false, state: 'archived', archived_at: '2026-10-20 10:00:00' })];
const COUNTS = { shown: 9, hidden: 2, archived: 1 };
const ok = (data) => ({ status: 'ready', data });

// ---------------------------------------------------------------- the model

test('the reach rule is the Worker’s: six on the slide, names up to eight, the rest counted', () => {
  for (const names of [
    ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'],
    ['a', '', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'],
    ['', '', '', '', '', '', 'g', 'h', 'i'],
    ['a', 'b'],
    [],
  ]) {
    const label = { profile: 'on_slide', named: 'name_only', counted: 'counted' };
    assert.deepEqual(reachOf(names), deckRosterReach(names).map((r) => label[r]), names.join(','));
  }
  assert.deepEqual(reachOf(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']).slice(5), ['on_slide', 'name_only', 'name_only', 'counted']);
});

test('the roster splits into shown in the deck’s order and hidden; a move re-works reach and says where it went', () => {
  const { shown, hidden } = splitRoster(ROSTER());
  assert.deepEqual(shown.map((p) => p.id), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(hidden.map((p) => p.id), [11, 10], 'hidden in their own order');
  assert.deepEqual(shown.map((p) => p.deck_reach), ['on_slide', 'on_slide', 'on_slide', 'on_slide', 'on_slide', 'on_slide', 'name_only', 'name_only', 'counted']);
  const down = moveRow(shown, 6, 1);
  assert.deepEqual(down.map((p) => p.id), [1, 2, 3, 4, 5, 7, 6, 8, 9]);
  assert.equal(down.find((p) => p.id === 7).deck_reach, 'on_slide');
  assert.equal(down.find((p) => p.id === 6).deck_reach, 'name_only');
  assert.equal(moveLine(down.find((p) => p.id === 6), 9), 'Dee Example moved to position 7 of 9. Name only.');
  assert.equal(moveRow(shown, 1, -1), null, 'the first cannot go up');
  assert.equal(moveRow(shown, 9, 1), null, 'the last cannot go down');
  assert.deepEqual(dropRow(shown, 9, 1).map((p) => p.id), [9, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(dropRow(shown, 3, 3), null);
  const legacy = splitRoster([{ id: 1, name: 'A', is_active: 1 }, { id: 2, name: 'B', is_active: 0 }]);
  assert.deepEqual([legacy.shown.length, legacy.hidden.length], [1, 1], 'rows without a state read by is_active');
});

test('search and the Kind filter; the tiles, never a zero for a failed read; the slide preview', () => {
  const { shown } = splitRoster(ROSTER());
  assert.deepEqual(filterRows(shown, { q: 'company 4' }).map((p) => p.id), [4]);
  assert.deepEqual(filterRows(shown, { kind: 'advisor' }).map((p) => p.id), [1, 3, 6, 9], 'a mentor is an Advisor');
  assert.deepEqual(tilesOf(ok({ counts: COUNTS }), shown).map((t) => [t.key, t.text]), [['shown', '9'], ['on_slide', '6'], ['hidden', '2'], ['archived', '1']]);
  assert.deepEqual(tilesOf({ status: 'error' }, []).map((t) => t.text), ['Unreadable', 'Unreadable', 'Unreadable', 'Unreadable']);
  assert.deepEqual(tilesOf({ status: 'loading' }, []).map((t) => t.kind), ['loading', 'loading', 'loading', 'loading']);
  const v = previewOf(shown);
  assert.deepEqual(v.drawn.map((d) => d.id), [1, 2, 3, 4, 5, 6]);
  assert.equal(v.drawn[4].role, 'Advisor', 'no role reads as the slide does');
  assert.equal(v.line, '+ 3 more counted · 9 in the network total');
  assert.match(v.alt, /6 people drawn.*3 more counted/);
  assert.equal(previewOf([]).line, 'No one is shown, so the slide draws no advisor block.');
  assert.equal(slideRole('—'), 'Advisor');
});

test('the card: kinds, inline errors, the photo check, the payload with its member link, and the confirmations', () => {
  assert.deepEqual(KINDS.map((k) => k.key), ['advisor', 'partner', 'investor']);
  assert.equal(kindLabel('mentor'), 'Advisor');
  assert.equal(cardOf(null).kind, 'advisor');
  assert.equal(cardOf({ id: 1, kind: 'mentor', state: 'hidden' }).kind, 'advisor');
  assert.equal(cardOf({ id: 1, kind: 'mentor', state: 'hidden' }).is_active, false);
  assert.deepEqual(cardErrors({ name: ' ' }), { name: 'A name is required.' });
  assert.deepEqual(cardErrors({ name: 'A', linkedin_url: 'linkedin.com/in/ola' }), { linkedin_url: 'Use a full LinkedIn address, starting https://' });
  assert.deepEqual(cardErrors({ name: 'A', linkedin_url: 'https://linkedin.com/in/ola', bio: 'x'.repeat(2000) }), {});
  assert.ok(cardErrors({ name: 'A', bio: 'x'.repeat(2001) }).bio);
  assert.equal(photoError({ type: 'image/gif', size: 10 }), 'Use a JPG, PNG or WebP photo.');
  assert.equal(photoError({ type: 'image/png', size: 2 * 1024 * 1024 + 1 }), 'The photo is over 2 MB.');
  assert.equal(photoError({ type: 'image/webp', size: 2 * 1024 * 1024 }), null);
  assert.deepEqual(cardPayload({ ...cardOf(null), name: ' Ola ', linkedin_url: ' https://x.example/in/ola ', linked_user: { id: 7, name: 'Ola' } }), {
    name: 'Ola', kind: 'advisor', role: null, company: null, bio: null, linkedin_url: 'https://x.example/in/ola', skills: [], is_active: true, linked_user_id: 7,
  });
  assert.equal(cardPayload({ ...cardOf(null), name: 'A', linked_user: null }).linked_user_id, null, 'removing the link sends null');
  assert.equal('linked_user_id' in cardPayload({ name: 'A', kind: 'partner' }), false, 'a caller without the field leaves the link alone');
  assert.deepEqual(memberOptions([{ id: 3, name: 'On', role: 'operating_partner', is_active: 1 }, { id: 4, name: 'Off', is_active: 0 }]), [{ id: 3, name: 'On', role: 'operating partner', taken: false }]);
  assert.equal(confirmCopy('hide', { name: 'Ada' }).title, 'Hide Ada from the Demo Day deck?');
  assert.match(confirmCopy('archive', { name: 'Noor' }).body, /leave this list and the deck.*restore them from Archived/);
  assert.match(confirmCopy('restore', { name: 'Noor' }).body, /come back under Hidden, not on the deck/);
  assert.equal(refusalOf({ code: 'invalid_linked_user' }), 'That account cannot be linked: only an active member account can.');
});

// ---------------------------------------------------------------- the roster, mounted

const text = (n) => (n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '');

/** A stubbed Worker. `fail` names what answers 503: `list`, `archived`, `reorder`, `archive`, `photo`, `users`. */
async function roster({ rows = ROSTER(), archived = ARCHIVED, fail = [], counts = COUNTS, hold = {} } = {}) {
  const previous = globalThis.fetch;
  const previousReader = globalThis.FileReader;
  globalThis.FileReader = class { readAsDataURL(f) { this.result = `data:${f.type};base64,AAAA`; this.onload(); } };
  const calls = [];
  const down = (k) => fail.includes(k);
  const json = (body, status = 200) => Response.json(body, { status });
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url), 'http://x');
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path: u.pathname, search: u.search, method, body });
    const p = u.pathname;
    if (p === '/api/admin/users') return down('users') ? json({ detail: 'down' }, 503) : json([{ id: 41, name: 'Ada Placeholder', role: 'advisor', is_active: 1 }, { id: 52, name: 'Ola Member', role: 'partner', is_active: 1 }, { id: 53, name: 'Gone Member', role: 'partner', is_active: 0 }]);
    if (p === '/api/admin/network-profiles' && method === 'GET') {
      if (u.searchParams.get('state') === 'archived') return down('archived') ? json({ detail: 'archived down' }, 503) : json({ profiles: archived, counts });
      return down('list') ? json({ detail: 'read unavailable' }, 503) : json({ profiles: rows, counts, truncated: false });
    }
    if (p === '/api/admin/network-profiles' && method === 'POST') return hold.create ? hold.create() : json({ id: 99 }, 201);
    if (p === '/api/admin/network-profiles/reorder') return down('reorder') ? json({ detail: 'order refused' }, 503) : json({ ok: true });
    if (/\/archive$/.test(p)) { if (hold.archive) return hold.archive(); return down('archive') ? json({ detail: 'write refused' }, 503) : json({ ok: true }); }
    if (/\/restore$/.test(p)) return json({ ok: true });
    if (/\/photo$/.test(p)) return down('photo') ? json({ detail: 'too large' }, 503) : json({ ok: true });
    if (method === 'PUT') return json({ ok: true });
    return json({});
  };
  const m = await mountContracts(React.createElement(AdminNetworkProfiles, { embedded: true }), '/admin/advisors-partners/deck');
  for (let i = 0; i < 4; i += 1) await m.flush();
  const by = (id) => m.nodes().find((n) => m.props(n)?.['data-testid'] === id);
  const settle = async () => { for (let i = 0; i < 4; i += 1) await m.flush(); };
  return {
    ...m, calls, by, settle,
    of: (id) => { const n = by(id); assert.ok(n, `no ${id}`); return text(n); },
    has: (id) => Boolean(by(id)),
    async fire(id, name, arg) { const n = by(id); assert.ok(n, `no ${id}`); await act(async () => { await m.props(n)[name](arg); }); await settle(); },
    async press(id) { const n = by(id); assert.ok(n, `no ${id}`); assert.ok(!m.props(n).disabled, `${id} is disabled`); await act(async () => { await m.props(n).onClick({ stopPropagation() {} }); }); await settle(); },
    async menu(id, item) { await this.press(`deck-more-${id}`); await this.press(`deck-more-${id}-${item}`); },
    order: () => m.nodes().filter((n) => n.tagName === 'LI' && /^deck-row-\d+$/.test(m.props(n)?.['data-testid'] || '') && m.props(n).tabIndex === 0).map((n) => Number(m.props(n)['data-testid'].slice(9))),
    writes: (method) => calls.filter((c) => c.method === method),
    async done() { await m.unmount(); globalThis.fetch = previous; globalThis.FileReader = previousReader; },
  };
}

test('AP7: the tiles, the shown people in order with reach and the linked chip, the line after six, the preview', async () => {
  const m = await roster();
  try {
    assert.deepEqual(['shown', 'on_slide', 'hidden', 'archived'].map((k) => m.of(`deck-tile-${k}`).match(/\d+/)?.[0]), ['9', '6', '2', '1']);
    assert.deepEqual(m.order(), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.match(m.of('deck-reach-6'), /On the slide/);
    assert.match(m.of('deck-reach-7'), /Name only/);
    assert.match(m.of('deck-reach-9'), /Counted only/);
    assert.match(m.of('deck-linked-1'), /Linked to Ada Placeholder’s account/);
    assert.match(m.of('deck-linked-2'), /Not linked/);
    assert.match(m.of('deck-row-1'), /Advisor/, 'a legacy mentor reads as an Advisor');
    assert.doesNotMatch(m.of('network-roster'), /[Mm]entor/);
    assert.ok(m.has('deck-divider'));
    const items = m.nodes().filter((n) => n.tagName === 'LI').map((n) => m.props(n)?.['data-testid']);
    assert.equal(items.indexOf('deck-divider'), items.indexOf('deck-row-6') + 1, 'the line falls after the sixth');
    assert.deepEqual(m.nodes().filter((n) => /^deck-preview-\d+$/.test(m.props(n)?.['data-testid'] || '')).map((n) => Number(m.props(n)['data-testid'].slice(13))), [1, 2, 3, 4, 5, 6]);
    assert.equal(m.of('deck-preview-line'), '+ 3 more counted · 9 in the network total');
    assert.equal(m.props(m.by('deck-photo-2')).src, '/api/admin/network-profiles/2/photo', 'the admin photo read');
    assert.equal(m.by('deck-photo-3').tagName, 'SPAN', 'no photo draws initials');
    assert.equal(m.of('deck-photo-3'), 'BM');
    assert.ok(!m.has('deck-hidden'), 'Hidden starts collapsed');
    assert.ok(!m.calls.some((c) => c.search.includes('state=archived')), 'Archived is read when it is opened');
  } finally { await m.done(); }
});

test('AP7: Up, Down and Alt+Arrow move a row, save the order, announce it and redraw reach and the preview', async () => {
  const m = await roster();
  try {
    assert.equal(m.props(m.by('deck-up-1')).disabled, true);
    assert.equal(m.props(m.by('deck-down-9')).disabled, true);
    await m.press('deck-down-6');
    assert.deepEqual(m.order(), [1, 2, 3, 4, 5, 7, 6, 8, 9]);
    assert.deepEqual(m.writes('POST').filter((c) => c.path.endsWith('/reorder')).map((c) => c.body.order), [[1, 2, 3, 4, 5, 7, 6, 8, 9]]);
    assert.equal(m.of('deck-announce'), 'Dee Example moved to position 7 of 9. Name only.');
    assert.match(m.of('deck-reach-7'), /On the slide/);
    assert.ok(m.has('deck-preview-7') && !m.has('deck-preview-6'), 'the preview follows the order');
    const row = m.by('deck-row-9');
    await act(async () => { m.props(row).onKeyDown({ altKey: false, key: 'ArrowUp', preventDefault() {} }); });
    assert.equal(m.writes('POST').filter((c) => c.path.endsWith('/reorder')).length, 1, 'an arrow without Alt does nothing');
    let prevented = false;
    await act(async () => { m.props(m.by('deck-row-9')).onKeyDown({ altKey: true, key: 'ArrowUp', preventDefault() { prevented = true; } }); });
    await m.settle();
    assert.equal(prevented, true);
    assert.deepEqual(m.order(), [1, 2, 3, 4, 5, 7, 6, 9, 8]);
    assert.equal(m.of('deck-announce'), 'Ola Sample moved to position 8 of 9. Name only.');
  } finally { await m.done(); }
});

test('AP7: a failed reorder goes back to the saved order and says so; a filter stops reordering', async () => {
  const m = await roster({ fail: ['reorder'] });
  try {
    await m.press('deck-up-2');
    assert.deepEqual(m.order(), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.match(m.of('deck-reorder-error'), /could not be saved: order refused\. The list shows the saved order/);
    await m.fire('deck-search', 'onChange', { target: { value: 'company 4' } });
    assert.deepEqual(m.order(), [4]);
    assert.equal(m.props(m.by('deck-up-4')).disabled, true, 'no reorder while filtered');
    assert.match(m.of('deck-filtering'), /Clear the search/);
    await m.fire('deck-search', 'onChange', { target: { value: 'zz' } });
    assert.match(m.of('deck-no-match'), /No one matches ‘zz’/);
    await m.fire('deck-kind', 'onChange', { target: { value: 'partner' } });
    await m.fire('deck-search', 'onChange', { target: { value: '' } });
    assert.deepEqual(m.order(), [2, 4, 8]);
  } finally { await m.done(); }
});

test('AP9a: Hide is asked in the page; Cancel writes nothing; Hide writes is_active false and reloads', async () => {
  const m = await roster();
  try {
    await m.menu(1, 'hide');
    assert.ok(m.has('deck-hide-dialog'));
    assert.match(m.of('deck-hide-dialog'), /Hide Ada Placeholder from the Demo Day deck\?.*The next deck built leaves them out\. Their card stays here under Hidden\./s);
    await m.click('Cancel');
    assert.ok(!m.has('deck-hide-dialog'));
    assert.equal(m.writes('PUT').length, 0);
    const reads = m.calls.filter((c) => c.method === 'GET').length;
    await m.menu(1, 'hide');
    await m.press('deck-hide-confirm');
    assert.deepEqual(m.writes('PUT').map((c) => [c.path, c.body]), [['/api/admin/network-profiles/1', { is_active: false }]]);
    assert.ok(!m.has('deck-hide-dialog'));
    assert.ok(m.calls.filter((c) => c.method === 'GET').length > reads, 'the list is read again');
  } finally { await m.done(); }
});

test('Hidden opens to its rows, which can be shown; Archived is read on opening, and restored as hidden', async () => {
  const m = await roster();
  try {
    await m.press('deck-hidden-toggle');
    assert.match(m.of('deck-hidden'), /Kit Hidden.*Pat Hidden/s);
    assert.ok(!m.has('deck-up-10'), 'a hidden row does not move');
    await m.menu(10, 'show');
    assert.match(m.of('deck-show-dialog'), /Show Pat Hidden on the Demo Day deck\?/);
    await m.press('deck-show-confirm');
    assert.deepEqual(m.writes('PUT').map((c) => c.body), [{ is_active: true }]);
    await m.press('deck-archived-toggle');
    assert.ok(m.calls.some((c) => c.search === '?state=archived&limit=500'));
    assert.match(m.of('deck-archived'), /Arch Ived/);
    assert.ok(!m.has('deck-edit-12'), 'an archived card is restored before it is edited');
    await m.menu(12, 'restore');
    assert.match(m.of('deck-restore-dialog'), /come back under Hidden, not on the deck/);
    await m.press('deck-restore-confirm');
    assert.ok(m.writes('POST').some((c) => c.path === '/api/admin/network-profiles/12/restore'));
  } finally { await m.done(); }
  const f = await roster({ fail: ['archived'] });
  try {
    await f.press('deck-archived-toggle');
    assert.match(f.of('deck-archived-unreadable'), /archived profiles could not be read just now: archived down/);
    assert.ok(f.has('deck-row-1'), 'the shown list stays');
  } finally { await f.done(); }
});

test('AP9b: Archive is asked, takes one submission, keeps a failed write in its dialog and retries', async () => {
  let finish;
  let tries = 0;
  const m = await roster({ hold: { archive: () => { tries += 1; return tries === 1 ? new Promise((r) => { finish = r; }) : Response.json({ ok: true }); } } });
  try {
    await m.menu(7, 'archive');
    assert.match(m.of('deck-archive-dialog'), /Archive Noor Specimen\?.*They leave this list and the deck\. The record and photo are kept, and you can restore them from Archived\./s);
    const confirm = m.by('deck-archive-confirm');
    let pending;
    await act(async () => { pending = m.props(confirm).onClick(); m.props(confirm).onClick(); });
    assert.equal(tries, 1, 'one submission');
    assert.equal(m.props(m.by('deck-archive-confirm')).disabled, true);
    await act(async () => { finish(Response.json({ detail: 'write refused' }, { status: 503 })); await pending; });
    await m.settle();
    assert.match(m.of('deck-archive-refusal'), /write refused.*Try again/);
    assert.ok(m.has('deck-archive-dialog'));
    await m.press('deck-archive-confirm');
    assert.equal(tries, 2);
    assert.ok(!m.has('deck-archive-dialog'));
    assert.deepEqual(m.calls.filter((c) => /archive$/.test(c.path)).map((c) => [c.method, c.path]), [['POST', '/api/admin/network-profiles/7/archive'], ['POST', '/api/admin/network-profiles/7/archive']]);
  } finally { await m.done(); }
});

test('AP8: a new card defaults to Advisor, shows its errors inline, and one Save creates it and uploads its photo', async () => {
  const m = await roster();
  try {
    await m.press('deck-add');
    assert.match(m.of('deck-card-dialog'), /Add a person to the deck roster/);
    assert.equal(m.props(m.by('deck-card-kind-advisor'))['aria-checked'], true);
    assert.ok(!m.nodes().some((n) => /^deck-card-kind-mentor$/.test(m.props(n)?.['data-testid'] || '')));
    await m.press('deck-card-save');
    assert.match(m.of('deck-card-dialog'), /A name is required\./);
    assert.equal(m.writes('POST').length, 0, 'nothing is written with an error');
    await m.fire('deck-card-name', 'onChange', { target: { value: 'Ola Sample' } });
    await m.fire('deck-card-linkedin', 'onChange', { target: { value: 'linkedin.com/in/ola' } });
    await m.press('deck-card-save');
    assert.equal(m.of('deck-card-linkedin-error'), 'Use a full LinkedIn address, starting https://');
    await m.fire('deck-card-linkedin', 'onChange', { target: { value: 'https://linkedin.com/in/ola' } });
    await m.fire('deck-card-bio', 'onChange', { target: { value: 'Twelve years.' } });
    assert.equal(m.of('deck-card-bio-count'), '13 / 2,000');
    await m.press('deck-card-kind-partner');
    await m.fire('deck-card-file', 'onChange', { target: { files: [{ name: 'big.png', type: 'image/png', size: 3 * 1024 * 1024 }] } });
    assert.match(m.of('deck-card-photo'), /The photo is over 2 MB\./);
    await m.fire('deck-card-file', 'onChange', { target: { files: [{ name: 'ola.png', type: 'image/png', size: 1000 }] } });
    assert.equal(m.props(m.by('deck-card-photo-preview')).src, 'data:image/png;base64,AAAA', 'the photo is previewed before it is saved');
    assert.match(m.of('deck-card-photo'), /ola\.png is uploaded when you save/);
    await m.press('deck-card-save');
    const writes = m.calls.filter((c) => c.method !== 'GET');
    assert.deepEqual(writes.map((c) => [c.method, c.path]), [['POST', '/api/admin/network-profiles'], ['POST', '/api/admin/network-profiles/99/photo']]);
    assert.deepEqual(writes[0].body, { name: 'Ola Sample', kind: 'partner', role: null, company: null, bio: 'Twelve years.', linkedin_url: 'https://linkedin.com/in/ola', skills: [], is_active: true, linked_user_id: null });
    assert.equal(writes[1].body.data_uri, 'data:image/png;base64,AAAA');
    assert.ok(!m.has('deck-card-dialog'));
  } finally { await m.done(); }
});

test('AP8: a photo that fails after the card saved keeps the dialog on the saved card, so a second Save updates it', async () => {
  const m = await roster({ fail: ['photo'] });
  try {
    await m.press('deck-add');
    await m.fire('deck-card-name', 'onChange', { target: { value: 'Ola Sample' } });
    await m.fire('deck-card-file', 'onChange', { target: { files: [{ name: 'ola.png', type: 'image/png', size: 1000 }] } });
    await m.press('deck-card-save');
    assert.match(m.of('deck-card-refusal'), /The card is saved, but the photo could not be uploaded: too large/);
    assert.match(m.of('deck-card-dialog'), /Edit deck card · Ola Sample/);
    await m.press('deck-card-save');
    assert.deepEqual(m.calls.filter((c) => c.method !== 'GET').map((c) => [c.method, c.path]), [
      ['POST', '/api/admin/network-profiles'], ['POST', '/api/admin/network-profiles/99/photo'], ['PUT', '/api/admin/network-profiles/99'],
    ], 'created once');
  } finally { await m.done(); }
});

test('AP8: editing links a member account by search, and removes a link; a legacy mentor saves as an Advisor', async () => {
  const m = await roster();
  try {
    await m.press('deck-edit-1');
    assert.match(m.of('deck-card-dialog'), /Edit deck card · Ada Placeholder.*Linked to Ada Placeholder’s account\./s);
    assert.equal(m.props(m.by('deck-card-kind-advisor'))['aria-checked'], true);
    assert.equal(m.props(m.by('deck-card-photo-preview')).src, '/api/admin/network-profiles/1/photo');
    await m.click('Remove the link');
    await m.press('deck-card-save');
    let put = m.writes('PUT').at(-1);
    assert.deepEqual([put.path, put.body.kind, put.body.linked_user_id], ['/api/admin/network-profiles/1', 'advisor', null]);
    await m.press('deck-edit-2');
    await m.fire('deck-card-member-search', 'onChange', { target: { value: 'o' } });
    assert.ok(!m.calls.some((c) => c.path === '/api/admin/users'), 'one character does not search');
    await m.fire('deck-card-member-search', 'onChange', { target: { value: 'ola' } });
    assert.ok(m.calls.some((c) => c.path === '/api/admin/users' && c.search === '?q=ola&limit=8'));
    assert.ok(m.has('deck-card-member-52'));
    assert.ok(!m.has('deck-card-member-53'), 'an inactive account is not offered');
    await m.press('deck-card-member-52');
    assert.match(m.of('deck-card-linked'), /Ola Member/);
    await m.press('deck-card-save');
    put = m.writes('PUT').at(-1);
    assert.deepEqual([put.path, put.body.linked_user_id, put.body.kind], ['/api/admin/network-profiles/2', 52, 'partner']);
  } finally { await m.done(); }
});

test('AP8: a Save in flight takes no second submission', async () => {
  let finish;
  const m = await roster({ hold: { create: () => new Promise((r) => { finish = r; }) } });
  try {
    await m.press('deck-add');
    await m.fire('deck-card-name', 'onChange', { target: { value: 'Ola Sample' } });
    const save = m.by('deck-card-save');
    let pending;
    await act(async () => { pending = m.props(save).onClick(); m.props(save).onClick(); });
    assert.equal(m.writes('POST').length, 1, 'one create');
    assert.equal(m.props(m.by('deck-card-save')).disabled, true);
    await act(async () => { finish(Response.json({ id: 99 }, { status: 201 })); await pending; });
    await m.settle();
    assert.equal(m.writes('POST').length, 1);
    assert.ok(!m.has('deck-card-dialog'));
  } finally { await m.done(); }
});

test('a failed list is Unreadable with Try again, never an empty roster or zero tiles; an empty roster says so', async () => {
  const m = await roster({ fail: ['list'] });
  try {
    assert.match(m.of('profiles-unreadable'), /could not be read just now: read unavailable\. That is not the same as none\./);
    assert.deepEqual(['shown', 'on_slide', 'hidden', 'archived'].map((k) => m.of(`deck-tile-${k}`)), ['ShownUnreadableEveryone shown counts in the network total.', 'On the slideUnreadableThe first 6 shown, with photo, name and role.', 'HiddenUnreadableKept here, left off the deck.', 'ArchivedUnreadableOut of this list and the deck; restorable.']);
    assert.ok(!m.has('deck-empty'));
    assert.ok(!m.has('deck-preview'), 'no preview is drawn from a failed read');
    const reads = m.calls.filter((c) => c.method === 'GET').length;
    await m.click('Try again');
    await m.settle();
    assert.equal(m.calls.filter((c) => c.method === 'GET').length, reads + 1);
  } finally { await m.done(); }
  const e = await roster({ rows: [], counts: { shown: 0, hidden: 0, archived: 0 } });
  try {
    assert.match(e.of('deck-empty'), /No one is on the deck roster\..*no advisor block/s);
    assert.equal(e.of('deck-preview-line'), 'No one is shown, so the slide draws no advisor block.');
  } finally { await e.done(); }
});
