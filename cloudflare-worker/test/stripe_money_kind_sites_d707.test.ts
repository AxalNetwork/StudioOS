/**
 * D707 (#1772) — a source scan of `cloudflare-worker/src`: every Stripe create
 * names its money kind, every `metadata[kind]` value has one, and nothing but
 * `stripeCall` posts to the Stripe API.
 *
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/stripe_money_kind_sites_d707.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { STRIPE_CREATE_PATHS, stripePathOf } from '../src/routes/billing.ts';
import { MONEY_KIND_FOR_STRIPE_METADATA } from '../src/services/moneyRails.ts';

const SRC = resolve(process.cwd(), 'cloudflare-worker/src');
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? walk(p) : /\.ts$/.test(n) ? [p] : [];
});
/** The Stripe API's host, searched for in source text (not a URL check). */
const STRIPE_API_TEXT = ['api', 'stripe', 'com'].join('.');
/** The name a line declares with `const` or `let`, if any. */
const declared = (line: string) => /\b(?:const|let)\s+([A-Za-z_$][\w$]*)/.exec(line)?.[1] ?? null;
const FILES = walk(SRC).map((p) => ({ rel: relative(SRC, p).split('\\').join('/'), src: readFileSync(p, 'utf8') }));

type Call = { file: string; line: number; text: string; path: string | null; method: string; moneyKind: boolean; body: string };

