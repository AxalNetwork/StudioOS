/**
 * #4532 (Session 04 of #4528) — the skill library's CI gate and its
 * reconciliation with the store, on the production validators.
 *
 * ONE SET OF RULES. Every field rule here is the runtime's: `readLibrarySkill`
 * and `checkDraft` for a definition, `checkCase` for a golden case (all through
 * `checkLibrary`), `draftHash` for content identity. This file adds only what a
 * single draft cannot know: that each file has its pair, that a case feeds only
 * the reads its skill lists, that the generated module matches the files, and
 * that the source and the store agree.
 *
 * `checkSourceCatalogue` is pure: files and the taxonomy in, findings and a
 * manifest out (`scripts/check-skill-library.mjs` reads the repository and
 * prints them). `persistedManifest` READS the store and writes nothing; it is
 * for a local or test D1, or a separately authorized read-only preflight.
 * `reconcile` compares the two by identity and content hash, never by count,
 * and only reports: it never renames, overwrites or deletes a draft or a case.
 *
 * D5336 (#5336): a skill's sources are its golden case and its scenario pack
 * (`skills/scenarios/<slug>.json`). Each case is identified through
 * `skillCaseIdentity.ts` (`case_id` + `revision`, or `<slug>#<sha12>`), the
 * scenario rules are `skillScenarios.checkScenarioPacks`, and a skill whose
 * cases exceed `CASES_MAX`, or two of whose cases share an identity, fails.
 *
 * D5335 (#5335): `libraryManifest` is the source manifest the Worker can build
 * without the files (from the generated module, through `checkLibrary`), and
 * `reconcileReport` is what `GET /api/admin/ai-agents/skills/library/reconcile`
 * answers: per slug its class, the two draft hashes and the published version,
 * the totals per class, and the persisted manifest, which
 * `scripts/check-skill-library.mjs --persisted` reads back. Hashes and
 * identities only: no draft text, no case input, no user identifier.
 */
import type { Env } from '../../types';
import { READ_KEYS } from './catalogue';
import { draftHash, type CaseExpect } from './skillLifecycle';
import { caseIdentity, storedCaseIdentity, type CaseIdentity } from './skillCaseIdentity';
import { checkScenarioPacks, scenarioCase, type ScenarioCoverage } from './skillScenarios';
import { ASSERTION_KEYS } from './skillAssertions';
import { checkLibrary } from './skillLibrarySeed';
import { isSkillSlug } from './skills';
import { draftPartsOf } from './skillPublish';
import { RADAR_AXES } from '../skillsTaxonomySchema';
import type { LibraryEntry } from './skillLibrary.generated';
import type { SkillRow } from './skillLinks';

export const CATALOGUE_CHECK_VERSION = 1;
/** Breadth that is reported for a reviewer to look at, never refused. */
export const ROLES_REVIEW_AT = 3;
export const TAGS_REVIEW_AT = 7;
const FRONT_KEYS = ['name', 'description', 'roles', 'tools', 'output', 'taxonomy', 'version'];
const CASE_KEYS = ['skill', 'version', 'case_id', 'revision', 'name', 'note', 'input', 'expect'];
/** The `expect` keys `checkCase` keeps and `judge()` evaluates (`numbers` and the slice-2 assertions since #4531). */
const EXPECT_KEYS: readonly string[] = ['output', 'must_include', 'must_say_not_recorded', 'must_not_include', ...ASSERTION_KEYS];
const READ_SOURCES = new Set(READ_KEYS.map((k) => k.split('.')[0]));
const AXES = new Set<string>(RADAR_AXES.map((a) => a.slug));

export type Finding = {
  level: 'error' | 'warning';
  file: string | null; slug: string | null; field: string | null; case_id: string | null;
  rule: string; message: string; remediation: string;
};
/** A case's identity (`skillCaseIdentity.ts`): `case_id`, `revision`, `key` and the content `sha256`. */
export type CaseManifest = CaseIdentity;
export type ManifestEntry = { slug: string; draft_hash: string | null; cases: CaseManifest[] };

export { caseIdentity } from './skillCaseIdentity';

const front = (md: string): Record<string, string> => {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(md);
  const out: Record<string, string> = {};
  for (const line of m?.[1].split('\n') ?? []) { const kv = /^([a-z_]+):\s*(.*)$/.exec(line); if (kv) out[kv[1]] = kv[2].trim(); }
  return out;
};

