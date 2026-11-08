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
 */
import type { Env } from '../../types';
import { READ_KEYS } from './catalogue';
import { draftHash, type CaseExpect } from './skillLifecycle';
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
const CASE_KEYS = ['skill', 'version', 'note', 'input', 'expect'];
/** The `expect` keys `checkCase` keeps and `judge()` evaluates. #4531 adds `numbers` here with the judge that reads it. */
const EXPECT_KEYS = ['output', 'must_include', 'must_say_not_recorded', 'must_not_include'];
const READ_SOURCES = new Set(READ_KEYS.map((k) => k.split('.')[0]));
const AXES = new Set<string>(RADAR_AXES.map((a) => a.slug));

export type Finding = {
  level: 'error' | 'warning';
  file: string | null; slug: string | null; field: string | null; case_id: string | null;
  rule: string; message: string; remediation: string;
};
export type CaseManifest = { case_id: string; sha256: string };
export type ManifestEntry = { slug: string; draft_hash: string | null; cases: CaseManifest[] };

const sha256 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))]
  .map((b) => b.toString(16).padStart(2, '0')).join('');

/** A case's content identity: what `checkCase` keeps of it. Until #4588 adds an explicit id, the id is `<slug>#<first 12 of the hash>`. */
export async function caseIdentity(slug: string, input: unknown, expect: unknown): Promise<CaseManifest> {
  const hash = await sha256(JSON.stringify({ input, expect }));
  return { case_id: `${slug}#${hash.slice(0, 12)}`, sha256: hash };
}

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
  /** The generated module's entries as they are committed. */
  generated: readonly LibraryEntry[];
  /** Whether `render()` of the files equals the committed module. */
  generatedFresh: boolean;
  /** Active taxonomy slug → its category (migration 090). */
  taxonomy: ReadonlyMap<string, string>;
};

/** Every source check; see the header. Findings are in file order. */
export async function checkSourceCatalogue(src: SourceInput): Promise<{ findings: Finding[]; manifest: ManifestEntry[] }> {
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

  // 2. Definitions and cases, through the runtime checks.
  const entries: LibraryEntry[] = mdSlugs.filter((s) => caseSlugs.includes(s)).map((s) => {
    let kase: any = null;
    try { kase = JSON.parse(src.cases[`${s}.json`]); } catch {
      add({ file: `cases/${s}.json`, slug: s, field: null, case_id: null, rule: 'case_malformed', message: `cases/${s}.json is not JSON.`, remediation: 'Fix the JSON syntax.' });
    }
    return { slug: s, skill_md: src.definitions[`${s}.md`], cases: kase && typeof kase === 'object' && !Array.isArray(kase) ? [kase] : [] };
  });
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
    for (const raw of c.entry.cases as any[]) {
      const id = await caseIdentity(s, raw.input, raw.expect);
      cases.push(id);
      const where = { file: `cases/${s}.json`, slug: s, case_id: id.case_id };
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
  return { findings, manifest };
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
    const live = (await env.DB.prepare('SELECT input_json, expect_json FROM agent_skill_cases WHERE skill_id = ? AND removed_at IS NULL ORDER BY id')
      .bind(s.id).all<{ input_json: string; expect_json: string }>()).results ?? [];
    const cases: CaseManifest[] = [];
    for (const k of live) {
      let input: unknown = null; let expect: unknown = null;
      try { input = JSON.parse(k.input_json); expect = JSON.parse(k.expect_json); } catch { /* an unreadable case is still a case; its hash is of nulls */ }
      cases.push(await caseIdentity(s.slug, input, expect));
    }
    out.push({ slug: s.slug, uid: s.uid, status: s.status, current_version: Number(s.current_version), draft_hash: await draftHash(parts), cases });
  }
  return out;
}

export type ReconcileClass = 'exact' | 'source_only' | 'persisted_only' | 'content_drift' | 'case_drift' | 'missing_case' | 'duplicate_identity' | 'invalid_reference';
export type ReconcileLine = {
  slug: string; class: ReconcileClass; disposition: 'none' | 'report' | 'seed' | 'fail';
  source: { draft_hash: string | null; case_hashes: string[] } | null;
  persisted: { uid: string; status: string; draft_hash: string | null; live_case_hashes: string[] } | null;
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
  const src = (e: ManifestEntry) => ({ draft_hash: e.draft_hash, case_hashes: e.cases.map((c) => c.sha256).sort() });
  const per = (p: PersistedEntry) => ({ uid: p.uid, status: p.status, draft_hash: p.draft_hash, live_case_hashes: p.cases.map((c) => c.sha256).sort() });
  const sourceSlugs = new Set<string>();
  for (const e of source) {
    if (sourceSlugs.has(e.slug)) { out.push({ slug: e.slug, class: 'duplicate_identity', disposition: 'fail', source: src(e), persisted: null }); continue; }
    sourceSlugs.add(e.slug);
    const rows = seen.get(e.slug) ?? [];
    if (rows.length > 1) { out.push({ slug: e.slug, class: 'duplicate_identity', disposition: 'fail', source: src(e), persisted: per(rows[0]) }); continue; }
    if (e.draft_hash == null) { out.push({ slug: e.slug, class: 'invalid_reference', disposition: 'fail', source: src(e), persisted: rows[0] ? per(rows[0]) : null }); continue; }
    const p = rows[0];
    if (!p) { out.push({ slug: e.slug, class: 'source_only', disposition: 'seed', source: src(e), persisted: null }); continue; }
    const live = new Set(p.cases.map((c) => c.sha256));
    const klass: ReconcileClass = p.draft_hash !== e.draft_hash ? 'content_drift'
      : !p.cases.length ? 'missing_case'
      : e.cases.some((c) => !live.has(c.sha256)) ? 'case_drift' : 'exact';
    out.push({ slug: e.slug, class: klass, disposition: klass === 'exact' ? 'none' : 'report', source: src(e), persisted: per(p) });
  }
  for (const [slug, rows] of seen) {
    if (sourceSlugs.has(slug)) continue;
    out.push({ slug, class: rows.length > 1 ? 'duplicate_identity' : 'persisted_only', disposition: rows.length > 1 ? 'fail' : 'report', source: null, persisted: per(rows[0]) });
  }
  return out.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
}

/** The machine-readable summary the command prints with `--json`. */
export function summary(findings: readonly Finding[], manifest: readonly ManifestEntry[], lines: readonly ReconcileLine[] | null) {
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
    // Ordinary CI never runs a paid model. Saying so is not a pass.
    model_evaluation: { status: 'not_run' as const, reason: 'Pull-request CI runs no model. Draft and published evaluations run from HQ › AI agents.' },
    reconciliation: lines ? { classes, lines } : { status: 'not_run' as const, reason: 'No persisted manifest was given (--persisted <file>).' },
  };
}
