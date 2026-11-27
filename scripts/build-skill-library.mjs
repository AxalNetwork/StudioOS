#!/usr/bin/env node
/**
 * D4225 (#4225): build the "From Axal" skill library from
 * `cloudflare-worker/src/services/agents/skills/`: every `<slug>.md` (the
 * SKILL.md, #3951's format), its `cases/<slug>.json` (the golden case, #3953's
 * shape) and, since D5336 (#5336), its `scenarios/<slug>.json` pack (#4588):
 * each scenario embedded beside the golden case as a case of its own, named by
 * its `name` and identified by `case_id` + `revision`
 * (`services/agents/skillCaseIdentity.ts`). The golden case stays first. The
 * fields are `skillScenarios.scenarioCase`'s, in its order.
 *
 * The Worker cannot read files at run time. Until D4574 H3 (#4574) the whole
 * library was embedded as data in the generated module, the Worker script's
 * largest single input (421.9 KiB). It is now TWO outputs:
 *
 *   cloudflare-worker/src/services/agents/skillLibrary.generated.ts
 *       the index the Worker imports: the entry types, the slugs in order, the
 *       library's digest and the asset's path;
 *   frontend/public/skill-library/library-<digest16>.json
 *       the entries themselves, `{ digest, entries }`, a static asset built
 *       into `docs/` that the Worker reads through its own assets binding
 *       (`services/agents/skillLibraryAsset.ts`) on the three Super Admin
 *       library routes. The digest is the SHA-256 of `JSON.stringify(entries)`,
 *       so one deploy's script never reads another's library, and the loader
 *       re-hashes what it reads.
 *
 * The files stay the source; neither output is edited by hand. Since D5612
 * (#5612) both are gitignored, never committed: `scripts/build-generated.mjs`
 * writes them before every build, typecheck and test. A write removes any
 * other `library-*.json` from the asset folder.
 *
 *   node scripts/build-skill-library.mjs           write both outputs
 *   node scripts/build-skill-library.mjs --check   exit 1 when the generator is not
 *                                                  deterministic or git tracks an output
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatedOutputProblems } from './lib/generatedOutput.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'cloudflare-worker/src/services/agents/skills');
export const SKILL_LIBRARY_REL = 'cloudflare-worker/src/services/agents/skillLibrary.generated.ts';
const OUT = join(ROOT, SKILL_LIBRARY_REL);
/** D4574 H3: the folder the entries' asset is written to, repo-relative; it is served at `/skill-library/`. */
export const SKILL_LIBRARY_ASSET_DIR_REL = 'frontend/public/skill-library';

/** A file's text, or null when it is not there: one read, never a check and then a read. */
function readOrNull(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    throw e;
  }
}

/** A scenario as the library case it becomes: the same fields, in the same order, as `skillScenarios.scenarioCase`. */
export const scenarioCase = (skill, s) => ({
  skill, case_id: s.case_id, revision: s.revision, name: s.name, note: s.covers, input: s.input, expect: s.expect,
});

/**
 * The library as data: one entry per skill, slug order; the golden case first,
 * then the skill's scenarios in pack order. `reversed` reverses the raw folder
 * listing first (the determinism check, D5612).
 */
export function libraryEntries(dir = DIR, { reversed = false } = {}) {
  const listed = readdirSync(dir);
  const files = (reversed ? listed.reverse() : listed).filter((f) => f.endsWith('.md') && f !== 'README.md').sort();
  return files.map((f) => {
    const slug = f.slice(0, -3);
    const caseText = readOrNull(join(dir, 'cases', `${slug}.json`));
    const kase = caseText === null ? null : JSON.parse(caseText);
    const packText = readOrNull(join(dir, 'scenarios', `${slug}.json`));
    const pack = packText === null ? null : JSON.parse(packText);
    const scenarios = (pack?.scenarios ?? []).map((s) => scenarioCase(pack.skill, s));
    return { slug, skill_md: readFileSync(join(dir, f), 'utf8'), cases: [...(kase ? [kase] : []), ...scenarios] };
  });
}

/** D4574 H3: the SHA-256 of the entries as the asset carries them, hex. The Worker's loader computes the same. */
export const libraryDigest = (entries) => createHash('sha256').update(JSON.stringify(entries)).digest('hex');

/** D4574 H3: the asset's served path, named by the digest: `/skill-library/library-<digest16>.json`. */
export const libraryAssetPath = (entries) => `/skill-library/library-${libraryDigest(entries).slice(0, 16)}.json`;

