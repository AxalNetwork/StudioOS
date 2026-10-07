/**
 * D637 (#1395) — the partner's delivery edits, rendered from the real
 * components: Clear and Delete are different actions on a blocker, a live
 * seat's scope is edited in place, and an hours entry deletes to "Not
 * recorded", never to 0.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import {
  BlockerRow, blockerDeleteQuestion, SeatScopeEditor, HoursEntries, toggleScope, scopeParts, NO_HOURS_REASON,
} from '../src/pages/partner/delivery/deliveryEdits.jsx';
import { codeOnly } from './_codeOnly.mjs';

const html = (el) => renderToStaticMarkup(h(MemoryRouter, null, el));
const words = (markup) => {
  let out = '';
  let inTag = false;
  for (const ch of String(markup)) {
    if (ch === '<') { inTag = true; out += ' '; } else if (ch === '>' && inTag) inTag = false;
    else if (!inTag) out += ch;
  }
  return out.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
};
const read = (rel) => codeOnly(readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8'));

test('an open blocker offers Clear and Delete, as two buttons', () => {
  const markup = html(h(BlockerRow, { b: { id: 7, side: 'client', summary: 'Waiting on API keys', days_open: 4, cleared_at: null } }));
  const text = words(markup);
  assert.match(text, /Client side Waiting on API keys 4d open Clear Delete/);
  assert.match(markup, /title="Marks it cleared today and keeps it on record\."/);
  assert.match(markup, /title="Removes the blocker\. Use it for one raised by mistake; Clear keeps a real one on record\."/);
  assert.doesNotMatch(text, /Reopen/);
});

/** Every element in a pure component's returned tree. */
function walk(el, out = []) {
  if (Array.isArray(el)) { el.forEach((x) => walk(x, out)); return out; }
  if (!el || typeof el !== 'object') return out;
  out.push(el);
  walk(el.props?.children, out);
  return out;
}
const buttonsOf = (el) => walk(el).filter((x) => x.type === 'button')
  .map((x) => ({ text: [].concat(x.props.children).filter((c) => typeof c === 'string').join('').trim(), props: x.props }));

test('Clear and Delete call different handlers, and neither is hidden', () => {
  const onClear = () => 'clear';
  const onDelete = () => 'delete';
  const onReopen = () => 'reopen';
  const open = buttonsOf(BlockerRow({ b: { id: 1, side: 'ours', summary: 'x', cleared_at: null }, onClear, onDelete, onReopen }));
  assert.deepEqual(open.map((b) => b.text), ['Clear', 'Delete']);
  assert.equal(open[0].props.onClick, onClear);
  assert.equal(open[1].props.onClick, onDelete);
  for (const b of open) assert.ok(!b.props.hidden && !b.props.disabled, b.text);
  const cleared = buttonsOf(BlockerRow({ b: { id: 1, side: 'ours', summary: 'x', cleared_at: '2026-10-07' }, onClear, onDelete, onReopen }));
  assert.deepEqual(cleared.map((b) => [b.text, b.props.onClick]), [['Reopen', onReopen], ['Delete', onDelete]]);
});

test('a cleared blocker stays on record, with Reopen and Delete', () => {
  const text = words(html(h(BlockerRow, { b: { id: 8, side: 'ours', summary: 'Infra freeze', cleared_at: '2026-10-07T10:00:00Z', days_open: null } })));
  assert.match(text, /Our side Infra freeze Cleared .* · kept on record Reopen Delete/);
  assert.doesNotMatch(text, /\bClear\b(?! keeps)/, 'no second Clear on a cleared blocker');
  assert.match(blockerDeleteQuestion({ summary: 'Infra freeze' }), /It is removed, not cleared\. To keep it on record, use Clear instead\./);
});

test('the Health page wires Clear, Reopen and Delete to different calls', () => {
  const src = read('pages/partner/delivery/HealthZone.jsx');
  assert.match(src, /onClear=\{\(\) => act\(\(\) => api\.updatePartnerBlocker\(b\.id, \{ cleared_at: new Date\(\)\.toISOString\(\) \}\)\)\}/);
  assert.match(src, /onReopen=\{\(\) => act\(\(\) => api\.updatePartnerBlocker\(b\.id, \{ cleared_at: null \}\)\)\}/);
  assert.match(src, /onDelete=\{\(\) => \{ if \(window\.confirm\(blockerDeleteQuestion\(b\)\)\) act\(\(\) => api\.deletePartnerBlocker\(b\.id\)\); \}\}/);
  assert.match(src, /Blockers could not be read just now\./);
  assert.match(src, /onClick=\{load\}>Try again</);
});