export type SourceInput = {
  /** `<slug>.md` → text, from `services/agents/skills/`. */
  definitions: Record<string, string>;
  /** `<slug>.json` → text, from `services/agents/skills/cases/`. */
  cases: Record<string, string>;
  /** `<slug>.json` → text, from `services/agents/skills/scenarios/` (D5336); none when absent. */
  scenarios?: Record<string, string>;
  /** The generated module's entries as they are committed. */
  generated: readonly LibraryEntry[];
  /** Whether `render()` of the files equals the committed module. */
  generatedFresh: boolean;
  /** Active taxonomy slug → its category (migration 090). */
  taxonomy: ReadonlyMap<string, string>;
};

/** Every source check; see the header. Findings are in file order. */
export async function checkSourceCatalogue(src: SourceInput): Promise<{ findings: Finding[]; manifest: ManifestEntry[]; coverage: ScenarioCoverage[] }> {
  const findings: Finding[] = [];
  const add = (f: Omit<Finding, 'level'> & { level?: Finding['level'] }) => findings.push({ level: f.level ?? 'error', ...f });
  const mdSlugs = Object.keys(src.definitions).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();
  const caseSlugs = Object.keys(src.cases).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();

  // 1. Files and identity.
  for (const s of mdSlugs) {
    if (!isSkillSlug(s)) add({ file: `${s}.md`, slug: s, field: 'name', case_id: null, rule: 'slug_invalid', message: `"${s}" is not a skill slug.`, remediation: 'Rename the file to lower-case letters, digits and single hyphens, up to 64 characters.' });
    if (!caseSlugs.includes(s)) add({ file: `${s}.md`, slug: s, field: null, case_id: null, rule: 'case_missing', message: `${s} has no golden case.`, remediation: `Add cases/${s}.json with synthetic records.` });
  }
  for (const s of caseSlugs) {
    if (!mdSlugs.includes(s)) add({ file: `cases/${s}.json`, slug: s, field: null, case_id: null, rule: 'case_orphan', message: `cases/${s}.json has no skill.`, remediation: `Add ${s}.md or remove the case.` });
  }
  const byName = new Map<string, string[]>();
  for (const s of mdSlugs) { const n = front(src.definitions[`${s}.md`]).name ?? ''; byName.set(n, [...(byName.get(n) ?? []), s]); }
  for (const [n, files] of byName) {
    if (n && files.length > 1) add({ file: files.map((f) => `${f}.md`).join(', '), slug: n, field: 'name', case_id: null, rule: 'duplicate_slug', message: `${files.length} definitions name ${n}.`, remediation: 'Give each skill its own slug; never rename an existing one to resolve this.' });
  }

  // 1b. Scenario packs (D5336): their own rules; each valid pack's scenarios become the skill's further cases.
  const scen = checkScenarioPacks(src.scenarios ?? {}, new Set(mdSlugs));
  findings.push(...scen.findings);

  // 2. Definitions and cases, through the runtime checks. The golden case first, then the scenarios, as the generator packs them.
  const entries: LibraryEntry[] = mdSlugs.filter((s) => caseSlugs.includes(s)).map((s) => {
    let kase: any = null;
    try { kase = JSON.parse(src.cases[`${s}.json`]); } catch {
      add({ file: `cases/${s}.json`, slug: s, field: null, case_id: null, rule: 'case_malformed', message: `cases/${s}.json is not JSON.`, remediation: 'Fix the JSON syntax.' });
    }
    const golden = kase && typeof kase === 'object' && !Array.isArray(kase) ? [kase] : [];
    const pack = scen.parsed.get(s);
    return { slug: s, skill_md: src.definitions[`${s}.md`], cases: [...golden, ...(pack?.scenarios ?? []).map((x) => scenarioCase(pack!.skill, x))] as LibraryEntry['cases'] };
  });
  // More than `CASES_MAX` cases is `checkLibrary`'s own `cases_max` refusal, reported below like every runtime code.
  const manifest: ManifestEntry[] = [];
  const caseIds = new Map<string, string>();
  const checked = checkLibrary(new Set(src.taxonomy.keys()), entries.filter((e) => e.cases.length));
  for (const c of checked) {
    const s = c.entry.slug;
    const fm = front(c.entry.skill_md);
    for (const k of Object.keys(fm)) if (!FRONT_KEYS.includes(k)) add({ level: 'warning', file: `${s}.md`, slug: s, field: k, case_id: null, rule: 'front_key_unknown', message: `"${k}" is not a v1 field; the importer ignores it.`, remediation: 'Remove it, or land it with the v2 contract first (SKILL_LIBRARY_CONTRACT.md).' });
    if (!c.ok) {
      const field = c.code.startsWith('case') ? null : c.code.split('_')[0];
      add({ file: c.code.startsWith('case') ? `cases/${s}.json` : `${s}.md`, slug: s, field, case_id: null, rule: c.code, message: c.message, remediation: 'Correct the field the message names; the runtime refuses the same thing on save.' });
      manifest.push({ slug: s, draft_hash: null, cases: [] });
      continue;
    }
    const d = c.draft;
    const sources = new Set(d.tools.map((t) => t.split('.')[0]));
    for (const t of d.tools) {
      if (!READ_SOURCES.has(t.split('.')[0])) add({ file: `${s}.md`, slug: s, field: 'tools', case_id: null, rule: 'tool_source_unknown', message: `${t} names no catalogue read source.`, remediation: 'Use a source from catalogue.ts READ_KEYS.' });
      else if (!t.endsWith('.read')) add({ level: 'warning', file: `${s}.md`, slug: s, field: 'tools', case_id: null, rule: 'tool_not_library_form', message: `${t} is read-only but not the library's source.read form.`, remediation: 'Use <source>.read.' });
    }
    const first = d.tags[0];
    if (!AXES.has(src.taxonomy.get(first.slug) ?? '')) add({ file: `${s}.md`, slug: s, field: 'taxonomy', case_id: null, rule: 'area_unknown', message: `The first tag ${first.slug} has no radar area.`, remediation: 'Put a tag whose category is one of the eight radar areas first.' });
    if (d.roles.length >= ROLES_REVIEW_AT) add({ level: 'warning', file: `${s}.md`, slug: s, field: 'roles', case_id: null, rule: 'roles_broad', message: `${d.roles.length} roles.`, remediation: 'Confirm every role runs the same workflow, or split the skill.' });
    if (d.tags.length >= TAGS_REVIEW_AT) add({ level: 'warning', file: `${s}.md`, slug: s, field: 'taxonomy', case_id: null, rule: 'tags_broad', message: `${d.tags.length} taxonomy tags.`, remediation: 'Keep the tags the skill really exercises.' });
    const cases: CaseManifest[] = [];
    const keys = new Set<string>();
    for (const [i, raw] of (c.entry.cases as any[]).entries()) {
      // The identity of what `checkCase` keeps (D4532 §2), through the one helper the store side uses too.
      const kept = c.cases[i];
      const id = await caseIdentity(s, { case_id: raw.case_id, revision: raw.revision, input: kept.input, expect: kept.expect });
      cases.push(id);
      const where = { file: raw.case_id ? `scenarios/${s}.json` : `cases/${s}.json`, slug: s, case_id: id.key };
      if (keys.has(id.key)) add({ ...where, field: 'case_id', rule: 'case_identity_duplicate', message: `Two of ${s}'s cases are ${id.key}.`, remediation: 'Give each case its own case_id, or bump the revision of a changed one.' });
      keys.add(id.key);
      if (raw.skill !== s) add({ ...where, field: 'skill', rule: 'case_skill_mismatch', message: `The case names ${String(raw.skill)}.`, remediation: `Set "skill": "${s}".` });
      if ((raw.expect as CaseExpect).output !== d.output_kind) add({ ...where, field: 'expect.output', rule: 'case_output_mismatch', message: `The case expects ${raw.expect.output}; the skill proposes ${d.output_kind}.`, remediation: 'Make the two agree.' });
      for (const key of Object.keys(raw.input.records)) {
        if (!(READ_KEYS as readonly string[]).includes(key)) add({ ...where, field: `input.records.${key}`, rule: 'record_key_unknown', message: `${key} is not a catalogue read.`, remediation: 'Key each record by a read in catalogue.ts READ_KEYS.' });
        else if (!sources.has(key.split('.')[0])) add({ ...where, field: `input.records.${key}`, rule: 'record_key_outside_tools', message: `${key} is a read the skill does not list.`, remediation: 'Feed only reads the skill names in tools, or add the tool.' });
      }
      for (const k of Object.keys(raw)) if (!CASE_KEYS.includes(k)) add({ ...where, level: 'warning', field: k, rule: 'case_key_unknown', message: `"${k}" is not a v1 case field.`, remediation: 'Remove it; it is not evaluated.' });
      for (const k of Object.keys(raw.expect)) if (!EXPECT_KEYS.includes(k)) add({ ...where, level: 'warning', field: `expect.${k}`, rule: 'expect_key_unknown', message: `"${k}" is not evaluated, so it proves nothing.`, remediation: 'Remove it, or express it as a supported assertion.' });
      const other = caseIds.get(id.sha256);
      if (other) add({ ...where, level: 'warning', field: null, rule: 'duplicate_case_content', message: `The same case as ${other}.`, remediation: 'Give each skill a case of its own.' });
      else caseIds.set(id.sha256, s);
    }
    manifest.push({ slug: s, draft_hash: await draftHash(d), cases });
  }

  // 3. The generated module: checked, never written.
  if (!src.generatedFresh) add({ file: 'skillLibrary.generated.ts', slug: null, field: null, case_id: null, rule: 'generated_stale', message: 'The generated module does not match the files.', remediation: 'Run node scripts/build-skill-library.mjs and commit the result; never edit it by hand.' });
  const gen = src.generated.map((e) => e.slug);
  if (JSON.stringify(gen) !== JSON.stringify([...gen].sort())) add({ file: 'skillLibrary.generated.ts', slug: null, field: null, case_id: null, rule: 'generated_order', message: 'The generated entries are not in slug order.', remediation: 'Rebuild with the script.' });
  for (const s of new Set(gen.filter((x, i) => gen.indexOf(x) !== i))) add({ file: 'skillLibrary.generated.ts', slug: s, field: null, case_id: null, rule: 'duplicate_slug', message: `${s} is in the generated module twice.`, remediation: 'Rebuild with the script.' });
  for (const s of gen) if (!mdSlugs.includes(s)) add({ file: 'skillLibrary.generated.ts', slug: s, field: null, case_id: null, rule: 'generated_without_source', message: `${s} is generated but has no definition.`, remediation: 'Rebuild with the script.' });
  for (const s of mdSlugs) if (!gen.includes(s)) add({ file: 'skillLibrary.generated.ts', slug: s, field: null, case_id: null, rule: 'source_not_generated', message: `${s} is not in the generated module.`, remediation: 'Rebuild with the script.' });
  return { findings, manifest, coverage: scen.coverage };
}

