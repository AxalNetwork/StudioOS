#!/usr/bin/env node
/**
 * D8520 (#8520) — runs each skill's evaluation cases that need no model, in
 * pull-request CI, and fails on any finding. A case's result is decided here
 * only when no model decides it: its shape, its output kind, the reads it
 * feeds (the skill's required inputs) against the skill's tools, and for a
 * case with known outputs (a #4588 scenario) the correct output passing
 * `judge()` and each incorrect one failing on its target
 * (`skillEval.runCaseWithoutModel`). No model is called.
 *
 *   node --experimental-strip-types --no-warnings \
 *     --import ./cloudflare-worker/test/_ts-loader.mjs scripts/check-skill-eval-cases.mjs
 *       [--base <ref>]   run the skills the diff from <ref> changes (default: the
 *                        SKILL_EVAL_BASE or CI_FAILURE_BASE commit); every skill when
 *                        the evaluation code changed, or when no base can be diffed
 *       [--dir <path>]   the skills folder to read (a fixture; default the library)
 *       [--allowlist <path>]
 *
 * A skill with no deterministic case fails, unless `scripts/skill-eval-allowlist.json`
 * names it with the reason. An allowlisted skill that has one now, or that no
 * longer exists, fails too, so the list only shrinks. Every finding names the
 * skill, the case and the reason, on stdout and in the job summary
 * (`GITHUB_STEP_SUMMARY`).
 */
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCaseWithoutModel } from '../cloudflare-worker/src/services/agents/skillEval.ts';
import { readLibrarySkill } from '../cloudflare-worker/src/services/agents/skillLibrarySeed.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SKILLS_REL = 'cloudflare-worker/src/services/agents/skills';
export const ALLOWLIST_REL = 'scripts/skill-eval-allowlist.json';

/** A change to any of these runs every skill's cases. */
export const EVAL_CODE = Object.freeze([
  'cloudflare-worker/src/services/agents/skillEval.ts',
  'cloudflare-worker/src/services/agents/skillAssertions.ts',
  'cloudflare-worker/src/services/agents/skillCaseIdentity.ts',
  'cloudflare-worker/src/services/agents/skillEvalCompare.ts',
  'cloudflare-worker/src/services/agents/skillLifecycle.ts',
  'cloudflare-worker/src/services/agents/skillScenarios.ts',
  'cloudflare-worker/src/services/agents/skillLibrarySeed.ts',
  'scripts/check-skill-eval-cases.mjs',
  ALLOWLIST_REL,
]);

const readJson = (path) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } };

/**
 * Each skill in `dir`: its tools and output kind from `<slug>.md`, and its cases —
 * the golden case (`cases/<slug>.json`, no known outputs) and each scenario
 * (`scenarios/<slug>.json`, with them). A skill whose file is not in the library
 * format has `invalid` set and no cases.
 */
export function readSkills(dir = join(ROOT, SKILLS_REL)) {
  const skills = new Map();
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.md') && x !== 'README.md').sort()) {
    const slug = f.slice(0, -3);
    const def = readLibrarySkill(readFileSync(join(dir, f), 'utf8'));
    if (!def) { skills.set(slug, { slug, invalid: true, tools: [], output_kind: '', cases: [] }); continue; }
    const cases = [];
    const golden = readJson(join(dir, 'cases', `${slug}.json`));
    if (golden) cases.push({ name: `Golden case: ${slug}`, input: golden.input, expect: golden.expect, outputs: null });
    const pack = readJson(join(dir, 'scenarios', `${slug}.json`));
    for (const s of Array.isArray(pack?.scenarios) ? pack.scenarios : []) {
      cases.push({ name: String(s?.case_id ?? s?.name ?? 'unnamed scenario'), input: s?.input, expect: s?.expect, outputs: s?.outputs ?? null });
    }
    skills.set(slug, { slug, invalid: false, tools: def.tools, output_kind: String(def.output_kind ?? ''), cases });
  }
  return skills;
}

/** The skill a changed path belongs to, or null. A slug is lower-case, so a `README.md` is never one. */
export function skillOfPath(path) {
  return new RegExp(`^${SKILLS_REL}/(?:(?:cases|scenarios)/)?([a-z0-9-]+)\\.(?:md|json)$`).exec(path)?.[1] ?? null;
}

/**
 * Which skills run: every one when `changed` is null (no base to diff) or names
 * evaluation code; otherwise those whose definition, golden case or scenarios
 * changed.
 */
export function selectSkills(changed, slugs) {
  if (changed == null) return { mode: 'all', reason: 'no base commit could be diffed', slugs: [...slugs] };
  const code = changed.filter((p) => EVAL_CODE.includes(p));
  if (code.length) return { mode: 'all', reason: `the evaluation code changed (${code.join(', ')})`, slugs: [...slugs] };
  const touched = new Set(changed.map(skillOfPath).filter(Boolean));
  return { mode: 'changed', reason: touched.size ? 'the skills this change edits' : 'this change edits no skill', slugs: [...slugs].filter((s) => touched.has(s)) };
}

