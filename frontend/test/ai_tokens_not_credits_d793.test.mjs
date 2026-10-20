// D793 (#2218) — AI tokens are never "credits", and Perks credits are never
// "AI tokens". AI tokens are a dollar balance spent on AI runs
// (`ai_credit_ledger`, D755); Perks credits are claimed for perks
// (`perk_credit_ledger`, D608/D638). They never share a balance, a ledger, a
// conversion or a screen line.
//
// What a person reads is every string literal, template part and JSX text in
// a file, read from its syntax tree (Vite's parser), so comments and code
// identifiers (`ai_credit_ledger`, `aiCredits.ts`, a state key `'credited'`)
// are not words on a screen. A lowercase string with no space is a key or a
// code, never a sentence, so it is skipped.
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/ai_tokens_not_credits_d793.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseAst } from 'vite';

const ROOT = new URL('../../', import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/** Where a person reads AI tokens: usage, the rail's Usage box, the cart and checkout for packs, HQ's packs and allowances, the Worker's pack sentences. */
export const TOKEN_SURFACES = [
  'frontend/src/pages/account/AccountUsage.jsx',
  'frontend/src/pages/account/usageModel.js',
  'frontend/src/lib/aiTokens.js',
  'frontend/src/ui/AiBudgetUsage.jsx',
  'frontend/src/ui/WorkerRail.jsx',
  'frontend/src/components/products/TokenPacksSection.jsx',
  'frontend/src/pages/ProductsPage.jsx',
  'frontend/src/pages/CheckoutPage.jsx',
  'frontend/src/pages/CheckoutConfirmationPage.jsx',
  'frontend/src/pages/hq/TokenPacks.jsx',
  'frontend/src/pages/hq/tokenPacksModel.js',
  'frontend/src/pages/hq/PlatformAllowancesPage.jsx',
  'frontend/src/pages/hq/HqAiCards.jsx',
  'frontend/src/pages/hq/hqAiModel.js',
  'cloudflare-worker/src/services/aiCredits.ts',
  'cloudflare-worker/src/services/aiTopups.ts',
  'cloudflare-worker/src/services/aiCreditReversals.ts',
];

/** Where a person reads Perks credits: Perks, and HQ's member credits and credit rules. */
export const PERK_SURFACES = [
  'frontend/src/pages/PerksPage.jsx',
  'frontend/src/lib/memberCredits.js',
  'frontend/src/pages/hq/MemberCreditsPage.jsx',
  'frontend/src/pages/hq/CreditRulesRegistryPage.jsx',
  'frontend/src/lib/creditRulesRegistry.js',
];

/**
 * The one line where both words meet, and it says they are not the same:
 * HQ's Credit rules page sends a reader looking for AI tokens to AI allowances
 * (D755). It is the separation, not a mix, so it is the only string let through.
 */
const SEPARATION_LINE = 'AI tokens are not perk credits. They are on AI allowances › Token packs.';

const isCode = (s) => /^[a-z0-9_.:/-]*$/.test(s);

/** Every string a person could read in `source`. */
export function visibleStrings(source, file) {
  const lang = /\.tsx?$/.test(file) ? (file.endsWith('x') ? 'tsx' : 'ts') : 'jsx';
  const out = [];
  const walk = (node, parent) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach((n) => walk(n, parent)); return; }
    if (node.type === 'ImportDeclaration' || node.type === 'ExportAllDeclaration') return;
    if (node.type === 'Literal' && typeof node.value === 'string' && !(parent?.type === 'ExportNamedDeclaration')) out.push(node.value);
    // A template reads as one sentence, its \${…} parts as "…", so `Added ${n} credits` is caught whole.
    if (node.type === 'TemplateLiteral') out.push(node.quasis.map((q) => q.value?.cooked ?? q.value?.raw ?? '').join('…'));
    if (node.type === 'JSXText') out.push(node.value);
    for (const [k, v] of Object.entries(node)) if (k !== 'type' && v && typeof v === 'object') walk(v, node);
  };
  walk(parseAst(source, { lang }));
  return out.map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => s && !isCode(s));
}

const sayingCredit = (strings) => strings.filter((s) => /\bcredit(?:s|ed|ing)?\b/i.test(s) && s !== SEPARATION_LINE);
const sayingTokens = (strings) => strings.filter((s) => /\bAI tokens?\b|\btoken balance\b|\bBuy tokens\b/i.test(s));

test('the reader: comments and identifiers are not words on a screen; prose is', () => {
  const src = `import { aiCredits } from './aiCredits';\n// credits, in a comment\nconst k = 'credited';\nconst a = <p title="Credited">Stripe's credit {x}</p>;\nconst t = \`Added \${n} credits\`;`;
  const seen = visibleStrings(src, 'x.jsx');
  assert.deepEqual(sayingCredit(seen), ['Credited', "Stripe's credit", 'Added … credits'], JSON.stringify(seen));
  assert.equal(sayingCredit(["Accredited investor", "ai_credit_ledger", "credited_at IS NULL"]).length, 0, 'accredited is not credit');
});

test('AI-token surfaces never say "credit"', () => {
  // Mutation checked: put 'Credited' back in tokenPacksModel.js's PURCHASE_STATE → this fails naming it.
  const found = TOKEN_SURFACES.flatMap((f) => sayingCredit(visibleStrings(read(f), f)).map((s) => `${f}: ${s}`));
  assert.deepEqual(found, [], `AI tokens are "AI tokens", never credits:\n${found.join('\n')}`);
});

test('Perks surfaces never say "AI tokens", "token balance" or "Buy tokens"', () => {
  const found = PERK_SURFACES.flatMap((f) => sayingTokens(visibleStrings(read(f), f)).map((s) => `${f}: ${s}`));
  assert.deepEqual(found, [], found.join('\n'));
  // The separation line is the only place both words meet, and it lives with the token packs.
  assert.ok(read('frontend/src/pages/hq/tokenPacksModel.js').includes(`'${SEPARATION_LINE}'`));
});

function workerSources(dir = join(ROOT, 'cloudflare-worker/src')) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? workerSources(p) : /\.ts$/.test(n) ? [p] : [];
  });
}

test('no Worker file reads both balances, so no route returns a figure mixing them', () => {
  const both = workerSources().filter((p) => {
    const s = readFileSync(p, 'utf8');
    return /\bai_credit_ledger\b/.test(s) && /\bperk_credit_ledger\b/.test(s);
  });
  assert.deepEqual(both.map((p) => p.slice(ROOT.length)), []);
  assert.ok(workerSources().some((p) => readFileSync(p, 'utf8').includes('ai_credit_ledger')), 'the AI ledger is read somewhere');
  assert.ok(workerSources().some((p) => readFileSync(p, 'utf8').includes('perk_credit_ledger')), 'and the Perks ledger elsewhere');
});

test('every listed surface exists', () => {
  for (const f of [...TOKEN_SURFACES, ...PERK_SURFACES]) assert.ok(statSync(join(ROOT, f)).isFile(), f);
});