// ── The store ────────────────────────────────────────────────────────────────

export type PersistedEntry = ManifestEntry & { uid: string; status: string; current_version: number };

/**
 * Axal's skills in the store (scope 'hq'), each with its current draft's hash
 * and its live cases' identities. READ ONLY. A company's skill is never part of
 * the library: the same slug in a company is not a collision.
 */
export async function persistedManifest(env: Env): Promise<PersistedEntry[]> {
  const rows = (await env.DB.prepare("SELECT * FROM agent_skills WHERE scope = 'hq' AND company_id IS NULL ORDER BY slug, id").all<SkillRow>()).results ?? [];
  const out: PersistedEntry[] = [];
  for (const s of rows) {
    const parts = await draftPartsOf(env, s);
    const live = (await env.DB.prepare('SELECT input_json, expect_json, source_case_id, source_revision FROM agent_skill_cases WHERE skill_id = ? AND removed_at IS NULL ORDER BY id')
      .bind(s.id).all<{ input_json: string; expect_json: string; source_case_id: string | null; source_revision: number | null }>()).results ?? [];
    // An unreadable case is still a case; its hash is of nulls.
    const cases: CaseManifest[] = [];
    for (const k of live) cases.push(await storedCaseIdentity(s.slug, k));
    out.push({ slug: s.slug, uid: s.uid, status: s.status, current_version: Number(s.current_version), draft_hash: await draftHash(parts), cases });
  }
  return out;
}

