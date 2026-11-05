/** D4489 — calendar dates, overflow, statuses and publishing affordances. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { monthGrid, weekGrid, dayKey, dayPieces, pieceStatus, PREVIEW_WIDTHS, FOUNDER_REASON, previewImageUrl } from '../src/pages/cycles/distribution/calendarModel.js';
const src = (n) => readFileSync(new URL(`../src/pages/cycles/distribution/${n}`, import.meta.url), 'utf8');
test('all months have six Monday-first weeks, including year boundaries', () => {
  for (let m = 0; m < 12; m++) {
    const d = new Date(Date.UTC(2026, m, 15)); const grid = monthGrid(d);
    assert.equal(grid.length, 42); assert.equal(grid[0].getUTCDay(), 1);
    assert.equal(new Set(grid.map(dayKey)).size, 42);
    assert.ok(grid.some((v) => dayKey(v) === dayKey(d)));
    assert.equal(weekGrid(d).length, 7); assert.equal(weekGrid(d)[0].getUTCDay(), 1);
  }
});
test('two visible pieces then +n more, expanded returns all', () => {
  const pieces = Array.from({ length: 5 }, (_, uid) => ({ uid, planned_on: '2026-11-04' }));
  assert.equal(dayPieces(pieces, '2026-11-04').visible.length, 2);
  assert.equal(dayPieces(pieces, '2026-11-04').overflow, 3);
  assert.equal(dayPieces(pieces, '2026-11-04', true).visible.length, 5);
  assert.equal(dayPieces(pieces, '2026-11-05').overflow, 0);
  assert.match(src('CalendarTab.jsx'), /\+\{overflow\} more/);
});
test('dropped is struck through; Notion is always Planned', () => {
  assert.equal(pieceStatus({ status: 'dropped' }).dropped, true);
  assert.equal(pieceStatus({ status: 'planned' }).dropped, false);
  assert.match(src('CalendarTab.jsx'), /status.dropped \? 'line-through'/);
  for (const status of ['published', 'scheduled', 'idea', 'planned']) assert.equal(pieceStatus({ source: 'notion', status }).label, 'Planned');
});
test('founder reason, empty destinations and no fabricated best time', () => {
  const sheet = src('PieceSheet.jsx');
  assert.match(sheet, /disabled title=\{FOUNDER_REASON\}>Send/);
  assert.equal(FOUNDER_REASON, 'Only the founder publishes from this venture.');
  assert.match(sheet, /No place to publish to yet\./); assert.match(sheet, /Open Channels/);
  assert.doesNotMatch(src('CalendarTab.jsx') + sheet + src('PostPreview.jsx'), /Best time:|Request approval|Waiting for approval/);
});
test('preview widths match real platform frames without scaling', () => {
  assert.deepEqual(PREVIEW_WIDTHS, { linkedin: 552, x: 598, instagram: 468, facebook: 500, youtube: 315 });
  assert.match(src('PostPreview.jsx'), /minWidth: width/); assert.match(src('PostPreview.jsx'), /9 \/ 16/);
});

test('preview images accept only same-origin browser blob URLs, never DOM URL/HTML payloads', () => {
  const origin = 'https://axal.example';
  const blob = 'blob:https://axal.example/01234567-89ab-cdef-0123-456789abcdef';
  assert.equal(previewImageUrl(blob, origin), blob);
  assert.equal(previewImageUrl(blob, 'https://another.example'), undefined);
  for (const value of [undefined, null, {}, '', 'javascript:alert(1)', 'data:image/svg+xml,<svg onload=alert(1)>', 'https://axal.example/a.png', '<img src=x onerror=alert(1)>', blob + '\" onerror=alert(1)', blob + '?q=x', blob + '#x', 'blob:https://axal.example/not-a-uuid']) {
    assert.equal(previewImageUrl(value, origin), undefined);
  }
  assert.equal(previewImageUrl(blob, undefined), undefined);
  assert.match(src('PostPreview.jsx'), /src=\{imageUrl\}/);
});
