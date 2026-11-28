/**
 * D8729 part 3 (#8729): what the real-browser check at 390 × 844
 * (`frontend/tests/e2e/studio_founder_first_screen_8729.spec.js`) found and
 * this part fixed, pinned here without a browser:
 *
 *   · below 1024px the Add feature form is a page (D695) whose bar drops the
 *     dialog's first line, so a form opened from Studio now draws
 *     "<venture> · Build · Solution design" at the top of its body (SFD12C);
 *     as a dialog the eyebrow already carries it and nothing more is drawn;
 *   · the Next card's primary was 40px on a phone: `min-h-11` lost to
 *     `.sm-btn`'s 40px, so the founder Studio restores 44px for an `sm-btn`
 *     that asks for it;
 *   · the venture header's and the Next card's eyebrow used `text-axal-faint`,
 *     which axe failed for colour contrast; it is `text-axal-muted`;
 *   · the Next card's "Open ›" links were named without the word they show
 *     (axe's label-content-name-mismatch); the name now starts with "Open".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import FormLightbox from '../src/pages/cycles/FormLightbox.jsx';
import { BUILD_FORMS } from '../src/pages/cycles/forms.js';
import { NextCard } from '../src/pages/founder/StudioVenture.jsx';
import { NEXT } from '../src/pages/founder/founderNextModel.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

/** Renders with the window `phone` wide: below 1024px (page mode) or not. */
function atWidth(phone, el) {
  const had = Object.hasOwn(globalThis, 'window');
  const before = globalThis.window;
  globalThis.window = { ...(before || {}), matchMedia: (query) => ({ matches: phone, media: query, addEventListener() {}, removeEventListener() {} }) };
  try { return renderToStaticMarkup(h(MemoryRouter, null, el)); } finally {
    if (had) globalThis.window = before; else delete globalThis.window;
  }
}
const feature = (venture) => h(FormLightbox, { form: BUILD_FORMS['solution-design'][0], cycle: 'build', slug: 'solution-design', venture, onClose() {} });

test('the Add feature page names the venture Studio opened it for; the dialog says it once, in its eyebrow (SFD05, SFD12C)', () => {
  // Mutation checked: dropping <PageVentureLine> from FormLightbox fails the first assertion.
  const page = atWidth(true, feature('Atlas Orchard'));
  assert.match(page, /data-testid="cycle-form-page"/, 'below 1024px the form is the page');
  assert.match(page, /<p [^>]*data-testid="cycle-form-venture"[^>]*>Atlas Orchard · Build · Solution design<\/p>/);
  // Mutation checked: drawing the line whatever the width (no `useLightboxPage()` guard) fails this.
  const dialog = atWidth(false, feature('Atlas Orchard'));
  assert.match(dialog, /data-testid="cycle-form"/);
  assert.match(dialog, /Atlas Orchard · Build · Solution design/, 'the dialog\'s eyebrow names the venture');
  assert.doesNotMatch(dialog, /cycle-form-venture/, 'and says it once');
  // Not opened from Studio (no venture), or a blank one: no line, as before.
  assert.doesNotMatch(atWidth(true, feature(null)), /cycle-form-venture/);
  assert.doesNotMatch(atWidth(true, feature('   ')), /cycle-form-venture/);
});

test('the founder Studio restores 44px to an `sm-btn` that asks for it on a phone', () => {
  // Why the rule is needed: `.sm-btn` sets 40px outside Tailwind's layers, so `min-h-11` alone loses.
  assert.match(read('../src/pages/studio/studioModules.css'), /\.sm-btn \{[^}]*min-height: 40px/);
  // Mutation checked: deleting this rule makes the browser spec measure the primary at 40px again.
  assert.match(read('../src/pages/founder/founderStudioHome.css'), /\.fs-root \.sm-btn\.min-h-11 \{ min-height: 44px; \}/);
  assert.match(read('../src/pages/founder/FounderStudioBody.jsx'), /className=\{`fs-root /, 'the venture header and the Next card sit inside .fs-root');
});

const ready = { state: NEXT.READY, steps: [
  { key: 'build_solution_design', source: 'Build · Solution design', text: 'Add feature', to: '/build/solution-design/new?project_id=12', add: true },
  { key: 'build_product_roadmap', source: 'Build · Product roadmap', text: 'Move the next planned item into Now', to: '/build/product-roadmap?project_id=12', add: false },
] };

test('the Next card\'s eyebrow is the muted ink, and each "Open ›" is named starting with the word it shows', () => {
  const out = atWidth(true, h(NextCard, { next: ready, venture: 'Atlas Orchard', ventureId: 12, phone: true }));
  // Mutation checked: putting `text-axal-faint` back on EYEBROW fails this.
  assert.match(out, /<p class="[^"]*text-axal-muted[^"]*">Build · Solution design<\/p>/);
  assert.doesNotMatch(out, /text-axal-faint/);
  // Mutation checked: naming the link by the task alone (no "Open: ") fails this.
  assert.match(out, /aria-label="Open: Move the next planned item into Now in Atlas Orchard"[^>]*>Open ›<\/a>/);
  // The primary keeps its own name, which already starts with what it shows.
  assert.match(out, /aria-label="Add feature to Atlas Orchard"[^>]*>Add feature<\/a>/);
  assert.match(out, /class="sm-btn sm-btn-p mt-2\.5 min-h-11"/);
});
