/**
 * Profiling v2 baseline — how TODAY's archetype engine classifies the
 * synthetic personas in test/fixtures/profiling-v2-personas.json (D356,
 * documentation/architecture/PROFILING_V2.md §9).
 *
 * A report, not a test: it asserts nothing and exits 0. Session 7 runs it
 * before and after its engine change and puts both tables in its PR.
 *
 *   node --experimental-strip-types --no-warnings \
 *        --import ./cloudflare-worker/test/_ts-loader.mjs \
 *        cloudflare-worker/scripts/profiling-v2-baseline.mjs [--json]
 *
 * It drives the real code path, not a copy of it: each persona's answers are
 * written to `field_sources` in an in-memory SQLite database (latest answer
 * per question as of the date, which is what that table's UNIQUE key keeps in
 * production), then services/archetypeScoring.ts `computeArchetype` classifies
 * them (the v1 four-archetype set /studio shows) and `classifyArchetypeV2`
 * over `loadPersonaTraitScores` gives the six-archetype set the v2 fit
 * decision reads. Today's engine has no answer ageing and no hysteresis, so
 * for evolution personas it prints the engine's pick on each checkpoint date
 * beside the displayed archetype the spec expects.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeD1 } from '../test/_d1_sqlite.mjs';
import { computeArchetype, classifyArchetypeV2, loadPersonaTraitScores } from '../src/services/archetypeScoring.ts';

const FIXTURE = resolve(process.cwd(), 'cloudflare-worker/test/fixtures/profiling-v2-personas.json');
const SCHEMA = `
  CREATE TABLE field_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, question_id TEXT NOT NULL,
    page_target TEXT, saved_to_table TEXT, saved_to_column TEXT, saved_to_id TEXT, source TEXT NOT NULL DEFAULT 'advisor',
    evidence_text TEXT, filled_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(user_id, question_id));
`;

/** The answers the ledger holds as of `at` (end of that UTC day): latest per question. */
function latestAsOf(answers, at) {
  const cutoff = at ? `${at}T23:59:59Z` : '9999-12-31T23:59:59Z';
  const latest = new Map();
  for (const a of answers) {
    if (a.answered_at > cutoff) continue;
    const prev = latest.get(a.question_id);
    if (!prev || a.answered_at >= prev.answered_at) latest.set(a.question_id, a);
  }
  return [...latest.values()];
}

async function classify(persona, at) {
  const { DB, db } = makeD1(SCHEMA);
  const env = { DB };
  const insert = db.prepare('INSERT INTO field_sources (user_id, question_id, evidence_text, filled_at) VALUES (1, ?, ?, ?)');
  for (const a of latestAsOf(persona.answers, at)) insert.run(a.question_id, String(a.value), a.answered_at);
  const v1 = await computeArchetype(env, 1, persona.role);
  const v2 = classifyArchetypeV2(persona.role, await loadPersonaTraitScores(env, 1, persona.role));
  return { v1, v2 };
}

const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const rows = [];
for (const p of fixture.personas) {
  if (p.kind === 'evolution') {
    for (const ck of p.checkpoints) {
      const { v1, v2 } = await classify(p, ck.at);
      rows.push({ key: `${p.key} @ ${ck.at}`, kind: p.kind, role: p.role, expected: ck.displayed, secondary: null, v1, v2 });
    }
  } else {
    const { v1, v2 } = await classify(p, null);
    rows.push({ key: p.key, kind: p.kind, role: p.role, expected: p.expected.primary, secondary: p.expected.secondary ?? null, v1, v2 });
  }
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(rows.map((r) => ({
    key: r.key, kind: r.kind, role: r.role, expected: r.expected, expected_secondary: r.secondary,
    v1: r.v1 && { slug: r.v1.slug, runner_up: r.v1.runner_up_slug, margin: r.v1.margin, confidence: r.v1.confidence },
    v2: r.v2 && { slug: r.v2.slug, runner_up: r.v2.runner_up_slug, margin: r.v2.margin },
  })), null, 2));
} else {
  const pad = (s, n) => String(s ?? '—').padEnd(n);
  console.log(`${pad('persona', 42)}${pad('role', 9)}${pad('expected', 28)}${pad('v1 engine (margin, conf)', 44)}${pad('v1 runner-up', 28)}v2 six-set`);
  let hit = 0; let total = 0; let secondaryHit = 0; let secondaryTotal = 0; let v2Hit = 0;
  for (const r of rows) {
    const ok = r.v1?.slug === r.expected;
    total += 1; if (ok) hit += 1; if (r.v2?.slug === r.expected) v2Hit += 1;
    if (r.secondary) { secondaryTotal += 1; if (r.v1?.runner_up_slug === r.secondary) secondaryHit += 1; }
    const v1 = r.v1 ? `${ok ? '✓' : '✗'} ${r.v1.slug} (${r.v1.margin}, ${r.v1.confidence})` : 'no archetype';
    console.log(`${pad(r.key, 42)}${pad(r.role, 9)}${pad(r.expected, 28)}${pad(v1, 44)}${pad(r.v1?.runner_up_slug, 28)}${r.v2?.slug ?? '—'}`);
  }
  console.log(`\nv1 engine matches the expected archetype on ${hit}/${total} rows; the v2 six-archetype set on ${v2Hit}/${total}.`);
  console.log(`Blend secondaries: v1 runner-up equals the expected secondary on ${secondaryHit}/${secondaryTotal}.`);
}
