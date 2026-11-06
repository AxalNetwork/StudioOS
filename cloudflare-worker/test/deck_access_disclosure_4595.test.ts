/** D4595 (#4595) — one deck access gate and one disclosure contract. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_SHARE_INCLUDE, shareSlides } from '../src/services/decks/shareInclude.ts';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('every managed deck route delegates project access to the authoritative deck gate', () => {
  const dir = resolve(process.cwd(), 'cloudflare-worker/src/routes');
  const files = readdirSync(dir).filter((name) => /^deck(?:s|_.*)\.ts$/.test(name));
  for (const name of files) {
    const src = read(`cloudflare-worker/src/routes/${name}`);
    assert.doesNotMatch(src, /middleware\/projectContentAccess/, `${name} bypasses the deck role matrix`);
    if (!/await projectOwned\(/.test(src)) continue;
    assert.match(src, /(?:services\/decks\/access|from '\.\/decks')/, `${name} does not use the deck access contract`);
  }
  const access = read('cloudflare-worker/src/services/decks/access.ts');
  assert.doesNotMatch(access, /false\s*&&\s*opts\.write/, 'support-write refusal cannot be disabled');
  assert.match(access, /opts\.write && await isSupportSession\(c\).*SupportSessionRefused/, 'support writes fail before stored state changes');
  assert.match(access, /deck_write_authorized/, 'Super Admin writes retain actor audit');
});

test('template-resolved fields obey quote, figures, cap-table and internal-data exclusions', () => {
  const slide = { title: 'Synthetic', fields: [
    { key: 'cover_headline', kind: 'paragraph', value: 'Frozen headline' },
    { key: 'validation_quote1_takeaway', kind: 'paragraph', value: 'No consent' },
    { key: 'validation_quote2_takeaway', kind: 'paragraph', value: 'Consented', consent: true },
    { key: 'market_tam', kind: 'paragraph', value: '$5m' },
    { key: 'ask_raise_amount', kind: 'paragraph', value: '$1m' },
    { key: 'ct_holders', kind: 'metric_grid', value: [{ label: 'Founder', value: '80%' }] },
    { key: 'vr_total_score', kind: 'paragraph', value: '91' },
    { key: 'bank_balance', kind: 'paragraph', value: '$9m' },
  ] };
  const restricted = shareSlides([slide], { ...DEFAULT_SHARE_INCLUDE, figures: false, cap_table: false });
  assert.deepEqual(restricted[0].fields.map((f: any) => f.key), ['cover_headline', 'validation_quote2_takeaway']);
  const figures = shareSlides([slide], { ...DEFAULT_SHARE_INCLUDE, figures: true, cap_table: false });
  assert.deepEqual(figures[0].fields.map((f: any) => f.key), [
    'cover_headline', 'validation_quote2_takeaway', 'market_tam', 'ask_raise_amount',
  ]);
  const full = shareSlides([slide], { ...DEFAULT_SHARE_INCLUDE, figures: true, cap_table: true });
  assert.ok(full[0].fields.some((f: any) => f.key === 'ct_holders'));
  assert.ok(!JSON.stringify(full).includes('No consent'));
  assert.ok(!JSON.stringify(full).includes('91'));
  assert.ok(!JSON.stringify(full).includes('$9m'));
});

test('all render modes use fields from the selected saved version', () => {
  const worker = read('cloudflare-worker/src/routes/decks.ts');
  const page = read('frontend/src/pages/PitchDeckPrintPage.jsx');
  assert.match(worker, /return deckFieldsByKey\(rowToDeck\(row\)\.slides \|\| \[\]\)/);
  assert.doesNotMatch(worker, /assembleSpinoutDeckData|loadSpinoutDeckOverrides/);
  assert.doesNotMatch(page, /api\.spinoutDeck\(/);
  assert.match(page, /setSpinoutFields\(deck\?\.spinout_fields \|\| null\)/);
});
