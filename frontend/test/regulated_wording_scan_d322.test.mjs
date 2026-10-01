/**
 * D322 — the regulated-wording lint reads JSX text on lines of its own, never
 * mistakes a className list for prose, and covers the Studio.
 *
 * The lint (scripts/check-regulated-wording.mjs) runs in `test:guards` against
 * the live tree. These tests pin the scanner itself, so a change that makes it
 * read less fails here rather than silently passing everything.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SURFACES, visibleText } from '../../scripts/check-regulated-wording.mjs';
import { codeOnly } from './_codeOnly.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(`${root}${rel}`, 'utf8');

test('JSX text on a line of its own is read, as the single-line kind always was', () => {
  const src = [
    '      <div className="x">',
    '        <MessageSquare size={20} />',
    '        Your advisor will guide you through a quick setup.',
    '      </div>',
  ].join('\n');
  assert.ok(visibleText(src).includes('Your advisor will guide you through a quick setup.'));
  assert.ok(visibleText('<b>Your advisor is here</b>').includes('Your advisor is here'));
});

test('prose over several lines is read as one sentence, and text before an expression counts', () => {
  const src = '<p>\n  Keep chatting with the advisor\n  to sharpen every result.\n  {extra}\n</p>';
  assert.ok(visibleText(src).includes('Keep chatting with the advisor to sharpen every result.'));
});

test('code between a comparison and a later tag is not read as text', () => {
  // Code with spaces and a lexicon word, after a `>` that ends a line: only
  // the rule that text must be followed by a tag or an expression keeps it out.
  const src = 'const ok = count >\n  limit && other;\n  return advisor.name;\n}';
  assert.deepEqual(visibleText(src).filter((s) => /limit|advisor/.test(s)), []);
});

test('a className list is not prose; a sentence with a hyphenated word still is', () => {
  const found = visibleText('const a = "advisor-row advisor-row--open"; const b = "Book a follow-up with your advisor";');
  assert.ok(!found.includes('advisor-row advisor-row--open'));
  assert.ok(found.includes('Book a follow-up with your advisor'));
});

test('the Studio surfaces are on the scanned list, and every listed file exists', () => {
  const files = SURFACES.map(([, rel]) => rel);
  for (const rel of [
    'frontend/src/components/profile/ProfileFitSection.jsx',
    'frontend/src/pages/ArchetypeCardPage.jsx',
    'frontend/src/pages/founder/FounderStudioHome.jsx',
    'frontend/src/pages/investor/InvestorStudioHome.jsx',
    'frontend/src/pages/advisor/AdvisorStudioHome.jsx',
    'frontend/src/pages/partner/PartnerStudioHome.jsx',
    'frontend/src/pages/admin/AdminStudioHome.jsx',
  ]) assert.ok(files.includes(rel), `${rel} is scanned`);
  for (const rel of files) assert.ok(existsSync(`${root}${rel}`), `${rel} exists`);
});

test('the chat and the profile band name Eadwyn where they used to say "the advisor"', () => {
  const pa = codeOnly(read('frontend/src/components/advisor/PersonalAdvisor.jsx'));
  assert.match(pa, /Eadwyn will guide you through a quick setup/);
  const pfs = codeOnly(read('frontend/src/components/profile/ProfileFitSection.jsx'));
  assert.doesNotMatch(pfs, /\b(in|to|with) the advisor\b/i, 'the chat is Eadwyn, not an advisor');
  assert.match(codeOnly(read('frontend/src/components/advisor/AdvisorFilledBanner.jsx')), /Review with Eadwyn/);
  assert.match(codeOnly(read('frontend/src/pages/founder/FounderStudioHome.jsx')), /<span>Live interview<\/span>/);
});
