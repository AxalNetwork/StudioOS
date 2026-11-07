#!/usr/bin/env node
/**
 * #4570 (S1 of #4554) — the authorization inventory of the production Worker.
 *
 *   node scripts/build-auth-inventory.mjs           writes documentation/architecture/AUTH_INVENTORY.json:
 *                                                   every route with its family, file, line, gate,
 *                                                   ownership evidence, whether it writes, and why
 *                                                   it needs review (null when it does not)
 *   node scripts/build-auth-inventory.mjs --check   the guard (in `npm run test:guards`)
 *   node scripts/build-auth-inventory.mjs --seed    adds every route that needs review and has no
 *                                                   ledger entry, as `unreviewed` (the first baseline)
 *
 * The reading rules are scripts/lib/authInventory.mjs. The JSON is build
 * output, never committed (.gitignore), like the route map's projections.
 *
 * THE LEDGER, scripts/auth-inventory-ledger.json. Unknown authorization is
 * review required: every route the reader cannot place behind an identity
 * gate with ownership evidence has an entry, keyed `METHOD path`, with
 *   review  the reason the reader gives (no_gate_found, forwarded, optional_auth,
 *           record_without_ownership_check)
 *   kind    what the route looks like (sign_in, link_token, webhook, oauth_callback,
 *           websocket, public_content, alias, unclassified): a hint, not a verdict
 *   state   unreviewed — a person has not looked yet;
 *           public_by_design — looked at: it is meant to answer without a sign-in (`note` says why);
 *           verified — looked at: its gate is real and a test proves it (`test` names the file)
 * An entry stays while the reader still flags the route: the ledger is the
 * record of what was looked at and why it is fine, not a way to hide a route.
 *
 * --check fails on:
 *   - a route that needs review and has no entry (a new unknown, again);
 *   - an entry for a route that no longer exists, or no longer needs review, or
 *     whose reason changed (the ledger outliving what it vouched for);
 *   - an entry with an unknown state or kind, a public_by_design one with no
 *     note, or a verified one with no test file that exists;
 *   - a registered mount that resolves to no route at all.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inventory } from './lib/authInventory.mjs';
import { registeredMounts } from './lib/routeRegistry.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = join(ROOT, 'scripts', 'auth-inventory-ledger.json');
const OUT = join(ROOT, 'documentation', 'architecture', 'AUTH_INVENTORY.json');

export const STATES = ['unreviewed', 'public_by_design', 'verified'];
export const KINDS = ['sign_in', 'link_token', 'webhook', 'oauth_callback', 'websocket', 'public_content', 'alias', 'unclassified'];

/** What a route that needs review looks like, from its path: a hint for the reviewer. */
export function kindOf(row) {
  const p = row.path;
  if (row.review === 'forwarded') return 'alias';
  if (/\/webhook\b|\/webhooks?\//.test(p)) return 'webhook';
  if (/\/callback\b/.test(p)) return 'oauth_callback';
  if (/\/ws\b|\/ws\/|\/room\//.test(p)) return 'websocket';
  if (/^\/api\/auth\b/.test(p)) return 'sign_in';
  if (/:token\b|\/unsubscribe\b|\/invitations\/(accept|preview)|\/email-change\/(confirm|revoke)|\/proof-consents\//.test(p)) return 'link_token';
  if (/^\/api\/(public|articles|legal|brand|news|market-intel-public|references|health|track|client-error|contact|newsletter)\b|\.csv$|\/taxonomy$|\/tiers$|\/config$/.test(p)) return 'public_content';
  return 'unclassified';
}

/** Everything wrong with `ledger` against `rows` and the mounts; empty when sound. */
export function ledgerProblems(rows, ledger, { root = ROOT, mounts = [] } = {}) {
  const problems = [];
  const entries = ledger?.routes ?? {};
  const byKey = new Map(rows.map((r) => [`${r.method} ${r.path}`, r]));
  for (const r of rows) {
    if (!r.review) continue;
    const key = `${r.method} ${r.path}`;
    if (!entries[key]) problems.push(`${key} — ${r.review} (${r.file}:${r.line}): no ledger entry. Put it behind a gate, or add it to scripts/auth-inventory-ledger.json as unreviewed.`);
  }
  for (const [key, e] of Object.entries(entries)) {
    const r = byKey.get(key);
    if (!r) { problems.push(`${key} — the ledger names a route the Worker no longer serves. Remove the entry.`); continue; }
    if (!r.review) { problems.push(`${key} — the route now reads as gated (${r.gate}); remove its ledger entry.`); continue; }
    if (e.review !== r.review) problems.push(`${key} — the ledger says ${e.review}, the reader says ${r.review}. Look again and update the entry.`);
    if (!STATES.includes(e.state)) problems.push(`${key} — state must be one of ${STATES.join(', ')}.`);
    if (!KINDS.includes(e.kind)) problems.push(`${key} — kind must be one of ${KINDS.join(', ')}.`);
    if (e.state === 'public_by_design' && !(typeof e.note === 'string' && e.note.trim().length >= 10)) problems.push(`${key} — public_by_design needs a note saying why it answers without a sign-in.`);
    if (e.state === 'verified' && !(typeof e.test === 'string' && existsSync(join(root, e.test)))) problems.push(`${key} — verified needs \`test\`, a test file that exists.`);
  }
  for (const m of mounts) {
    if (!rows.some((r) => r.path === m.path || r.path.startsWith(`${m.path}/`))) problems.push(`${m.path} (${m.file}) — the mount resolves to no route; the reader cannot see its gates.`);
  }
  return problems;
}

function readLedger() {
  try { return JSON.parse(readFileSync(LEDGER, 'utf8')); } catch { return { routes: {} }; }
}

function main() {
  const args = new Set(process.argv.slice(2));
  const ledger = readLedger();
  const rows = inventory(ROOT);
  if (args.has('--seed')) {
    const routes = { ...(ledger.routes ?? {}) };
    let added = 0;
    for (const r of rows) {
      const key = `${r.method} ${r.path}`;
      if (!r.review || routes[key]) continue;
      routes[key] = { review: r.review, kind: kindOf(r), state: 'unreviewed' };
      added += 1;
    }
    const sorted = Object.fromEntries(Object.entries(routes).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(LEDGER, `${JSON.stringify({ ...ledger, routes: sorted }, null, 2)}\n`);
    console.log(`auth inventory: ${added} entr${added === 1 ? 'y' : 'ies'} added to the ledger as unreviewed.`);
    return;
  }
  if (args.has('--check')) {
    const mounts = registeredMounts(ROOT);
    const problems = ledgerProblems(rows, ledger, { mounts });
    const review = rows.filter((r) => r.review).length;
    const states = Object.values(ledger.routes ?? {}).reduce((a, e) => ({ ...a, [e.state]: (a[e.state] ?? 0) + 1 }), {});
    if (problems.length) {
      console.error(`✖ auth inventory (#4570): ${problems.length} problem${problems.length === 1 ? '' : 's'}`);
      for (const p of problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log(`✓ auth inventory: ${rows.length} routes in ${new Set(rows.map((r) => r.family)).size} families; ${review} need review, each ledgered (${Object.entries(states).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'}).`);
    return;
  }
  mkdirSync(dirname(OUT), { recursive: true });
  const entries = ledger.routes ?? {};
  const out = rows.map((r) => ({ ...r, ledger: entries[`${r.method} ${r.path}`] ?? null }));
  writeFileSync(OUT, `${JSON.stringify({ generated_from: 'scripts/build-auth-inventory.mjs', routes: out }, null, 1)}\n`);
  console.log(`auth inventory: ${out.length} routes written to ${OUT.slice(ROOT.length + 1)}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
