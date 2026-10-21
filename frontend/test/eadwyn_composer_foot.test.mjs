/**
 * The owner's phone pass (2026-10-21): Eadwyn's composer stood "in the middle
 * of the screen" on a short thread, right under the last message, with the
 * empty page and the shell's footer below it. `sticky` only holds a row once
 * the content is taller than the scroll; a short thread never is.
 *
 * The phone frame now reaches the scroll's visible foot (`footFill`, measured
 * by `useFootFill`), and the composer is its last row with `mt-auto`, so it
 * stands at the foot on a short thread and stays pinned on a long one.
 *
 * `PersonalAdvisor` reaches `lib/advisor/router.js`, which a Node test cannot
 * import, so its wiring is pinned in the source, as the D701 test pins it.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/eadwyn_composer_foot.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { codeOnly } from './_codeOnly.mjs';
import { footFill } from '../src/components/advisor/eadwynPhone.jsx';

const ADVISOR = codeOnly(readFileSync('frontend/src/components/advisor/PersonalAdvisor.jsx', 'utf8'));
const PHONE_FRAME = ADVISOR.slice(ADVISOR.indexOf('if (phone) {'), ADVISOR.indexOf('const containerClass ='));

/** A scroll container and a frame inside it, at the given layout. */
function layout({ scrollerTop = 60, clientHeight = 700, padBottom = '90px', scrollTop = 0, frameTop }) {
  const scroller = { clientHeight, scrollTop, getBoundingClientRect: () => ({ top: scrollerTop }) };
  const frame = { getBoundingClientRect: () => ({ top: frameTop }) };
  const view = { getComputedStyle: (el) => (el === scroller ? { paddingBottom: padBottom } : {}) };
  return { scroller, frame, view };
}

test('the frame reaches from its top to the scroll\'s foot, less the tab bar\'s clearance', () => {
  // Mutations checked: the padding not taken off (the composer under the tab bar); the scroll offset not added.
  const at = layout({ frameTop: 140 });
  assert.equal(footFill(at.frame, at.scroller, at.view), 700 - 90 - 80);
  // Scrolled 200px down, the frame's top has moved up the screen, not in the content.
  const scrolled = layout({ frameTop: -60, scrollTop: 200 });
  assert.equal(footFill(scrolled.frame, scrolled.scroller, scrolled.view), 530, 'the height changes as the page scrolls');
  // No tab bar (its variable unset): the whole scroll.
  const bare = layout({ frameTop: 140, padBottom: '0px' });
  assert.equal(footFill(bare.frame, bare.scroller, bare.view), 620);
});

test('never negative, and null without a frame or a scroll container', () => {
  const low = layout({ frameTop: 900 });
  assert.equal(footFill(low.frame, low.scroller, low.view), 0);
  const at = layout({ frameTop: 140 });
  assert.equal(footFill(null, at.scroller, at.view), null);
  assert.equal(footFill(at.frame, null, at.view), null);
});

test('the phone frame takes the measured height and its composer stands at the foot', () => {
  // Mutations checked: the composer's mt-auto dropped (it sits under the last message again); the frame's minHeight not applied.
  assert.match(ADVISOR, /const \[phoneFrame, phoneFill\] = useFootFill\(\);/);
  assert.match(PHONE_FRAME, /<div ref=\{phoneFrame\} data-card data-testid="eadwyn-phone" className="flex flex-col" style=\{phoneFill \? \{ minHeight: phoneFill \} : undefined\}>/);
  const composer = PHONE_FRAME.match(/<div className="([^"]*)" data-testid="eadwyn-phone-composer">/);
  assert.ok(composer, 'the composer row is not drawn');
  assert.match(composer[1], /\bmt-auto\b/);
  // Pinned on a long thread. bottom-0: <main> already pads by the tab bar and a
  // sticky row is held inside that padding, so the bar's height here again
  // floated the composer 56px above the bar (measured in Chromium at 390x844).
  assert.match(composer[1], /\bsticky bottom-0\b/);
  assert.doesNotMatch(composer[1], /mobile-tabbar-h/, 'the tab bar counted twice');
  assert.match(readFileSync('frontend/src/components/mobileTabBar.css', 'utf8'), /\[data-app-scroll\] \{\s*padding-bottom: var\(--mobile-tabbar-h\);/, 'the clearance bottom-0 relies on');
  // The composer is the frame's last row in the conversation tab, so mt-auto puts it at the foot.
  const conversation = PHONE_FRAME.slice(PHONE_FRAME.indexOf("panelTab === 'conversation'"), PHONE_FRAME.indexOf(") : panelTab === 'tasks'"));
  assert.match(conversation, /data-testid="eadwyn-phone-composer">[\s\S]*?<\/div>\s*<\/>\s*$/, 'a row after the composer');
});

test('the hook measures the shell\'s scroll and follows it and the content above', () => {
  const src = codeOnly(readFileSync('frontend/src/components/advisor/eadwynPhone.jsx', 'utf8'));
  const hook = src.slice(src.indexOf('export function useFootFill'));
  assert.match(hook, /closest\?\.\('\[data-app-scroll\]'\)/);
  assert.match(hook, /ro\?\.observe\(scroller\)/);
  assert.match(hook, /closest\('\[data-app-main\]'\)/);
  assert.match(hook, /\}, \[frame\]\);/, 'measured once the frame mounts, not on the first render');
});
