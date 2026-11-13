/**
 * #5314 part 3 (D4822) — every Delivery edit states the version it was read
 * at, and a refused one draws the conflict state: Reload, or Keep my edits.
 *
 * The Worker side is `cloudflare-worker/test/delivery_write_conflicts_5314.test.ts`.
 * Here: the note a refusal becomes, the two actions it offers, the revision
 * each write sends, and a scan that fails if a Delivery write stops sending one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { DeliveryNote } from '../src/pages/partner/delivery/deliveryEdits.jsx';
import {
  stated, isDeliveryConflict, currentVersionOf, failureNote, CONFLICT_TEXT,
} from '../src/pages/partner/delivery/useZoneMutations.js';
import { codeOnly } from './_codeOnly.mjs';

const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const read = (rel) => codeOnly(readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8'));
const conflict = (now) => Object.assign(new Error('That deliverable changed while you were editing it.'), {
  status: 409, code: 'delivery_changed', data: { code: 'delivery_changed', revision: now, current_version: now },
});

test('a write states the revision it read; Keep my edits states the one there now', () => {
  assert.equal(stated(undefined, 4), 4, 'a first attempt sends the revision the row was read at');
  assert.equal(stated(7, 4), 7, 'a retry sends the version the refusal named');
  assert.equal(stated(undefined, null), null, 'a read that found no record says so: null');
  assert.equal(stated(undefined, undefined), undefined, 'a read that failed states nothing');
  assert.equal(stated(null, 4), null, 'a record deleted since is retried as "none"');
});

test('only a 409 delivery_changed is a conflict, and it carries the version now', () => {
  assert.equal(isDeliveryConflict(conflict(3)), true);
  assert.equal(currentVersionOf(conflict(3)), 3);
  assert.equal(isDeliveryConflict({ status: 409, code: 'report_sent' }), false, 'a sent report is not a version conflict');
  assert.equal(isDeliveryConflict({ status: 400, code: 'delivery_changed' }), false);
  assert.equal(currentVersionOf({ status: 409, code: 'delivery_changed', data: {} }), null, 'gone reads null, never 0');
});

test('a conflict becomes a note with Reload and Keep my edits; anything else stays a plain refusal', () => {
  let reloaded = 0;
  const retried = [];
  const note = failureNote(conflict(5), {
    scope: 'dl:9', fallback: 'That did not save.',
    reload: () => { reloaded += 1; }, retry: (now) => retried.push(now),
  });
  assert.equal(note.ok, false);
  assert.equal(note.scope, 'dl:9');
  assert.equal(note.text, CONFLICT_TEXT);
  assert.match(note.text, /nothing was saved/, 'the note says the write changed nothing');
  note.conflict.keep();
  assert.deepEqual(retried, [5], 'Keep my edits resends at the version that is there now');
  note.conflict.reload();
  assert.equal(reloaded, 1);

  const plain = failureNote(Object.assign(new Error('A deliverable needs a title'), { status: 400 }), {
    scope: 'dl:9', fallback: 'That did not save.', reload: () => {}, retry: () => {},
  });
  assert.deepEqual(plain, { ok: false, scope: 'dl:9', text: 'A deliverable needs a title' });
  assert.equal(failureNote(null, { scope: 's', fallback: 'That did not save.' }).text, 'That did not save.');
});

test('the conflict state draws both actions; a save or a plain refusal draws neither', () => {
  const note = failureNote(conflict(2), { scope: 'x', fallback: '', reload: () => {}, retry: () => {} });
  const markup = html(h(DeliveryNote, { note }));
  assert.match(markup, /role="alert"[^>]*>Someone changed this after you opened it/);
  assert.match(markup, /data-testid="delivery-conflict"/);
  assert.match(markup, />Reload</);
  assert.match(markup, />Keep my edits</);
  for (const other of [{ ok: true, text: 'Saved.' }, { ok: false, text: 'A deliverable needs a title' }, null]) {
    const m = html(h(DeliveryNote, { note: other }));
    assert.doesNotMatch(m, /delivery-conflict|Keep my edits/);
  }
});

test('every Delivery delete, revoke and send carries the revision to the Worker', () => {
  const api = read('lib/api.js');
  for (const name of ['deletePartnerMilestone', 'deletePartnerBlocker', 'deletePartnerDeliverable', 'deletePartnerHours', 'deletePartnerStatusReport']) {
    const at = api.indexOf(`${name}: (`);
    assert.ok(at > 0, `${name} is gone`);
    const body = api.slice(at, api.indexOf('\n  ', api.indexOf('request(', at) + 1) + 200);
    assert.match(body, /, revision\) =>/, `${name} no longer takes the revision`);
    assert.match(body, /deliveryRevisionQuery\(revision\)/, `${name} no longer sends it`);
  }
  for (const name of ['revokePartnerSeat', 'sendPartnerStatusReport']) {
    const at = api.indexOf(`${name}: (`);
    assert.match(api.slice(at, at + 260), /expected_revision: revision \?\? null/, `${name} no longer sends the revision`);
  }
  assert.match(api, /`\?expected_revision=\$\{revision === null \? 'none' : encodeURIComponent\(String\(revision\)\)\}`/);
});

// Every edit the Delivery page makes. A create is not here: it has no version.
const WRITES = [
  'updatePartnerMilestone', 'deletePartnerMilestone', 'updatePartnerBlocker', 'deletePartnerBlocker',
  'updatePartnerDeliverable', 'deletePartnerDeliverable', 'savePartnerEngagementHealth',
  'setPartnerCapacityCap', 'setPartnerInternalHours', 'savePartnerHours', 'deletePartnerHours',
  'updatePartnerSeat', 'revokePartnerSeat', 'savePartnerStatusReport', 'sendPartnerStatusReport',
  'deletePartnerStatusReport',
];
const ZONES = ['HealthZone', 'DeliverablesZone', 'CapacityZone', 'StatusReportsZone'];

test('no Delivery zone makes an edit without stating the revision it read', () => {
  const seen = new Set();
  for (const zone of ZONES) {
    const src = read(`pages/partner/delivery/${zone}.jsx`);
    for (const name of WRITES) {
      let at = src.indexOf(`api.${name}(`);
      while (at >= 0) {
        seen.add(name);
        // The call's own arguments: from its `(` to the matching `)`.
        const open = at + `api.${name}`.length;
        let depth = 0;
        let end = open;
        for (; end < src.length; end += 1) {
          if (src[end] === '(') depth += 1;
          else if (src[end] === ')') { depth -= 1; if (depth === 0) break; }
        }
        assert.match(src.slice(open, end), /stated\(rev, /,
          `${zone}: api.${name}(…) does not state the revision it read`);
        // The function handed to the zone's runner takes the retry's version.
        const before = src.slice(Math.max(0, at - 30), at);
        assert.match(before, /\(rev\) => \s*$|\(rev\) => \{?\s*$|await\s*$/, `${zone}: api.${name} is not called from a (rev) => write`);
        at = src.indexOf(`api.${name}(`, at + 1);
      }
    }
  }
  assert.deepEqual([...seen].sort(), [...WRITES].sort(), 'a Delivery write is no longer made from these zones; update WRITES');
});

test('each zone turns a refusal into the conflict state and shows it where the write was', () => {
  for (const zone of ZONES) {
    const src = read(`pages/partner/delivery/${zone}.jsx`);
    assert.match(src, /failureNote\(/, `${zone} no longer draws the conflict state`);
    assert.match(src, /<DeliveryNote /, `${zone} no longer shows the conflict's actions`);
  }
  const reports = read('pages/partner/delivery/StatusReportsZone.jsx');
  assert.match(reports, /setDraft\(\(dr\) => \(\{ \.\.\.dr, existing: saved \}\)\)/,
    'a saved draft no longer adopts its new revision, so the next save conflicts with itself');
});
