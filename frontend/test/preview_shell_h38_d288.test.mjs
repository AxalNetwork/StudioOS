/**
 * D288 — "View as" becomes Preview shell (H38); View As, the impersonation,
 * keeps its name. Tasks 423 and 404.
 *
 * WHAT IS PINNED, AND WHY BY VALUE. H38's words — the trigger, the header,
 * the six options in its order with their sentences, the chip, the sentence
 * about whose name the writes carry, the way back, the footer — are the
 * artboard's, so they are compared verbatim. The one thing H38 does not draw
 * that the picker keeps is Exploring, last, recorded in D288. Two properties
 * are held by the elevation: HQ is offered to the holder alone, and "the Super
 * Admin" is said to the holder alone.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PREVIEW_SHELLS, PREVIEW_TRIGGER, PREVIEW_HEADER, PREVIEW_FOOTER,
  previewOptionsFor, selectedPreviewKey, homePreviewKey, previewChip, previewNote, writesAs,
} from '../src/lib/previewShells.js';
import { HQ_ONLY_ACTIONS } from '../src/pages/hq/HqTeamActions.jsx';
import { codeOnly } from './_codeOnly.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');
const APP = read('frontend/src/App.jsx');
const APP_CODE = codeOnly(APP);
const SWITCHER = APP_CODE.slice(APP_CODE.indexOf('function PortalSwitcher('), APP_CODE.indexOf('const FULL_BLEED_BY_ROLE'));

/* ------------------------------------------------------------------ *
 * H38's words
 * ------------------------------------------------------------------ */

test('the options are H38\'s, in H38\'s order and words, with Exploring kept last by decision', () => {
  assert.deepEqual(PREVIEW_SHELLS.map((o) => [o.label, o.what]), [
    ['HQ', 'The eleven-row shell.'],
    ['HQ’s own accounts', 'The eight-row Admin shell over accounts HQ holds directly (Subsidiary S20).'],
    ['Founder', 'The founder shell.'],
    ['Investor', 'The investor shell.'],
    ['Partner', 'The operating partner shell.'],
    ['Advisor', 'The advisor shell.'],
    ['Exploring', 'The exploring shell.'],
  ]);
  assert.equal(PREVIEW_TRIGGER, 'Preview shell');
  assert.equal(PREVIEW_HEADER, 'Preview shell · this browser only');
  assert.equal(PREVIEW_FOOTER, 'Not impersonation. To act as a person, use View As on their row in Team: a typed reason, the authenticator, 30 minutes, recorded in Security.');
  assert.equal(previewChip('Founder'), 'Previewing · Founder shell');
  assert.match(read('frontend/src/lib/previewShells.js'), /return 'Previewing · ' \+ label \+ ' shell';/, 'the chip is not built as the artboard builds it');
});

test('HQ is offered to the holder alone and sets hq: true; HQ\'s own accounts sets hq: false', () => {
  assert.deepEqual(previewOptionsFor(true).map((o) => o.key), ['hq', 'admin', 'founder', 'investor', 'partner', 'advisor', 'exploring']);
  assert.deepEqual(previewOptionsFor(false).map((o) => o.key), ['admin', 'founder', 'investor', 'partner', 'advisor', 'exploring']);
  assert.ok(!previewOptionsFor(false).some((o) => o.label === 'HQ'), '"HQ" is offered to an admin without the elevation');
  assert.ok(!previewOptionsFor(undefined).some((o) => o.key === 'hq'), 'an unknown elevation is offered HQ');
  const hq = PREVIEW_SHELLS.find((o) => o.key === 'hq');
  const own = PREVIEW_SHELLS.find((o) => o.key === 'admin');
  assert.deepEqual([hq.viewMode, hq.hq, hq.holderOnly], ['admin', true, true]);
  assert.deepEqual([own.viewMode, own.hq, own.holderOnly], ['admin', false, false]);
  // The switcher's own choose() carries the two calls the shell reads.
  assert.match(SWITCHER, /if \(key === 'hq'\) onViewModeChange\('admin', \{ hq: true \}\);/, 'HQ does not set hq: true');
  assert.match(SWITCHER, /else if \(key === 'admin'\) onViewModeChange\('admin', \{ hq: false \}\);/, '"HQ\'s own accounts" does not set hq: false');
});