export type ReconcileClass = 'exact' | 'source_only' | 'persisted_only' | 'content_drift' | 'case_drift' | 'missing_case' | 'duplicate_identity' | 'invalid_reference';
export type ReconcileLine = {
  slug: string; class: ReconcileClass; disposition: 'none' | 'report' | 'seed' | 'fail';
  source: { draft_hash: string | null; case_hashes: string[]; case_keys: string[] } | null;
  persisted: { uid: string; status: string; draft_hash: string | null; live_case_hashes: string[]; live_case_keys: string[] } | null;
};

/**
 * The source against the store, one line per slug, the classes of
 * SKILL_LIBRARY_AUDIT.md §10. A line never asks for an overwrite: drift is
 * `report`, a source-only skill is `seed` (the existing, explicit Super Admin
 * action), a duplicate identity or an invalid source is `fail`.
 */
export function reconcile(source: readonly ManifestEntry[], persisted: readonly PersistedEntry[]): ReconcileLine[] {
  const out: ReconcileLine[] = [];
  const seen = new Map<string, PersistedEntry[]>();
  for (const p of persisted) seen.set(p.slug, [...(seen.get(p.slug) ?? []), p]);
  const src = (e: ManifestEntry) => ({ draft_hash: e.draft_hash, case_hashes: e.cases.map((c) => c.sha256).sort(), case_keys: e.cases.map((c) => c.key).sort() });
  const per = (p: PersistedEntry) => ({ uid: p.uid, status: p.status, draft_hash: p.draft_hash, live_case_hashes: p.cases.map((c) => c.sha256).sort(), live_case_keys: p.cases.map((c) => c.key).sort() });
  const sourceSlugs = new Set<string>();
  for (const e of source) {
    if (sourceSlugs.has(e.slug)) { out.push({ slug: e.slug, class: 'duplicate_identity', disposition: 'fail', source: src(e), persisted: null }); continue; }
    sourceSlugs.add(e.slug);
    // Two source cases with one identity: the seed could not tell them apart.
    if (new Set(e.cases.map((c) => c.key)).size !== e.cases.length) { out.push({ slug: e.slug, class: 'duplicate_identity', disposition: 'fail', source: src(e), persisted: null }); continue; }
    const rows = seen.get(e.slug) ?? [];
    if (rows.length > 1) { out.push({ slug: e.slug, class: 'duplicate_identity', disposition: 'fail', source: src(e), persisted: per(rows[0]) }); continue; }
    if (e.draft_hash == null) { out.push({ slug: e.slug, class: 'invalid_reference', disposition: 'fail', source: src(e), persisted: rows[0] ? per(rows[0]) : null }); continue; }
    const p = rows[0];
    if (!p) { out.push({ slug: e.slug, class: 'source_only', disposition: 'seed', source: src(e), persisted: null }); continue; }
    // A source case is in the store when a live case has its identity AND its content (D5336).
    const live = new Set(p.cases.map((c) => `${c.key} ${c.sha256}`));
    const klass: ReconcileClass = p.draft_hash !== e.draft_hash ? 'content_drift'
      : !p.cases.length ? 'missing_case'
      : e.cases.some((c) => !live.has(`${c.key} ${c.sha256}`)) ? 'case_drift' : 'exact';
    out.push({ slug: e.slug, class: klass, disposition: klass === 'exact' ? 'none' : 'report', source: src(e), persisted: per(p) });
  }
  for (const [slug, rows] of seen) {
    if (sourceSlugs.has(slug)) continue;
    out.push({ slug, class: rows.length > 1 ? 'duplicate_identity' : 'persisted_only', disposition: rows.length > 1 ? 'fail' : 'report', source: null, persisted: per(rows[0]) });
  }
  return out.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

/** Every class, in the order the report totals them. */
export const RECONCILE_CLASSES: readonly ReconcileClass[] = ['exact', 'source_only', 'persisted_only', 'content_drift', 'case_drift', 'missing_case', 'duplicate_identity', 'invalid_reference'];
export const RECONCILE_REPORT_VERSION = 1;

/**
 * D5335: the source manifest from the generated module (the Worker reads no
 * file), on the runtime's own `checkLibrary`. On the committed library it
 * equals `checkSourceCatalogue`'s manifest; an entry `checkLibrary` refuses has
 * no hash, so `reconcile` calls it `invalid_reference`.
 */
export async function libraryManifest(taxonomy: ReadonlySet<string>, entries: readonly LibraryEntry[]): Promise<ManifestEntry[]> {
  const out: ManifestEntry[] = [];
  for (const c of checkLibrary(taxonomy, entries)) {
    if (!c.ok) { out.push({ slug: c.entry.slug, draft_hash: null, cases: [] }); continue; }
    const cases: CaseManifest[] = [];
    for (const k of c.cases) cases.push(await caseIdentity(c.entry.slug, { case_id: k.case_id, revision: k.revision, input: k.input, expect: k.expect }));
    out.push({ slug: c.entry.slug, draft_hash: await draftHash(c.draft), cases });
  }
  return out;
}

export type ReconcileReportLine = {
  slug: string; class: ReconcileClass; disposition: ReconcileLine['disposition'];
  source_hash: string | null; persisted_hash: string | null; published_version: number | null;
};

/**
 * D5335: the route's answer. Per slug: the class, its disposition (D4532 §3),
 * the source and persisted draft hashes, and the published version (null when
 * never published). `totals` names every class, zeros included. `manifest` is
 * the persisted side, hashes and identities only, in the form `--persisted`
 * reads. Nothing here carries draft text, case input or a person.
 */
export function reconcileReport(lines: readonly ReconcileLine[], persisted: readonly PersistedEntry[]) {
  const byUid = new Map(persisted.map((p) => [p.uid, p]));
  const totals = Object.fromEntries(RECONCILE_CLASSES.map((k) => [k, 0])) as Record<ReconcileClass, number>;
  const skills: ReconcileReportLine[] = lines.map((l) => {
    totals[l.class] += 1;
    const p = l.persisted ? byUid.get(l.persisted.uid) : undefined;
    const v = p ? Number(p.current_version) : 0;
    return { slug: l.slug, class: l.class, disposition: l.disposition, source_hash: l.source?.draft_hash ?? null, persisted_hash: l.persisted?.draft_hash ?? null, published_version: v > 0 ? v : null };
  });
  return {
    report_version: RECONCILE_REPORT_VERSION,
    scope: 'hq' as const,
    totals,
    skills,
    manifest: persisted.map((p) => ({
      slug: p.slug, uid: p.uid, status: p.status, current_version: Number(p.current_version), draft_hash: p.draft_hash,
      cases: p.cases.map((c) => ({ case_id: c.case_id, revision: c.revision, key: c.key, sha256: c.sha256 })),
    })),
  };
}

/**
 * D5335: a `--persisted` file is either the manifest array `persistedManifest()`
 * returns, or the reconcile route's JSON, whose `manifest` is that array.
 * Anything else is refused, never read as an empty store.
 */
export function persistedFromJson(raw: unknown): PersistedEntry[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as any).manifest) ? (raw as any).manifest : null;
  if (!list) throw new Error('The persisted manifest is neither an array nor the reconcile route\'s JSON (no "manifest" array).');
  for (const e of list) {
    if (!e || typeof e !== 'object' || typeof e.slug !== 'string' || typeof e.uid !== 'string' || !Array.isArray(e.cases)) {
      throw new Error('A persisted manifest entry needs slug, uid and cases.');
    }
  }
  return list as PersistedEntry[];
}

