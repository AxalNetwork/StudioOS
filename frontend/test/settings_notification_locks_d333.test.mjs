/**
 * D333 — the capital-call and signature email rows in the notifications
 * matrix are locked, matching the backend truth: `notify.ts`'s
 * CRITICAL_CATEGORIES (billing, contract_sign_request) already never let
 * quiet hours or a digest delay these two. Before this, the matrix offered
 * a toggle that did nothing — turning the email column off for
 * `capital_call_issued` or `agreement_ready_to_sign` never actually
 * stopped the email, because the backend sent it regardless. This test
 * pins the source-level shape that fixes the mismatch, not just the data:
 * the lock has to survive a preset re-apply too, or "Mute all" would quietly
 * promise silence it can't deliver.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeOnly } from './_codeOnly.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = codeOnly(fs.readFileSync(
  path.join(__dirname, '../src/pages/SettingsPage.jsx'), 'utf8',
));

test('capital_call_issued and agreement_ready_to_sign declare a locked email channel', () => {
  const ccMatch = src.match(/key:\s*'capital_call_issued'[^}]*}/);
  const sigMatch = src.match(/key:\s*'agreement_ready_to_sign'[^}]*}/);
  assert.ok(ccMatch, 'capital_call_issued event entry not found');
  assert.ok(sigMatch, 'agreement_ready_to_sign event entry not found');
  assert.match(ccMatch[0], /lockedChannels:\s*\[\s*'email'\s*\]/, 'capital call email channel is not locked');
  assert.match(sigMatch[0], /lockedChannels:\s*\[\s*'email'\s*\]/, 'signature email channel is not locked');
  // capital_call_paid is deliberately NOT locked — only the issuance notice is.
  const paidMatch = src.match(/key:\s*'capital_call_paid'[^}]*}/);
  assert.ok(paidMatch);
  assert.doesNotMatch(paidMatch[0], /lockedChannels/, 'capital_call_paid should stay user-toggleable');
});

test('a locked channel renders checked and disabled, overriding prefs', () => {
  assert.match(
    src,
    /const locked = \(ev\.lockedChannels \|\| \[\]\)\.includes\(c\.key\);/,
    'the table render has no per-cell lock check',
  );
  assert.match(src, /const checked = locked \|\| !!prefs\[ev\.key\]\?\.\[c\.key\];/);
  assert.match(src, /const disabled = !!c\.disabled \|\| locked;/);
});

test('setEvent refuses to write a locked channel', () => {
  assert.match(
    src,
    /if \(lockedEvent\(eventKey\)\.includes\(channel\)\) return;/,
    'setEvent has no early return for a locked channel — a direct write could still unlock it',
  );
});

test('applying a preset re-locks every locked channel instead of trusting the preset', () => {
  const applyPresetBody = src.match(/const applyPreset = \(preset\) => \{[\s\S]*?\n  \};/);
  assert.ok(applyPresetBody, 'applyPreset function not found');
  assert.match(
    applyPresetBody[0],
    /for \(const lockedChannel of lockedEvent\(k\)\) applied\[lockedChannel\] = true;/,
    '"Mute all" (or any preset) could silence a locked channel the backend still sends',
  );
});
