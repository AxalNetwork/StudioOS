#!/usr/bin/env node
/**
 * `schema_baseline.sql` still describes the database it was dumped from.
 *
 * WHY THIS EXISTS, AND WHY IT IS THE POINT OF THE WHOLE EXERCISE.
 * `cloudflare-worker/sql/schema.sql` was a production snapshot committed to the
 * repo with nothing asserting it stayed one. It drifted — someone edited five
 * `project_id` clauses to add an `ON DELETE CASCADE` that migration 039 never
 * applied — and a new database and production disagreed about five foreign keys
 * for four months with no test able to notice (DECISIONS D60).
 *
 * `schema_baseline.sql` replaced it and is EXACTLY THE SAME KIND OF ARTIFACT:
 * a production snapshot in the repo. Being freshly dumped makes it true today
 * and says nothing about tomorrow. The moment a migration lands on production,
 * the committed baseline is one migration behind, and the only thing that would
 * catch it is a test that runs the two side by side. That is this file.
 *
 * THE INVARIANT IS NOT "baseline == production". It is
 *
 *     baseline + every migration above the cutoff  ==  production
 *
 * and getting that wrong is the difference between a check that holds forever
 * and one that goes red the first time anyone ships a migration. A file that
 * demanded equality with production would fail on every schema change until
 * someone re-dumped it by hand, which is a chore nobody does twice — so it
 * would be switched off, and the drift it exists to catch would return. What is
 * checked here is the repo's whole schema story reproducing production, which
 * is exactly the property that was false for four months.
 *
 * WHAT IT COMPARES, and why by NAME rather than by count. The first gate anyone
 * wrote for the baseline was "the built database has 399 tables". A dump missing
 * two real tables while gaining back two that the engine creates on its own
 * still reports 399. So this builds the story for real, in the same SQLite
 * engine D1 is, and takes the set difference of object NAMES in both directions.
 *
 * WHERE IT RUNS: the deploy workflow, AFTER the deploy step. A disagreement
 * here means the repo can no longer rebuild the database it operates — worth a
 * red workflow — but it does not make the worker that just shipped unsafe, so
 * it must not stand between a good build and production. Running it after the
 * deploy gets the alarm without holding the release, and it is not
 * `continue-on-error`: GOTCHAS already records what that does to the Semgrep
 * job, where a green check means only that the scan ran.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BASELINE_CUTOFF, migrationNumber } from './lib/migrationPlan.mjs';

const BASELINE = 'cloudflare-worker/sql/schema_baseline.sql';
const MIGRATIONS = 'cloudflare-worker/sql/migrations';

/**
 * Names D1 owns, on either side, in any environment.
 *
 * `_cf_KV` is Cloudflare's; local workerd refuses to let a file create it
 * (SQLITE_AUTH) and makes it itself, so it is present on production and absent
 * from any dump. `sqlite_%` covers `sqlite_sequence`, which SQLite creates the
 * moment an AUTOINCREMENT table exists, and `sqlite_autoindex_%`, which it
 * creates per UNIQUE constraint. None is anybody's schema and none belongs in a
 * comparison of one.
 */
const ENGINE_OWNED = /^(_cf_[A-Z]|sqlite_)/;

/**
 * Every object name the repo's schema story creates, by building it.
 *
 * `later` is the post-cutoff migrations, applied in order on top of the
 * baseline — the same set `migrations_fresh_build.test.ts` builds, and the
 * reason this stays true as migrations land instead of going stale on the
 * first one.
 */
export function baselineObjects(sql, later = []) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(sql);
  for (const migration of later) db.exec(migration);
  const rows = db.prepare(
    "SELECT type, name FROM sqlite_master WHERE type IN ('table','index','trigger','view')",
  ).all();
  return new Set(
    rows.filter((r) => !ENGINE_OWNED.test(r.name)).map((r) => `${r.type}:${r.name}`),
  );
}

/**
 * The two-way difference, as the message a reader needs.
 *
 * Pure and exported so the drift suite can exercise it without a network or a
 * Cloudflare token — the guard's own logic is the part most worth testing, and
 * a checker nothing tests rots into a vacuous pass.
 */