/** The machine-readable summary the command prints with `--json`. */
export function summary(findings: readonly Finding[], manifest: readonly ManifestEntry[], lines: readonly ReconcileLine[] | null, coverage: readonly ScenarioCoverage[] = []) {
  const count = (l: Finding['level']) => findings.filter((f) => f.level === l).length;
  const classes: Record<string, number> = {};
  for (const l of lines ?? []) classes[l.class] = (classes[l.class] ?? 0) + 1;
  return {
    check_version: CATALOGUE_CHECK_VERSION,
    ok: count('error') === 0 && !(lines ?? []).some((l) => l.disposition === 'fail'),
    skills: manifest.length,
    cases: manifest.reduce((n, m) => n + m.cases.length, 0),
    errors: count('error'), warnings: count('warning'),
    findings,
    // D5336: what the sources cover, per skill with scenarios, deterministically. Never a count of model runs.
    scenario_coverage: {
      scenarios: coverage.reduce((n, c) => n + c.scenarios, 0),
      skills: coverage.map((c) => ({ ...c, cases: manifest.find((m) => m.slug === c.slug)?.cases.length ?? 0 })),
    },
    // Repeated executions (each case run on each required model) are HQ's evaluation, never CI's.
    executions: { status: 'not_run' as const, runs: 0 },
    // Ordinary CI never runs a paid model. Saying so is not a pass.
    model_evaluation: { status: 'not_run' as const, reason: 'Pull-request CI runs no model. Draft and published evaluations run from HQ › AI agents.' },
    reconciliation: lines ? { classes, lines } : { status: 'not_run' as const, reason: 'No persisted manifest was given (--persisted <file>).' },
  };
}
