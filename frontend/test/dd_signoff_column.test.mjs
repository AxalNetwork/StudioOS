/**
 * D466 — the DD Sign-off column (migration 339's `dd_sections.signed_off_by`).
 *
 * The canvas's report draws a Sign-off column per section — who returned the
 * verdict and when. The signer is stamped on every verdict write (reviewer or
 * admin override alike), the case read carries the signer's name, and the
 * generated report renders it. A section completed before the column existed
 * renders unrecorded, never a guessed signer.
 *
 * The worker half is pinned in `cloudflare-worker/test/dd_signoff.test.ts`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';

const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');
const PAGE = codeOnly(read('frontend/src/pages/AdminDueDiligenceCasePage.jsx'));
const DD = read('cloudflare-worker/src/routes/dd.ts');
const REPORT = read('cloudflare-worker/src/services/dueDiligence.ts');

test('the verdict write stamps the signer on both paths', () => {
  assert.match(DD, /signed_off_by = \$\{user\.id\}/, 'the verdict write stopped stamping the signer');
  // The case read carries the signer's name, joined — not a bare id.
  assert.match(DD, /signed_off_by_name/, 'the case read dropped the signer’s name');
});

test('the case page renders the sign-off per completed section, honestly when absent', () => {
  assert.match(PAGE, /data-testid=\{`signoff-\$\{s\.id\}`\}/, 'the sign-off line is gone');
  assert.match(PAGE, /Signed off by \$\{s\.signed_off_by_name\}/, 'the signer’s name is not rendered');
  assert.match(PAGE, /Sign-off not recorded/, 'an unsigned section must not invent a signer');
  // Only a completed section carries one: a pending section has no verdict,
  // so there is no signer to name.
  assert.match(PAGE, /s\.status === 'completed' &&/, 'the sign-off must wait for a completed section');
});

test('the generated report carries the sign-off, tracing to the record', () => {
  // The canvas's own sentence is that every figure traces to a checklist item,
  // a flag, or a sign-off — so the report renders it.
  assert.match(REPORT, /signed_off_by_name/, 'the report’s section type dropped the sign-off');
  assert.match(REPORT, /Signed off by \$\{esc\(sec\.signed_off_by_name\)\}/, 'the report stopped rendering the signer');
  assert.match(REPORT, /Sign-off not recorded/, 'the report must say unrecorded rather than omit it');
  // And the report route maps it from the section row.
  assert.match(DD, /signed_off_by_name: Number\.isFinite/, 'the report route stopped mapping the signer');
});