/** Each `stripeCall(...)` call, with its arguments split at the top level. */
function stripeCalls(): Call[] {
  const out: Call[] = [];
  for (const { rel, src } of FILES) {
    const re = /\bstripeCall(?:<[^(]*?>)?\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      if (/function\s+$/.test(src.slice(Math.max(0, m.index - 20), m.index))) continue; // the definition
      let depth = 1; let i = m.index + m[0].length; const start = i;
      const args: string[] = []; let argStart = i; let quote: string | null = null;
      for (; i < src.length && depth > 0; i += 1) {
        const ch = src[i];
        if (quote) { if (ch === '\\') { i += 1; continue; } if (ch === quote) quote = null; continue; }
        // A comment's apostrophe ("invoice's") is not a quote.
        if (ch === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); continue; }
        if (ch === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
        if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; continue; }
        if ('([{'.includes(ch)) depth += 1;
        else if (')]}'.includes(ch)) { depth -= 1; if (depth === 0) break; }
        else if (ch === ',' && depth === 1) { args.push(src.slice(argStart, i).trim()); argStart = i + 1; }
      }
      args.push(src.slice(argStart, i).trim());
      const text = src.slice(start, i);
      // The whole literal, `${…}` included: `/subscriptions/${id}` is an update, not a create.
      const lit = /^(['`])((?:\\.|(?!\1)[\s\S])*)\1$/.exec(args[1] ?? '');
      const opts = args[3] ?? '';
      const method = /method:\s*'(GET|DELETE|POST)'/.exec(opts)?.[1] ?? 'POST';
      out.push({ file: rel, line: src.slice(0, m.index).split('\n').length, text, path: lit ? lit[2] : null, method,
        moneyKind: /\bmoneyKind\b/.test(opts), body: args[2] ?? '' });
    }
  }
  return out;
}
const CALLS = stripeCalls();
const isCreate = (c: Call) => c.method === 'POST' && c.path !== null && (STRIPE_CREATE_PATHS as readonly string[]).includes(stripePathOf(c.path));

test('every stripeCall that POSTs to a create path names its money kind, and there are exactly the thirteen', () => {
  const creates = CALLS.filter(isCreate);
  assert.deepEqual(creates.map((c) => `${c.file} ${stripePathOf(c.path!)}`).sort(), [
    'routes/billing.ts /checkout/sessions', 'routes/billing.ts /checkout/sessions', 'routes/billing.ts /checkout/sessions',
    'routes/billing.ts /subscriptions',
    'routes/legal.ts /checkout/sessions', 'routes/legal.ts /invoiceitems', 'routes/legal.ts /invoices',
    'routes/orders.ts /payment_intents',
    'routes/payments.ts /payment_intents', 'routes/payments.ts /subscriptions',
    'services/advisorConnect.ts /payment_intents', 'services/eventTickets.ts /payment_intents',
    'services/wellbeing/bookings.ts /payment_intents',
  ]);
  for (const c of creates) assert.ok(c.moneyKind, `${c.file}:${c.line} creates ${c.path} with no moneyKind`);
  // A POST's path is a literal, so no create can hide behind a variable; only reads build theirs.
  assert.deepEqual(CALLS.filter((c) => c.path === null && c.method === 'POST').map((c) => `${c.file}:${c.line}`), [], 'a POST whose path is not a literal');
});

test('every stripeCall whose body writes metadata[kind] passes a moneyKind', () => {
  const writesKind = (c: Call) => {
    if (c.body.includes("'metadata[kind]'")) return true;
    const id = /^[A-Za-z_$][\w$]*$/.exec(c.body)?.[0];
    if (!id) return false;
    // From the body variable's own declaration up to the call.
    const lines = FILES.find((f) => f.rel === c.file)!.src.split('\n').slice(0, c.line);
    let from = -1;
    for (let k = lines.length - 1; k >= Math.max(0, lines.length - 120); k -= 1) {
      if (declared(lines[k]) === id) { from = k; break; }
    }
    return from >= 0 && lines.slice(from).join('\n').includes("'metadata[kind]'");
  };
  const writers = CALLS.filter(writesKind);
  assert.deepEqual(writers.map((c) => `${c.file} ${c.path}`).sort(), [
    'routes/billing.ts /checkout/sessions', 'routes/billing.ts /checkout/sessions', 'routes/billing.ts /checkout/sessions',
    'routes/billing.ts /subscriptions', 'routes/billing.ts /subscriptions/${subId}',
    'routes/legal.ts /checkout/sessions', 'routes/legal.ts /invoices', 'routes/legal.ts /payment_intents/${piId}',
    'routes/orders.ts /payment_intents', 'services/advisorConnect.ts /payment_intents', 'services/eventTickets.ts /payment_intents',
    'services/wellbeing/bookings.ts /payment_intents',
  ], 'the two re-stamping updates included');
  for (const c of writers) assert.ok(c.moneyKind, `${c.file}:${c.line} writes metadata[kind] with no moneyKind`);
});

test('every metadata[kind] value is a key of MONEY_KIND_FOR_STRIPE_METADATA, in all three forms', () => {
  const keys = new Set(Object.keys(MONEY_KIND_FOR_STRIPE_METADATA));
  const seen = new Set<string>();
  for (const { rel, src } of FILES) {
    if (rel === 'services/moneyRails.ts') continue;
    for (const m of src.matchAll(/'(?:subscription_data\[metadata\]|metadata)\[kind\]'\s*[:=]\s*'([^']+)'/g)) seen.add(`${rel} ${m[1]}`);
    for (const m of src.matchAll(/params\['metadata\[kind\]'\]\s*=\s*'([^']+)'/g)) seen.add(`${rel} ${m[1]}`);
    for (const m of src.matchAll(/metadata(?::\s*Record<string, string>)?\s*=\s*\{[^}]*?\bkind:\s*'([^']+)'/gs)) seen.add(`${rel} ${m[1]}`);
    for (const m of src.matchAll(/metadata:\s*\{\s*kind:\s*'([^']+)'/g)) seen.add(`${rel} ${m[1]}`);
  }
  const values = [...seen].map((s) => s.split(' ')[1]);
  for (const v of values) assert.ok(keys.has(v), `metadata[kind] '${v}' has no money kind`);
  for (const k of ['mi', 'tier', 'investor', 'plan', 'alacarte', 'intro_credits', 'incorporation', 'cart_order', 'event_ticket', 'expert_booking', 'advisor_session']) {
    assert.ok(values.includes(k), `the scan no longer sees '${k}'`);
  }
});

test('only five files name api.stripe.com, and outside billing.ts none POSTs there', () => {
  const naming = FILES.filter((f) => f.src.split(STRIPE_API_TEXT).length > 1).map((f) => f.rel).sort();
  assert.deepEqual(naming, ['integrations/providers/stripe.ts', 'middleware/securityHeaders.ts', 'routes/billing.ts',
    'routes/wellbeing.ts', 'services/providerOauthTest.ts']);
  for (const rel of naming.filter((r) => r !== 'routes/billing.ts')) {
    const src = FILES.find((f) => f.rel === rel)!.src;
    for (const m of src.matchAll(/fetch\([^;]*?api\.stripe\.com[\s\S]{0,400}?\)/g)) {
      assert.doesNotMatch(m[0], /method:\s*'POST'/, `${rel} POSTs to api.stripe.com`);
    }
    if (rel === 'integrations/providers/stripe.ts') {
      // The founder connector's POSTs go to connect.stripe.com; its API calls are reads.
      assert.doesNotMatch(src.replace(/\/\/.*$/gm, ''), /STRIPE_API[^;\n]*[\s\S]{0,300}?method:\s*'POST'/, 'the connector POSTs to the Stripe API');
    }
  }
});
