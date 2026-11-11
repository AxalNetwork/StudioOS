#!/usr/bin/env node
/**
 * #4532 — the skill library's CI gate. Fails (exit 1) on any error, with one
 * line per finding: file, slug, field or case, the rule and what to do.
 *
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs scripts/check-skill-library.mjs
 *       [--json <path>]        also write the machine-readable summary there
 *       [--persisted <path>]   reconcile with a persisted manifest: a JSON array that
 *                              `persistedManifest()` produced from a local or test D1,
 *                              or the JSON of the read-only preflight
 *                              GET /api/admin/ai-agents/skills/library/reconcile
 *                              (D5335; its `manifest` is that array)
 *
 * It reads the repository only. It never writes the generated module (it runs
 * the generator's own `render()` and compares), never seeds, never publishes,
 * and needs no credential. The rules are the runtime's own
 * (`services/agents/skillCatalogue.ts`); see SKILL_LIBRARY_AUDIT.md §10 and
 * SKILL_LIBRARY_CONTRACT.md.
 *
 * D5336 (#5336): it also reads `skills/scenarios/`, runs #4588's scenario
 * rules on every pack, fails a skill with more than `CASES_MAX` cases or two
 * cases of one identity, and prints scenario coverage per skill, apart from
 * model runs, which CI never makes (`model_evaluation: not_run`).
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { libraryEntries, render } from './build-skill-library.mjs';
import { checkSourceCatalogue, persistedFromJson, reconcile, summary } from '../cloudflare-worker/src/services/agents/skillCatalogue.ts';
import { SKILL_LIBRARY } from '../cloudflare-worker/src/services/agents/skillLibrary.generated.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'cloudflare-worker/src/services/agents/skills');
const GENERATED = join(ROOT, 'cloudflare-worker/src/services/agents/skillLibrary.generated.ts');
const TAXONOMY_SQL = join(ROOT, 'cloudflare-worker/sql/migrations/090_seed_skills_values_taxonomy.sql');

/** Active taxonomy skill → its category, from the checked-in seed (category rows name themselves). */
export function taxonomyFromSeed(sql) {
  return new Map([...sql.matchAll(/^\s*\('([a-z_]+)',\s*'([a-z_]+)',/gm)].filter((m) => m[2] !== m[1]).map((m) => [m[1], m[2]]));
}

export function readSources(dir = DIR) {
  const definitions = {}; const cases = {}; const scenarios = {};
  for (const f of readdirSync(dir)) if (f.endsWith('.md') && f !== 'README.md') definitions[f] = readFileSync(join(dir, f), 'utf8');
  for (const f of readdirSync(join(dir, 'cases'))) if (f.endsWith('.json')) cases[f] = readFileSync(join(dir, 'cases', f), 'utf8');
  for (const f of readdirSync(join(dir, 'scenarios'))) if (f.endsWith('.json')) scenarios[f] = readFileSync(join(dir, 'scenarios', f), 'utf8');
  return { definitions, cases, scenarios };
}

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };

if (import.meta.url === `file://${process.argv[1]}`) {
  const { definitions, cases, scenarios } = readSources();
  let generatedFresh = false;
  try { generatedFresh = readFileSync(GENERATED, 'utf8') === render(libraryEntries()); } catch { generatedFresh = false; }
  const { findings, manifest, coverage } = await checkSourceCatalogue({
    definitions, cases, scenarios, generated: SKILL_LIBRARY, generatedFresh, taxonomy: taxonomyFromSeed(readFileSync(TAXONOMY_SQL, 'utf8')),
  });
  const persistedPath = arg('--persisted');
  let persisted = null;
  if (persistedPath) {
    try { persisted = persistedFromJson(JSON.parse(readFileSync(persistedPath, 'utf8'))); } catch (e) {
      console.error(`✖ check-skill-library: --persisted ${persistedPath}: ${e.message}`); process.exit(1);
    }
  }
  const lines = persisted ? reconcile(manifest, persisted) : null;
  const out = summary(findings, manifest, lines, coverage);
  const jsonPath = arg('--json');
  if (jsonPath) writeFileSync(jsonPath, `${JSON.stringify(out, null, 2)}\n`);
  for (const f of findings) {
    const where = [f.file, f.slug, f.case_id ?? f.field].filter(Boolean).join(' · ');
    console[f.level === 'error' ? 'error' : 'log'](`${f.level === 'error' ? '✖' : '!'} ${where}: ${f.rule} — ${f.message} ${f.remediation}`);
  }
  for (const l of (lines ?? []).filter((x) => x.disposition !== 'none')) console.log(`${l.disposition === 'fail' ? '✖' : '!'} ${l.slug}: ${l.class} (${l.disposition})`);
  for (const c of out.scenario_coverage.skills) console.log(`  ${c.slug}: ${c.cases} cases (${c.scenarios} scenarios), ${c.assertions} assertions, ${c.incorrect_outputs} incorrect outputs, ${c.staged} staged`);
  const tail = `${out.skills} skills, ${out.cases} cases (${out.scenario_coverage.scenarios} scenarios), ${out.errors} errors, ${out.warnings} warnings; model evaluation not run in CI`;
  if (!out.ok) { console.error(`✖ check-skill-library: ${tail}.`); process.exit(1); }
  console.log(`✓ check-skill-library: ${tail}${lines ? `; reconciliation ${JSON.stringify(out.reconciliation.classes)}` : ''}.`);
}