test('the chip says "the Super Admin" to the holder and "you" to anyone else', () => {
  assert.equal(writesAs(true), 'the Super Admin');
  assert.equal(writesAs(false), 'you');
  assert.equal(writesAs(undefined), 'you');
  assert.equal(previewNote(true), 'This changes this browser’s chrome only. Every write still goes out as the Super Admin.');
  assert.equal(previewNote(false), 'This changes this browser’s chrome only. Every write still goes out as you.');
  // The strip renders the note by the elevation, and no literal "Super Admin"
  // sits in the preview strip or menu for a non-holder to read.
  assert.match(SWITCHER, /\{previewNote\(superAdmin\)\}/, 'the strip does not word the note by the elevation');
  const strip = SWITCHER.slice(SWITCHER.indexOf('data-testid="preview-shell-strip"'));
  assert.doesNotMatch(strip.slice(0, strip.indexOf('</div>')), /Super Admin/, 'the strip names the Super Admin unconditionally');
});

test('the selected and home keys follow the shell state, so the strip shows only while previewing', () => {
  assert.equal(selectedPreviewKey('admin', true), 'hq');
  assert.equal(selectedPreviewKey('admin', false), 'admin');
  assert.equal(selectedPreviewKey('founder', false), 'founder');
  assert.equal(homePreviewKey(true), 'hq');
  assert.equal(homePreviewKey(false), 'admin');
  assert.match(SWITCHER, /const previewing = selected && home && selected\.key !== home\.key;/);
  assert.match(SWITCHER, /\{!isImpersonating && previewing && \(/, 'the strip is not confined to a preview');
  assert.match(SWITCHER, /Back to \{home\.label\}/, 'the way back is not the viewer\'s own shell (Back to HQ for the holder)');
  assert.match(SWITCHER, /onClick=\{\(\) => choose\(home\.key\)\}/);
});

/* ------------------------------------------------------------------ *
 * The switcher draws it
 * ------------------------------------------------------------------ */

test('the trigger reads Preview shell, the menu carries the header, every option with its sentence, and the footer', () => {
  assert.match(SWITCHER, /data-testid="preview-shell-trigger"/);
  assert.match(SWITCHER, /<span>\{PREVIEW_TRIGGER\}<\/span>/, 'the trigger is no longer "Preview shell"');
  assert.doesNotMatch(SWITCHER, /View as:/, 'the old trigger wording is back');
  assert.match(SWITCHER, /\{PREVIEW_HEADER\}/, 'the header is dropped');
  assert.match(SWITCHER, /\{previewOptions\.map\(\(o\) => \(/, 'the options are not read from the list');
  assert.match(SWITCHER, /<span className="block">\{o\.label\}<\/span>\s*<span className="block text-\[11px\] text-gray-500">\{o\.what\}<\/span>/, 'an option no longer draws its sentence');
  assert.match(SWITCHER, /\{PREVIEW_FOOTER\}/, 'the footer is dropped');
  assert.match(SWITCHER, /\{previewChip\(selected\.label\)\}/, 'the chip is not H38\'s');
  assert.match(APP, /import \{\s*PREVIEW_SHELLS, PREVIEW_TRIGGER, PREVIEW_HEADER, PREVIEW_FOOTER,\s*previewOptionsFor, selectedPreviewKey, homePreviewKey, previewChip, previewNote,\s*\} from '\.\/lib\/previewShells';/);
});

test('View As — impersonation — keeps its name and chrome (task 404), and the Team row follows the rename', () => {
  // The impersonation strip inside the switcher is unchanged: its words, its
  // timer, Extend and Exit Impersonation.
  assert.match(SWITCHER, /Viewing as \{impersonatedUser\?\.name\} — support session/);
  assert.match(SWITCHER, /Exit Impersonation/);
  assert.match(SWITCHER, /onClick=\{onExtendImpersonation\}/);
  const row = HQ_ONLY_ACTIONS.find((a) => a.key === 'role_shell');
  assert.equal(row.name, 'Preview shell', 'the Team row still calls the picker "View as a role shell"');
  assert.equal(row.hq, false);
  assert.match(row.gate, /a chip states that every write still goes out as you — as the Super Admin, for the holder/);
  assert.match(row.where, /^Preview shell in the top bar, both tiers\.$/);
  const impersonate = HQ_ONLY_ACTIONS.find((a) => a.key === 'impersonate');
  assert.match(impersonate.name, /^Impersonate/, 'the impersonation row was renamed');
  assert.match(impersonate.where, /View As/, 'the impersonation row no longer names the View As control');
  // The control on a user's row in the directory is still "View As".
  assert.match(read('frontend/src/pages/AdminPage.jsx'), />\s*View As\s*</, 'the directory\'s impersonation control lost its name');
});