test('a live seat edits its scope in place; a revoked seat does not', () => {
  const live = { id: 3, scope: 'Board, KPIs', revoked_at: null };
  assert.match(words(html(h(SeatScopeEditor, { seat: live }))), /Board, KPIs Edit scope/);
  const editing = html(h(SeatScopeEditor, { seat: live, initialEditing: true }));
  assert.match(editing, /data-testid="seat-scope-editor-3"/);
  assert.match(editing, /aria-pressed="true"[^>]*>Board</);
  assert.match(editing, /aria-pressed="true"[^>]*>KPIs</);
  assert.match(editing, /aria-pressed="false"[^>]*>Roadmap</);
  assert.match(editing, /id="seat-scope-3"[^>]*value="Board, KPIs"/);
  assert.match(words(editing), /Save Cancel/);

  const revoked = words(html(h(SeatScopeEditor, { seat: { ...live, revoked_at: '2026-10-01' } })));
  assert.match(revoked, /Board, KPIs/);
  assert.doesNotMatch(revoked, /Edit scope|Save/);
  assert.match(words(html(h(SeatScopeEditor, { seat: { id: 4, scope: null, revoked_at: null } }))), /Scope not recorded Edit scope/);

  assert.equal(toggleScope('Board, KPIs', 'Roadmap'), 'Board, KPIs, Roadmap');
  assert.equal(toggleScope('Board, KPIs', 'kpis'), 'Board');
  assert.deepEqual(scopeParts(' Board , ,KPIs '), ['Board', 'KPIs']);
  assert.match(read('pages/partner/delivery/CapacityZone.jsx'), /api\.updatePartnerSeat\(s\.id, \{ scope: scope \|\| null \}\)/);
});

const PERIODS = ['2026-10', '2026-09', '2026-08'];
const ENTRY = { engagement_id: 901, person_user_id: 61, person_name: 'Sam', client: 'Fran', hours: { '2026-10': 12.5, '2026-09': null, '2026-08': 8 } };

test('hours by entry: a month with no entry reads Not recorded, never 0, and each entry can be deleted', () => {
  const markup = html(h(HoursEntries, { read: { kind: 'ready', periods: PERIODS, entries: [ENTRY] } }));
  const text = words(markup);
  assert.match(text, /Client · person 2026-10 2026-09 2026-08 Fran · Sam 12\.5 h Delete Not recorded 8 h Delete/);
  const gap = markup.slice(markup.indexOf('data-testid="hours-901-61-2026-09"'));
  assert.match(gap.slice(0, 300), new RegExp(`title="${NO_HOURS_REASON.replace(/\./g, '\\.')}"`));
  assert.doesNotMatch(gap.slice(0, 300), /0 h/);
  assert.equal((markup.match(/>Delete</g) || []).length, 2, 'Delete only where there is an entry');
  assert.match(markup, /aria-label="Delete 12\.5 hours for Sam in 2026-10"/);
  assert.match(text, /Deleting an entry is not logging 0\./);
});

test('hours by entry: loading, empty and unreadable', () => {
  assert.match(words(html(h(HoursEntries, { read: { kind: 'loading' } }))), /Loading hours…/);
  assert.match(words(html(h(HoursEntries, { read: { kind: 'ready', periods: PERIODS, entries: [] } }))), /No client hours are logged for these three months\./);
  const unread = words(html(h(HoursEntries, { read: { kind: 'unreadable' } })));
  assert.match(unread, /Hours could not be read just now\. Try again/);
  assert.doesNotMatch(unread, /No client hours|0 h/);
});

test('the Capacity page deletes an entry, never saves 0 for it', () => {
  const src = read('pages/partner/delivery/CapacityZone.jsx');
  assert.match(src, /api\.deletePartnerHours\(e\.engagement_id, e\.person_user_id, p\)/);
  assert.match(src, /api\.listPartnerHourEntries\(period\)/);
  assert.match(src, /The month then reads Not recorded, not 0\./);
});