export function compareObjects(baseline, live) {
  // FILTERS HERE TOO, not only in the two readers above. Both of them already
  // drop engine-owned names, so this is redundant on the real path — and that
  // is the point: it makes the exported decision correct on its own rather than
  // correct only while every caller remembers. A guard whose safety depends on
  // its callers is the shape that fails when a third caller arrives.
  const clean = (s) => new Set([...s].filter((n) => !ENGINE_OWNED.test(n.replace(/^\w+:/, ''))));
  const b = clean(baseline);
  const l = clean(live);
  const missing = [...l].filter((n) => !b.has(n)).sort();
  const extra = [...b].filter((n) => !l.has(n)).sort();
  return { missing, extra, ok: missing.length === 0 && extra.length === 0 };
}

/** Pull the object names out of whatever shape `wrangler --json` returned. */
export function rowsFromWranglerJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`wrangler did not return JSON:\n${String(text).slice(0, 400)}`);
  }
  // wrangler has emitted both `[{results:[…]}]` and `{result:[{results:[…]}]}`
  // across versions, and an `{error:{text}}` object when it cannot authenticate.
  if (parsed?.error) throw new Error(parsed.error.text || JSON.stringify(parsed.error));
  const rows = (Array.isArray(parsed) ? parsed[0]?.results : parsed?.result?.[0]?.results);
  if (!Array.isArray(rows)) {
    throw new Error(`wrangler returned no result set:\n${String(text).slice(0, 400)}`);
  }
  return rows;
}

function liveObjects() {
  let out;
  try {
    out = execFileSync('npx', [
      '--no-install', 'wrangler', 'd1', 'execute', 'studioos-db',
      '--config', '../wrangler.toml', '--remote', '--json',
      '--command',
      "SELECT type, name FROM sqlite_master WHERE type IN ('table','index','trigger','view')",
    ], { cwd: resolve(process.cwd(), 'cloudflare-worker'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    // The token is the usual cause and the stack trace buries it. A guard that
    // dies unreadably is a guard people learn to skip.
    const detail = (error?.stdout || '') + (error?.stderr || '') || String(error?.message || error);
    console.error(
      '✖ check-baseline-drift: could not read production.\n' +
      '  This step needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID; the deploy\n' +
      '  workflow supplies both. It cannot run from a checkout without them.\n\n' +
      `  wrangler said:\n${detail.split('\n').filter(Boolean).slice(-6).map((l) => `    ${l}`).join('\n')}`,
    );
    process.exit(2);
  }
  const rows = rowsFromWranglerJson(out);
  return new Set(
    rows.filter((r) => !ENGINE_OWNED.test(r.name)).map((r) => `${r.type}:${r.name}`),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const later = readdirSync(resolve(process.cwd(), MIGRATIONS))
    .filter((n) => /^\d+_.*\.sql$/.test(n) && migrationNumber(n) > BASELINE_CUTOFF)
    .sort()
    .map((n) => readFileSync(resolve(process.cwd(), MIGRATIONS, n), 'utf8'));
  const baseline = baselineObjects(readFileSync(resolve(process.cwd(), BASELINE), 'utf8'), later);
  const live = liveObjects();
  const { missing, extra, ok } = compareObjects(baseline, live);

  if (!ok) {
    console.error('✖ check-baseline-drift: the committed baseline no longer matches production.');
    if (missing.length) {
      console.error(`\n  On production, absent from ${BASELINE} (${missing.length}):`);
      for (const n of missing.slice(0, 40)) console.error(`    ${n}`);
      if (missing.length > 40) console.error(`    … and ${missing.length - 40} more`);
    }
    if (extra.length) {
      console.error(`\n  In ${BASELINE}, absent from production (${extra.length}):`);
      for (const n of extra.slice(0, 40)) console.error(`    ${n}`);
      if (extra.length > 40) console.error(`    … and ${extra.length - 40} more`);
    }
    console.error(
      '\nTHE DEPLOYED WORKER AND THE DATABASE ARE FINE. What has broken is the\n' +
      "repo's ability to rebuild the schema it operates: a new environment would\n" +
      'not come up matching production. Usual causes, in order of likelihood:\n' +
      '  · something was applied to production by hand and never written down;\n' +
      '  · a migration above the cutoff does not do what production shows;\n' +
      "  · schema_baseline.sql was edited rather than re-dumped (that is exactly\n" +
      '    how schema.sql came to promise five cascades that never existed).\n' +
      'Re-dump the baseline the way its own header describes, or add the missing\n' +
      'migration — whichever the difference above says is actually true.',
    );
    process.exit(1);
  }

  console.log(
    `✓ check-baseline-drift: baseline + ${later.length} post-cutoff migration(s) `
    + `reproduces production exactly (${baseline.size} objects, engine-owned names `
    + 'excluded on both sides).',
  );
}