/**
 * The run. `failures` holds one row per finding: skill, case (or "—" for a
 * skill-level one), check and reason. The allowlist rule reads every skill,
 * whatever ran.
 */
export function evaluate({ skills, selected, allowlist }) {
  const failures = [];
  const rows = [];
  const add = (skill, kase, check, reason) => failures.push({ skill, case: kase, check, reason });
  for (const slug of selected) {
    const s = skills.get(slug);
    if (!s) continue;
    if (s.invalid) { add(slug, '—', 'skill_invalid', `${slug}.md is not in the library format.`); continue; }
    let deterministic = 0;
    for (const c of s.cases) {
      const r = runCaseWithoutModel(s, c);
      if (r.deterministic) deterministic += 1;
      for (const f of r.failures) add(slug, r.case, f.check, f.reason);
    }
    rows.push({ slug, cases: s.cases.length, deterministic });
  }
  for (const s of skills.values()) {
    const has = s.cases.some((c) => c.outputs && typeof c.outputs.correct === 'string');
    if (!has && !Object.hasOwn(allowlist, s.slug)) add(s.slug, '—', 'no_deterministic_case', 'The skill has no case a model-free run can judge. Add a scenario pack (skills/scenarios/README.md), or list the skill in scripts/skill-eval-allowlist.json with the reason.');
    if (has && Object.hasOwn(allowlist, s.slug)) add(s.slug, '—', 'allowlist_stale', 'The skill has a deterministic case now. Remove it from scripts/skill-eval-allowlist.json.');
  }
  for (const slug of Object.keys(allowlist)) {
    if (!skills.has(slug)) add(slug, '—', 'allowlist_stale', 'No skill has this slug. Remove it from scripts/skill-eval-allowlist.json.');
    else if (typeof allowlist[slug] !== 'string' || !allowlist[slug].trim()) add(slug, '—', 'allowlist_reason_missing', 'An allowlisted skill needs its reason.');
  }
  return { rows, failures };
}

const cell = (s) => String(s).replace(/[\\|]/g, '\\$&').replace(/\s+/g, ' ');

/** The job summary: what ran, why, and each finding as skill, case and reason. */
export function summaryMarkdown(selection, result, total) {
  const ran = result.rows.reduce((a, r) => a + r.cases, 0);
  const det = result.rows.reduce((a, r) => a + r.deterministic, 0);
  const lines = [
    '### Skill evaluation cases without a model (D8520)',
    '',
    `Ran ${selection.slugs.length} of ${total} skills (${selection.reason}): ${ran} cases, ${det} of them deterministic. No model was called.`,
    '',
  ];
  if (!result.failures.length) return [...lines, 'No finding.', ''].join('\n');
  return [...lines, '| Skill | Case | Check | Reason |', '| --- | --- | --- | --- |',
    ...result.failures.map((f) => `| ${cell(f.skill)} | ${cell(f.case)} | ${cell(f.check)} | ${cell(f.reason)} |`), ''].join('\n');
}

/** The files the diff from `base` to HEAD changes, or null when git cannot diff it (a shallow checkout). */
export function changedFrom(base, cwd = ROOT) {
  if (!base || !/^[\w./-]+$/.test(base)) return null;
  try {
    return execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').map((l) => l.trim()).filter(Boolean);
  } catch { return null; }
}

const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = arg('--dir') ? resolve(arg('--dir')) : join(ROOT, SKILLS_REL);
  const allowPath = arg('--allowlist') ? resolve(arg('--allowlist')) : join(ROOT, ALLOWLIST_REL);
  const allow = existsSync(allowPath) ? readJson(allowPath) : { skills: {} };
  if (!allow || typeof allow.skills !== 'object' || Array.isArray(allow.skills)) {
    console.error(`✖ check-skill-eval-cases: ${allowPath} is not {"skills": {"<slug>": "<reason>"}}.`);
    process.exit(1);
  }
  const skills = readSkills(dir);
  const base = arg('--base') ?? process.env.SKILL_EVAL_BASE ?? process.env.CI_FAILURE_BASE ?? null;
  const selection = selectSkills(changedFrom(base), skills.keys());
  const result = evaluate({ skills, selected: selection.slugs, allowlist: allow.skills });
  const md = summaryMarkdown(selection, result, skills.size);
  if (process.env.GITHUB_STEP_SUMMARY) { try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`); } catch { /* the summary is a courtesy; stdout carries the same */ } }
  for (const f of result.failures) console.error(`✖ ${f.skill} · ${f.case}: ${f.check} — ${f.reason}`);
  const tail = `${selection.slugs.length} of ${skills.size} skills (${selection.reason}), ${result.rows.reduce((a, r) => a + r.cases, 0)} cases, ${result.failures.length} findings; no model called`;
  if (result.failures.length) { console.error(`✖ check-skill-eval-cases: ${tail}.`); process.exit(1); }
  console.log(`✓ check-skill-eval-cases: ${tail}.`);
}
