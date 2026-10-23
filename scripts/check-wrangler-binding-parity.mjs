#!/usr/bin/env node
/**
 * Fails the build when a binding exists at wrangler.toml's top level but not
 * under `[env.production]`.
 *
 * Wrangler v2+ does NOT inherit binding tables into a named environment. The
 * root config says so itself, in a comment written after the incident it
 * caused:
 *
 *     "Every binding must be re-declared under `[env.production.*]` or the
 *      `--env production` deploy will produce a worker with NO bindings —
 *      which breaks every DB-touching route (login, /me, etc.) and is exactly
 *      why 2026-05-05 login outage happened."
 *
 * That comment is the whole argument for this file. It is the right thing to
 * write down and the wrong thing to rely on: a comment cannot fail a build,
 * and the next person adding a KV namespace has to read it first. Parity is
 * correct today — every one of the binding tables matches — so this guard
 * finds nothing. It exists so that stays true, and because the cost of it not
 * being true is a login outage rather than a warning.
 *
 * WHAT IT COMPARES, and why identity rather than presence. Comparing section
 * NAMES only would pass a `[[kv_namespaces]]` table that gained a second
 * namespace at the top level and not in production — the section is present in
 * both, and the new binding is missing from one. So each table is reduced to
 * the set of identities it declares, using the key that actually names the
 * binding for that table type. An unknown table type FAILS rather than being
 * silently skipped: a binding this file does not recognise is exactly the one
 * that would slip through.
 *
 * WHAT INHERITS, and is therefore excluded. The root config documents it:
 * compatibility_date, compatibility_flags, main, minify, workers_dev and
 * observability DO inherit and are not duplicated. `routes` and `rules` are
 * environment-specific by design. Everything else must appear in both.
 *
 * `[env.preview]` is NOT checked. It is missing `assets`, `tail_consumers` and
 * `vectorize` today, and whether preview is meant to serve the SPA at all is a
 * question for its owner rather than an assumption for a guard to make.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOML = path.join(ROOT, 'wrangler.toml');

/** Top-level keys the root config documents as inheriting into environments. */
const INHERITS = new Set([
  'observability', 'observability.logs', 'observability.traces',
]);

/** Environment-specific by design; parity is not expected. */
const PER_ENV = new Set(['routes', 'rules']);

/** The key that names the binding, per table type. */
const IDENTITY = {
  d1_databases: 'binding',
  kv_namespaces: 'binding',
  r2_buckets: 'binding',
  vectorize: 'binding',
  analytics_engine_datasets: 'binding',
  assets: 'binding',
  browser: 'binding',
  ai: 'binding',
  'queues.producers': 'binding',
  'queues.consumers': 'queue',
  'durable_objects.bindings': 'name',
  tail_consumers: 'service',
  migrations: 'tag',
  triggers: 'crons',
  hyperdrive: 'binding',
  send_email: 'name',
  mtls_certificates: 'binding',
  dispatch_namespaces: 'binding',
  services: 'binding',
  workflows: 'binding',
  secrets_store_secrets: 'binding',
};

/** wrangler.toml as a flat list of sections, each with its own key/value map. */
export function parseSections(src) {
  const out = [];
  let cur = null;
  for (const raw of src.split('\n')) {
    const line = raw.replace(/^\s+/, '');
    const header = /^\[\[?([A-Za-z0-9_.-]+)\]\]?\s*(?:#.*)?$/.exec(line);
    if (header) { cur = { name: header[1], kv: new Map() }; out.push(cur); continue; }
    if (!cur) continue;
    const kv = /^([A-Za-z0-9_-]+)\s*=\s*(.*)$/.exec(line);
    if (!kv) continue;
    // Strip a trailing comment only outside quotes — a value may contain '#'.
    const v = kv[2];
    let inS = false, inD = false, cut = v.length;
    for (let i = 0; i < v.length; i += 1) {
      if (v[i] === "'" && !inD) inS = !inS;
      else if (v[i] === '"' && !inS) inD = !inD;
      else if (v[i] === '#' && !inS && !inD) { cut = i; break; }
    }
    cur.kv.set(kv[1], v.slice(0, cut).trim());
  }
  return out;
}

/** table name -> set of binding identities, for one scope. */
export function bindings(sections, prefix) {
  const out = new Map();
  for (const s of sections) {
    let table;
    if (prefix === '') {
      if (s.name.startsWith('env.')) continue;
      table = s.name;
    } else {
      if (!s.name.startsWith(prefix)) continue;
      table = s.name.slice(prefix.length);
    }
    if (INHERITS.has(table) || PER_ENV.has(table)) continue;
    if (!out.has(table)) out.set(table, new Set());
    if (table === 'vars') {
      // A map, not a binding list: every NAME must exist in both.
      for (const k of s.kv.keys()) out.get(table).add(k);
      continue;
    }
    const key = IDENTITY[table];
    if (!key) { out.get(table).add('unknown-table-type'); continue; }
    out.get(table).add(s.kv.get(key) ?? 'missing-identity-key');
  }
  return out;
}

/** Bindings declared at the top level that `[env.production]` does not repeat. */
export function missingFromProduction() {
  const sections = parseSections(fs.readFileSync(TOML, 'utf8'));
  const top = bindings(sections, '');
  const prod = bindings(sections, 'env.production.');
  const gaps = [];
  for (const [table, ids] of top) {
    const there = prod.get(table);
    if (!there) {
      gaps.push({ table, missing: [...ids].sort(), reason: 'table absent under [env.production]' });
      continue;
    }
    const missing = [...ids].filter((i) => !there.has(i)).sort();
    if (missing.length) gaps.push({ table, missing, reason: 'declared at top level only' });
  }
  return gaps;
}

/** Tables whose type this file does not know how to identify. */
export function unknownTables() {
  const sections = parseSections(fs.readFileSync(TOML, 'utf8'));
  const seen = new Set();
  for (const s of sections) {
    const t = s.name.replace(/^env\.(production|preview)\./, '');
    if (t.startsWith('env.') || INHERITS.has(t) || PER_ENV.has(t) || t === 'vars') continue;
    if (!(t in IDENTITY)) seen.add(t);
  }
  return [...seen].sort();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const unknown = unknownTables();
  if (unknown.length) {
    console.error('check-wrangler-binding-parity: unrecognised binding table:\n');
    for (const t of unknown) console.error(`  [${t}]`);
    console.error('\nAdd it to IDENTITY in scripts/check-wrangler-binding-parity.mjs with the');
    console.error('key that names the binding, so parity can actually be compared. A table');
    console.error('this guard does not recognise is exactly the one that would slip through.');
    process.exit(1);
  }

  const gaps = missingFromProduction();
  if (gaps.length) {
    console.error('check-wrangler-binding-parity: a binding exists at the top level but');
    console.error('  not under [env.production]:\n');
    for (const g of gaps) {
      console.error(`  [${g.table}]  ${g.reason}`);
      for (const m of g.missing) console.error(`      ${m}`);
    }
    console.error('\nWrangler v2+ does not inherit binding tables into a named environment.');
    console.error('`npm run deploy` uses --env production, so a binding declared only at the');
    console.error('top level is absent from the deployed worker and every route using it');
    console.error('fails at runtime. Re-declare it under [env.production.*].');
    process.exit(1);
  }

  const sections = parseSections(fs.readFileSync(TOML, 'utf8'));
  const top = bindings(sections, '');
  const n = [...top.values()].reduce((a, s) => a + s.size, 0);
  console.log(
    `✓ check-wrangler-binding-parity: ${n} bindings across ${top.size} tables, `
    + `all re-declared under [env.production].`,
  );
}
