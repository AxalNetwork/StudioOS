/**
 * D683 (#1574) — the founder plans are the four cycles in two groups (owner,
 * 2026-10-13): Validate + Build, and Raise + Grow, which keeps everything in
 * the first. The tier ids stay `growth` and `studio`.
 *
 * This pins:
 *   - the catalogue's names and Free's lines (D1050: no price is typed; a
 *     paid tier is priced from the plans read);
 *   - the Worker quoting the same names as the catalogue, and no price;
 *   - the Raise and Grow gates asking for `studio`, and the Validate and Build
 *     gates still asking for `growth`;
 *   - no old founder price ($79, $249) left anywhere in the source.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/founder_plans_d683.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = process.cwd();
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const W = (p) => read(`cloudflare-worker/src/${p}`);

const { TIER_PLANS } = await import('../src/components/PaywallModal.jsx');
const { FOUNDER_TIERS } = await import('../src/data/pricing.js');

test('the catalogue sells Free, Validate + Build, and Raise + Grow', () => {
  assert.deepEqual(FOUNDER_TIERS.map((t) => [t.id, t.name, t.priceMonthly]),
    [['free', 'Free', 0], ['growth', 'Validate + Build', null], ['studio', 'Raise + Grow', null]],
    'D1050: a paid tier carries no typed price until the plans read prices it');
  assert.equal(TIER_PLANS.studio.lead, 'Everything in Validate + Build, plus:', 'the second group keeps the first');
  const free = FOUNDER_TIERS[0].features.join(' | ');
  for (const line of ['1 active startup', 'Start Validate', 'Apply to the Spin-Out Lab', 'Public profile', 'proposed introductions a month']) {
    assert.ok(free.includes(line), `Free includes "${line}"`);
  }
});

test('the Worker quotes the catalogue\'s names, and no price', async () => {
  const src = W('middleware/requireTier.ts');
  const { planByKey } = await import('../../cloudflare-worker/src/services/planCatalogue.ts');
  // D1050: the names are the plan catalogue's, and the Worker types no price.
  assert.match(src, /growth: planByKey\('founder:growth'\)!\.name,\n  studio: planByKey\('founder:studio'\)!\.name,/);
  for (const tier of ['growth', 'studio']) {
    assert.equal(planByKey(TIER_PLANS[tier].key).name, TIER_PLANS[tier].label, `${tier}: one name in the Worker and the catalogue`);
  }
  assert.doesNotMatch(src, /PLAN_PRICE_LABEL|\$\d/, 'no typed price in the Worker');
  assert.match(src, /plan: \{ tier: required, name: PLAN_NAME\[required\], plan_key: PLAN_KEY\[required\] \}/,
    'a 402 names the plan by its catalogue key');
  assert.match(W('routes/wellbeing.ts'), /plan: tierUpsell\('growth'\)\.plan/, 'wellbeing quotes the table, not a typed price');
});

test('Raise and Grow work asks for Raise + Grow; Validate and Build work for Validate + Build', () => {
  const decks = W('routes/decks.ts');
  // D897 (#2677): /generate moved to deck_new.ts with /outline; both pass the same Raise + Grow gate first.
  const fresh = W('routes/deck_new.ts');
  assert.match(fresh, /function planRefusal\(user: User\): Response \| null \{\n  try \{ ensureTier\(user, 'studio'\); return null; \}/, 'New deck is Raise + Grow');
  for (const route of ["/generate'", "/outline'"]) {
    const at = fresh.indexOf(`deckNew.post('${route}`);
    assert.ok(at > 0, `deck_new ${route} exists`);
    assert.match(fresh.slice(at, at + 200), /const plan = planRefusal\(user\);\n  if \(plan\) return plan;/, `deck ${route} is Raise + Grow`);
  }
  assert.doesNotMatch(fresh, /'growth'/, 'no New deck path asks for growth');
  for (const route of ["/positioning'", "/:id/share'"]) {
    const at = decks.indexOf(`decks.post('${route}`);
    assert.ok(at > 0, `decks ${route} exists`);
    assert.match(decks.slice(at, at + 400), /ensureTier\(await requireAuth\(c\), 'studio'\)/, `deck ${route} is Raise + Grow`);
  }
  assert.doesNotMatch(decks, /required_tier: 'growth'|tierCovers\(tier, 'growth'\)/, 'no deck path asks for growth');
  assert.doesNotMatch(W('services/decks/branding.ts'), /'growth'/, 'deck branding and premium methods are Raise + Grow');
  assert.doesNotMatch(read('frontend/src/decks/templates/index.ts'), /required_tier: 'growth'/, 'premium templates are Raise + Grow');
  // An ensureTier call for each tier, its arguments allowed one level of nested
  // call (`requireAuth(c)`).
  const GATE = {
    growth: /ensureTier\((?:[^()]|\([^()]*\))*'growth'\)/,
    studio: /ensureTier\((?:[^()]|\([^()]*\))*'studio'\)/,
  };
  for (const [file, what] of [['routes/captable.ts', 'cap-table writes'], ['routes/comarketing.ts', 'co-marketing'], ['routes/compliance.ts', 'compliance events']]) {
    const src = W(file);
    assert.doesNotMatch(src, GATE.growth, `${what} no longer ask for growth`);
    assert.match(src, GATE.studio, `${what} ask for Raise + Grow`);
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
    // The entry's own type from the listing: no separate stat of the path
    // before it is read.
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) { walk(p); continue; }
      if (!/\.(jsx?|tsx?)$/.test(entry.name)) continue;
      const src = readFileSync(p, 'utf8');
      if (/\$79\b(?![,.\d])|\$249\b(?![,.\d])|79 \/ month|249 \/ month|79\/mo|249\/mo/.test(src)) hits.push(p);
    }
  };
  walk(resolve(ROOT, 'frontend/src'));
  walk(resolve(ROOT, 'cloudflare-worker/src'));
  assert.deepEqual(hits, [], 'the founder plans are $20 and $100 everywhere');
});
