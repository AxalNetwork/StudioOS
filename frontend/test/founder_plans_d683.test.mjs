/**
 * D683 (#1574) — the founder plans are the four cycles in two groups (owner,
 * 2026-10-13): Validate + Build, and Raise + Grow, which keeps everything in
 * the first. The tier ids stay `growth` and `studio`.
 *
 * This pins:
 *   - the catalogue's names, prices and Free's lines;
 *   - the Worker quoting the same names and prices as the catalogue;
 *   - the Raise and Grow gates asking for `studio`, and the Validate and Build
 *     gates still asking for `growth`;
 *   - no old founder price ($79, $249) left anywhere in the source.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/founder_plans_d683.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = process.cwd();
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const W = (p) => read(`cloudflare-worker/src/${p}`);

const { TIER_PLANS } = await import('../src/components/PaywallModal.jsx');
const { FOUNDER_TIERS } = await import('../src/data/pricing.js');

test('the catalogue sells Free, Validate + Build, and Raise + Grow', () => {
  assert.deepEqual(FOUNDER_TIERS.map((t) => [t.id, t.name, t.priceMonthly]),
    [['free', 'Free', 0], ['growth', 'Validate + Build', 20], ['studio', 'Raise + Grow', 100]]);
  assert.equal(TIER_PLANS.studio.features[0], 'Everything in Validate + Build', 'the second group keeps the first');
  const free = FOUNDER_TIERS[0].features.join(' | ');
  for (const line of ['1 active startup', 'Start Validate', 'Apply to the Spin-Out Lab', 'Public profile', 'proposed introductions a month']) {
    assert.ok(free.includes(line), `Free includes "${line}"`);
  }
});

test('the Worker quotes the catalogue\'s names and prices', () => {
  const src = W('middleware/requireTier.ts');
  const table = (name) => {
    const m = new RegExp(`export const ${name}[^{]*\\{([^}]*)\\}`).exec(src);
    assert.ok(m, `${name} is exported`);
    return Object.fromEntries([...m[1].matchAll(/(growth|studio):\s*'([^']*)'/g)].map((x) => [x[1], x[2]]));
  };
  const names = table('PLAN_NAME');
  const prices = table('PLAN_PRICE_LABEL');
  for (const tier of ['growth', 'studio']) {
    assert.equal(names[tier], TIER_PLANS[tier].label, `${tier}: one name in the Worker and the catalogue`);
    assert.equal(prices[tier], `${TIER_PLANS[tier].price} / month`, `${tier}: one price in the Worker and the catalogue`);
  }
  assert.match(src, /plan: \{ tier: required, name: PLAN_NAME\[required\], price_label: PLAN_PRICE_LABEL\[required\] \}/,
    'a 402 names the plan');
  assert.match(W('routes/wellbeing.ts'), /plan: tierUpsell\('growth'\)\.plan/, 'wellbeing quotes the table, not a typed price');
});

test('Raise and Grow work asks for Raise + Grow; Validate and Build work for Validate + Build', () => {
  const decks = W('routes/decks.ts');
  for (const route of ["/generate'", "/positioning'", "/:id/share'"]) {
    const at = decks.indexOf(`decks.post('${route}`);
    assert.ok(at > 0, `decks ${route} exists`);
    assert.match(decks.slice(at, at + 400), /ensureTier\(await requireAuth\(c\), 'studio'\)/, `deck ${route} is Raise + Grow`);
  }
  assert.doesNotMatch(decks, /required_tier: 'growth'|tierCovers\(tier, 'growth'\)/, 'no deck path asks for growth');
  assert.doesNotMatch(W('services/decks/branding.ts'), /'growth'/, 'deck branding and premium methods are Raise + Grow');
  assert.doesNotMatch(read('frontend/src/decks/templates/index.ts'), /required_tier: 'growth'/, 'premium templates are Raise + Grow');
  for (const [file, what] of [['routes/captable.ts', 'cap-table writes'], ['routes/comarketing.ts', 'co-marketing'], ['routes/compliance.ts', 'compliance events']]) {
    const src = W(file);
    // An ensureTier call, its arguments allowed one level of nested call (`requireAuth(c)`).
    const gate = (tier) => new RegExp(`ensureTier\\((?:[^()]|\\([^()]*\\))*'${tier}'\\)`);
    assert.doesNotMatch(src, gate('growth'), `${what} no longer ask for growth`);
    assert.match(src, gate('studio'), `${what} ask for Raise + Grow`);
  }
  assert.match(W('routes/advisors.ts'), /ensureTier\(user, 'studio'\); \/\/ D683/, 'advisor booking is Raise + Grow');
  // Validate and Build keep the cheaper plan.
  assert.match(W('routes/projects.ts'), /!userMeetsTier\(user, 'growth'\)/, 'more startups: Validate + Build');
  assert.match(W('routes/progress.ts'), /ensureTier\(user, 'growth'\)/, 'interviews and OKRs past the free cap: Validate + Build');
  assert.match(W('routes/scoring.ts'), /ensureTier\(user, 'growth'\)/, 'scoring runs: Validate + Build');
});

test('no old founder price is left in the source', () => {
  const hits = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.(jsx?|tsx?)$/.test(name)) continue;
      const src = readFileSync(p, 'utf8');
      if (/\$79\b(?![,.\d])|\$249\b(?![,.\d])|79 \/ month|249 \/ month|79\/mo|249\/mo/.test(src)) hits.push(p);
    }
  };
  walk(resolve(ROOT, 'frontend/src'));
  walk(resolve(ROOT, 'cloudflare-worker/src'));
  assert.deepEqual(hits, [], 'the founder plans are $20 and $100 everywhere');
});
