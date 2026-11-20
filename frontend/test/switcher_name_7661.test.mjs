/**
 * D7661 (#7661): the company switcher's trigger is named by the words it
 * shows (WCAG 2.5.3, Label in Name; axe `label-content-name-mismatch`), with
 * no selection and with one.
 *
 * The trigger had `aria-label="Switch company or project"` with no selection.
 * That label did not contain "No company", the text on the button, so a
 * speech-input user who said what they saw could not reach it. Now the button
 * has no `aria-label`. `SwitcherTriggerFace` draws its content: one
 * screen-reader-only sentence, which is the accessible name (the visible text
 * in drawn order, then the action), and the drawn parts, `aria-hidden`.
 *
 * Each test reads the server render. "Name" is the screen-reader sentence;
 * "visible" is the text of the drawn parts, less the initials mark. The browser
 * check (axe and Chromium's computed name) is in D7661.md.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/switcher_name_7661.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderedText } from './_renderedText.mjs';
import { codeOnly } from './_codeOnly.mjs';
import { SwitcherTriggerFace, SWITCH_ACTION, selectionLabel, switcherTriggerName } from '../src/ui/CompanySwitcher.jsx';

const h = React.createElement;
const squash = (s) => s.replace(/\s+/g, ' ').trim();
/**
 * The trigger's content, split: the screen-reader sentence first, then the
 * hidden initials mark, then the hidden drawn text. Anything else in the
 * button, such as a visible part that is not hidden, fails the match.
 */
const SHAPE = /^<button type="button"><span class="sr-only">([^<]*)<\/span><div aria-hidden="true"[^>]*>([^<]*)<\/div><span aria-hidden="true"[^>]*>(.*)<\/span><\/button>$/;
function face(selection, abbr) {
  const html = renderToStaticMarkup(h('button', { type: 'button' }, h(SwitcherTriggerFace, { selection, abbr })));
  const m = html.match(SHAPE);
  assert.ok(m, `the trigger's content has its expected shape: ${html}`);
  return { name: squash(renderedText(m[1])), mark: m[2], visible: squash(renderedText(m[3].replace(/></g, '> <'))) };
}
/** axe's comparison: lower-case words, punctuation dropped; here the visible words must open the name. */
const words = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);
const opensWith = (name, visible) => {
  const n = words(name); const v = words(visible);
  return v.length > 0 && v.every((w, i) => n[i] === w);
};

test('D7661: with no company selected, the trigger is named "No company, switch company or project"', () => {
  const f = face(selectionLabel(null, null, {}), 'NC');
  assert.equal(f.name, 'No company, switch company or project');
  assert.equal(f.visible, 'No company');
  assert.equal(f.mark, 'NC', 'the initials mark is still drawn, and hidden');
  assert.ok(opensWith(f.name, f.visible), 'the name starts with the visible text');
});

test('D7661: a failed read is named by what it shows, "Unavailable"', () => {
  const f = face(selectionLabel(null, null, { failed: true }), 'U');
  assert.equal(f.name, 'Unavailable, switch company or project');
  assert.ok(opensWith(f.name, f.visible));
});

test('D7661: with a company selected, the name keeps the company and its type, then the action', () => {
  const f = face(selectionLabel({ company_name: 'Example Ventures' }, null, {}), 'EV');
  assert.equal(f.name, 'Example Ventures, Company, switch company or project');
  assert.equal(f.visible, 'Example Ventures Company');
  assert.ok(opensWith(f.name, f.visible));
  assert.doesNotMatch(f.name, /\bEV\b/, 'the initials are not read out');
});

test('D7661: with a project selected, the name is the project, its type and its company, then the action', () => {
  const f = face(selectionLabel(null, { id: 3, name: 'Atlas Pilot', company: { uid: 'ev', name: 'Example Ventures' } }, {}), 'AP');
  assert.equal(f.name, 'Atlas Pilot, Project, in Example Ventures, switch company or project');
  assert.equal(f.visible, 'Atlas Pilot Project in Example Ventures');
  assert.ok(opensWith(f.name, f.visible));
  assert.equal(switcherTriggerName({ name: 'Atlas Pilot', type: 'Project', sub: 'Standalone' }), 'Atlas Pilot, Project, Standalone, switch company or project');
});

test('D7661: the expanded trigger carries no aria-label, so its content names it', () => {
  assert.equal(SWITCH_ACTION, 'switch company or project');
  const src = codeOnly(readFileSync(new URL('../src/ui/CompanySwitcher.jsx', import.meta.url), 'utf8'));
  const at = src.indexOf('data-testid="switcher-trigger"');
  const trigger = src.slice(src.lastIndexOf('<button', at), src.indexOf('</button>', at));
  assert.match(trigger, /<SwitcherTriggerFace selection=\{selection\} abbr=\{abbr\} \/>/);
  assert.doesNotMatch(trigger, /aria-label/, 'an aria-label would replace the visible text as the name');
  assert.doesNotMatch(src, /'Switch company or project'/, 'the old label is gone');
});
