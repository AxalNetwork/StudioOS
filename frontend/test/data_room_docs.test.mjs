/**
 * The Data Room help article must not outlive the code it describes.
 *
 * The Help Center covered every shipped surface except this one: searching all
 * thirteen section files for "Data Room" returned nothing, while /raise/data-room
 * has been live since migration 184. The article added alongside this test is
 * written from routes/data_room.ts and DataRoomPage.jsx, not from the canvas's
 * prose, and it makes three claims that are only true while the code says so.
 *
 * A help page that quietly goes stale about who can read a file is worse than
 * no help page, so each claim is pinned to its source here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const article = read('frontend/src/pages/docs/sections/validate-grow.js');
const route = read('cloudflare-worker/src/routes/data_room.ts');
const page = read('frontend/src/pages/raise/DataRoomPage.jsx');

test('the article exists and is reachable from the manifest', () => {
  assert.match(article, /id: 'data-room'/);
  assert.match(article, /title: 'Data Room'/);
  // Anchors are `#${section.id}/${subsection.id}`; the section is validate-grow.
  assert.match(article, /href: '#validate-grow\/due-diligence'/);
});

test('the two-minute download link is what the route actually mints', () => {
  assert.match(route, /ttlSec:\s*120/, 'the TTL changed — the article says two minutes');
  assert.match(article, /expires after two minutes/);
});

test('the article repeats the page’s own two honesty rules', () => {
  // Both are stated in DataRoomPage's docblock as things the UI must be honest
  // about, because the backend is. The help page has to match.
  assert.match(page, /A download is NOT watermarked/);
  assert.match(article, /Downloads are NOT watermarked/);

  assert.match(page, /Sharing does NOT send an invitation/);
  assert.match(article, /does NOT send an invitation/);
});

test('NDA files are described as hidden, because that is what the route does', () => {
  // routes/data_room.ts: "Nothing is listed that the caller may not open."
  assert.match(route, /Nothing is listed that the caller may not open/);
  assert.match(article, /hidden — not greyed out, hidden/);
});

test('the 20 MB cap matches the page', () => {
  assert.match(page, /const MAX_MB = 20;/);
  assert.match(article, /20 MB each/);
});