/** D4574 H3: the asset's bytes — the entries exactly as the generated module used to embed them, with their digest. */
export function renderAsset(entries = libraryEntries()) {
  return `${JSON.stringify({ digest: libraryDigest(entries), entries })}\n`;
}

/** The module the Worker imports: the types, the slugs, the digest and the asset's path; never the entries. */
export function render(entries = libraryEntries()) {
  return `/**
 * D4225 (#4225): the index of the "From Axal" skill library, generated by
 * \`node scripts/build-skill-library.mjs\` from \`services/agents/skills/\` (each
 * SKILL.md, its golden case and its scenario pack, D5336). Never edit by hand; it is gitignored and
 * rebuilt by \`scripts/build-generated.mjs\` before every build, typecheck and test (D5612).
 *
 * D4574 H3 (#4574): the entries are not here. They are the static asset
 * \`SKILL_LIBRARY_ASSET\` (\`frontend/public/skill-library/\`), read through the
 * assets binding by \`skillLibraryAsset.ts\`, which refuses a body whose digest
 * is not \`SKILL_LIBRARY_DIGEST\` or whose slugs are not \`SKILL_LIBRARY_SLUGS\`.
 * The seed (\`skillLibrarySeed.ts\`) creates each skill as a draft with its
 * cases, for H2's review, evals and publish (D4160).
 */
export type LibraryCase = { skill: string; version?: number; case_id?: string; revision?: number; name?: string; note?: string; input: { records: Record<string, unknown> }; expect: { output: string; must_include: string[]; must_say_not_recorded: string[]; must_not_include: string[]; [k: string]: unknown } };
export type LibraryEntry = { slug: string; skill_md: string; cases: LibraryCase[] };

/** Every library skill's slug, in the entries' (slug) order. */
export const SKILL_LIBRARY_SLUGS: readonly string[] = ${JSON.stringify(entries.map((e) => e.slug))};

/** The SHA-256 of \`JSON.stringify(entries)\`, hex. */
export const SKILL_LIBRARY_DIGEST = ${JSON.stringify(libraryDigest(entries))};

/** Where the assets binding serves the entries. */
export const SKILL_LIBRARY_ASSET = ${JSON.stringify(libraryAssetPath(entries))};
`;
}

/** D5612: everything wrong with the generator under `root` — not deterministic, or an output tracked by git. */
export function skillLibraryProblems(root = ROOT) {
  const dir = join(root, 'cloudflare-worker/src/services/agents/skills');
  return [
    ...generatedOutputProblems(root, SKILL_LIBRARY_REL, (o) => render(libraryEntries(dir, o))),
    // D4574 H3: the asset is generated too. Its folder is what git must not track (its name changes with the library).
    ...generatedOutputProblems(root, SKILL_LIBRARY_ASSET_DIR_REL, (o) => renderAsset(libraryEntries(dir, o))),
  ];
}

/** D4574 H3: write the asset under `root`, and remove every other library asset beside it. Returns its repo-relative path. */
export function writeAsset(entries = libraryEntries(), root = ROOT) {
  const dir = join(root, SKILL_LIBRARY_ASSET_DIR_REL);
  const name = libraryAssetPath(entries).split('/').pop();
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (f !== name && /^library-[0-9a-f]+\.json$/.test(f)) rmSync(join(dir, f));
  const path = join(dir, name);
  const next = renderAsset(entries);
  if ((readOrNull(path) ?? '') !== next) writeFileSync(path, next);
  return `${SKILL_LIBRARY_ASSET_DIR_REL}/${name}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--check')) {
    const problems = skillLibraryProblems();
    if (problems.length) {
      for (const p of problems) console.error(`✖ ${p}`);
      process.exit(1);
    }
    console.log(`✓ skill library: ${libraryEntries().length} skills; the generator is deterministic and git does not track its output.`);
    process.exit(0);
  }
  const entries = libraryEntries();
  const next = render(entries);
  const now = readOrNull(OUT) ?? '';
  if (now === next) {
    console.log('cloudflare-worker/src/services/agents/skillLibrary.generated.ts is already current.');
  } else {
    writeFileSync(OUT, next);
    console.log('wrote cloudflare-worker/src/services/agents/skillLibrary.generated.ts');
  }
  console.log(`wrote ${writeAsset(entries)}`);
}
