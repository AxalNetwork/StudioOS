/**
 * D415 — the Messages canvas's paperclip, wired to migration 323.
 *
 * The canvas draws a paperclip in the composer and says "Attachments are
 * visible to both parties only". This pins the page to the Worker:
 *   1. the paperclip sends a file as a message through the one upload route,
 *      and is disabled only with the Worker's reason;
 *   2. a file on a bubble is opened by asking the Worker for a signed link —
 *      the page never builds a URL to the bytes itself;
 *   3. what the picker offers is what the Worker accepts, and the page's
 *      size check is the Worker's number.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { apiMethodNames } from './_apiMethods.mjs';
import { fileSize, ATTACHMENT_MAX_BYTES as PAGE_MAX } from '../src/lib/messagesView.js';

const raw = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const CANVAS = raw('design/canvases/backlog/Messages.dc.html');
const page = codeOnly(raw('frontend/src/pages/MessagesPage.jsx'));
const view = codeOnly(raw('frontend/src/lib/messagesView.js'));
const api = raw('frontend/src/lib/api.js');
const worker = codeOnly(raw('cloudflare-worker/src/routes/messages.ts'));
const migration = raw('cloudflare-worker/sql/migrations/323_message_attachments.sql');

function between(src, a, b) {
  const from = src.indexOf(a);
  assert.ok(from >= 0, `the opening marker is gone: ${a}`);
  const to = src.indexOf(b, from + a.length);
  assert.ok(to > from, `the closing marker is gone: ${b}`);
  return src.slice(from, to);
}

const COMPOSER = between(page, 'function Composer(', 'function AttachmentChip(');
const CHIP = between(page, 'function AttachmentChip(', 'function ContextStrip(');

test('the canvas draws a paperclip and says attachments are for both parties', () => {
  assert.ok(CANVAS.includes('title="Attach a file"'));
  assert.ok(CANVAS.includes("'Attachments are visible to both parties only.'"));
});

test('the paperclip opens a picker, and is disabled only with the Worker’s reason', () => {
  assert.match(COMPOSER, /onClick=\{\(\) => picker\.current\?\.click\(\)\}/);
  assert.match(COMPOSER, /const canAttach = !attachReason && !disabled;/);
  assert.match(COMPOSER, /disabled=\{!canAttach \|\| busy\}/);
  assert.match(COMPOSER, /accept=\{ATTACHMENT_ACCEPT\}/);
});

test('a chosen file is sent as one message, with what was typed', () => {
  assert.match(COMPOSER, /if \(file\) await onAttach\(file, body\);\s*\n\s*else await onSend\(body\);/);
  assert.match(COMPOSER, /disabled=\{disabled \|\| busy \|\| \(!text\.trim\(\) && !file\)\}/);
  assert.match(page, /await api\.messageAttach\(openUid, file, body\);/);
  assert.match(page, /onAttach=\{attach\}/);
  // The Worker's refusal sentence is what the page prints.
  assert.match(COMPOSER, /setErr\(ex\?\.message \|\| 'That message did not send\.'\)/);
});

test('a file on a bubble is opened through a Worker-minted link, never a built URL', () => {
  assert.match(CHIP, /const r = await api\.messageAttachmentLink\(threadUid, a\.uid\);/);
  assert.match(CHIP, /window\.location\.assign\(r\.url\);/);
  assert.ok(!/\/api\/files\/dl|r2_key|messages\//.test(page), 'the page names a path to the bytes');
  assert.match(page, /\(m\.attachments \|\| \[\]\)\.map\(\(a\) => <AttachmentChip key=\{a\.uid\} threadUid=\{openUid\} a=\{a\} mine=\{m\.mine\} \/>\)/);
});

test('the two api methods exist and reach the two routes', () => {
  const defined = apiMethodNames(api);
  assert.ok(defined.has('messageAttach') && defined.has('messageAttachmentLink'));
  assert.match(api, /request\(`\/messages\/\$\{encodeURIComponent\(uid\)\}\/attachments`, \{ method: 'POST', body: fd \}\)/);
  assert.match(api, /\/attachments\/\$\{encodeURIComponent\(attUid\)\}\/link`, \{ method: 'POST' \}\)/);
  assert.match(worker, /r\.post\('\/:uid\/attachments', async/);
  assert.match(worker, /r\.post\('\/:uid\/attachments\/:att\/link', async/);
});

test('the picker offers what the Worker accepts, and the size is the Worker’s number', () => {
  assert.match(worker, /export const ATTACHMENT_MAX_BYTES = 10 \* 1024 \* 1024;/);
  assert.equal(PAGE_MAX, 10 * 1024 * 1024);
  const accept = view.match(/export const ATTACHMENT_ACCEPT = '([^']+)';/)[1].split(',');
  assert.deepEqual(accept, ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.docx', '.xlsx', '.pptx']);
  for (const [ext, sniffed] of [['pdf', "'application/pdf'"], ['png', "'image/png'"], ['webp', "'image/webp'"], ['docx', 'wordprocessingml'], ['xlsx', 'spreadsheetml'], ['pptx', 'presentationml']]) {
    assert.ok(worker.includes(sniffed), `the Worker no longer accepts ${ext}`);
  }
  assert.equal(fileSize(512), '512 B');
  assert.equal(fileSize(2048), '2 KB');
  assert.equal(fileSize(3 * 1024 * 1024), '3.0 MB');
});

test('the store keeps the bytes out of D1 and under its own prefix', () => {
  const sql = migration.replace(/^\s*--.*$/gm, '');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS message_attachments \(/);
  assert.match(sql, /r2_key\s+TEXT\s+NOT NULL UNIQUE CHECK \(r2_key LIKE 'messages\/%'\)/);
  assert.ok(!/\bBLOB\b|BEGIN|COMMIT|DROP |ALTER /i.test(sql), 'the migration must be additive and hold no bytes');
  assert.match(worker, /const key = `messages\/\$\{thread\.uid\}\/\$\{attUid\}\/\$\{filename\}`;/);
});
