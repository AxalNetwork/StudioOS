/**
 * D7662 (#7662): the Worker rail's `.fwr-absent` line ("Not recorded. …",
 * "Loading…", "Reading this page…", the composer's note) clears WCAG 2.2 AA's
 * 4.5:1 in light mode and keeps its dark value.
 *
 * It was `--fwr-faint` (`#8b8494`), 3.60:1 on white (axe, D7517). It now reads
 * its own property, `--fwr-absent`. In light mode that is `#716c7e`, the
 * rail palette's faint grey that D1511 measured for the same rule. In dark mode
 * it is `--fwr-faint`, unchanged. The other `--fwr-faint` users (the title, the
 * block labels, the toggle, the foot note) are not this issue's and keep their
 * colour; #5130 owns the rail.
 *
 * The figures are computed from the stylesheet with the WCAG formula, on every
 * ground the rail draws the line on: its white paper, the rail's grey ground,
 * the accent soft of a selected card, and the app's page ground.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/rail_absent_contrast_7662.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CSS = readFileSync(new URL('../src/ui/workerRail.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of every rule whose selector is exactly `selector`, in order. */
function block(selector) {
  // A rule's selector is the text between the previous `}` and its `{`. The
  // first rule inside an at-rule also carries the at-rule's text, so it never
  // equals `selector`, as with the regex this replaces.
  const bodies = CSS.split('}').map((chunk) => chunk.split('{'))
    .filter((parts) => parts.length === 2 && parts[0].trim() === selector).map((parts) => parts[1]);
  assert.ok(bodies.length > 0, `${selector} has a rule`);
  return bodies.join(';');
}
/** A custom property's value; a later rule wins, as in the cascade. Three-digit hex is widened. */
const prop = (body, name) => {
  const all = body.split(';').map((decl) => [decl.slice(0, decl.indexOf(':')).trim(), decl.slice(decl.indexOf(':') + 1)])
    .filter(([key]) => key === name);
  const v = all.at(-1)?.[1]?.trim();
  return /^#[0-9a-f]{3}$/i.test(v || '') ? `#${[...v.slice(1)].map((c) => c + c).join('')}` : v;
};

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const LIGHT = block('.fwr');
const DARK = block('.dark .fwr');

test('D7662: .fwr-absent reads its own colour, not --fwr-faint', () => {
  assert.equal(prop(block('.fwr-absent'), 'color'), 'var(--fwr-absent)');
});

test('D7662: in light mode the absent line is at least 4.5:1 on every ground it sits on', () => {
  const ink = prop(LIGHT, '--fwr-absent');
  assert.match(ink, /^#[0-9a-f]{6}$/i, 'a plain colour, so it can be measured');
  const grounds = {
    'the rail paper (--fwr-paper)': prop(LIGHT, '--fwr-paper'),
    'the rail ground (--d698-ground)': prop(LIGHT, '--d698-ground'),
    'the founder accent soft': '#f5efff',
    'the app page ground': '#f9fafb',
  };
  for (const [where, ground] of Object.entries(grounds)) {
    const r = contrast(ink, ground);
    assert.ok(r >= 4.5, `${ink} on ${ground} (${where}) is ${r.toFixed(2)}:1, under 4.5:1`);
  }
  assert.ok(contrast(prop(LIGHT, '--fwr-faint'), '#ffffff') < 4.5, 'the old colour is the one that failed (3.60:1)');
});

test('D7662: the dark value is unchanged, --fwr-faint, and clears 4.5:1 on the dark paper', () => {
  assert.equal(prop(DARK, '--fwr-absent'), 'var(--fwr-faint)');
  assert.equal(prop(DARK, '--fwr-faint'), '#8b849c');
  const r = contrast(prop(DARK, '--fwr-faint'), prop(DARK, '--fwr-paper'));
  assert.ok(r >= 4.5, `dark: ${r.toFixed(2)}:1`);
});
