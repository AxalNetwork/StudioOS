#!/usr/bin/env node
/**
 * D8079 (#8079): every agent the platform runs is declared in one reviewed file,
 * `agents/<name>.agent.yml`, and this guard checks each one against the schema
 * in `agents/README.md`.
 *
 * Refusals (each prints its code, and each has a fixture in
 * `frontend/test/agent_manifests_8079.test.mjs`):
 *   prod_deploy            a capability that is a production deploy: `prod:deploy`
 *                          or `deploy.production`, by name or by a wildcard that covers it.
 *   capability_ungrantable one of #8070's names a person does (`code.merge`,
 *                          `cloud.write`, `finance.execute`, `email.send`), by name or wildcard.
 *   capability_unknown     a name outside the catalogue below, or a wildcard that matches none.
 *   privileged_path        a venture agent's `allowed_paths` entry that can match a path
 *                          on #8067's privileged list (PRIVILEGED_PATHS below).
 *   approval_required      an agent holding an email, introduction or payment capability
 *                          whose `approval.external_actions` is not `required`.
 *   schema                 anything else the README's schema does not allow.
 *
 * YAML is read with `yaml`, the parser the tree already pins as a dev dependency
 * (check-production-credentials.mjs reads workflows with it), with aliases off
 * and duplicate keys refused. No new dependency.
 *
 *   node scripts/check-agent-manifests.mjs [--dir <folder>]   (default: agents)
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/**
 * #8070's capability names, as its issue text lists them on 2026-11-21. Grantable
 * to an agent. #8070's catalogue table (`capability_catalog`) is to carry the same set.
 */
export const CAPABILITIES_8070 = Object.freeze([
  'research.read', 'research.write', 'company.read', 'company.write', 'fund.read',
  'relationships.read', 'relationships.request-introduction',
  'code.read', 'code.branch', 'code.commit', 'code.pr',
  'deploy.preview', 'deploy.staging', 'cloud.read', 'finance.read',
  'legal.read', 'legal.draft', 'email.read', 'email.draft', 'web.search',
]);

/**
 * The repository actions the seed agents already take and #8070's list does not
 * name, each grounded in a workflow permission or a script call (D8079 § Names).
 * Proposed to #8070 for its catalogue; until then they are valid here only.
 */
export const CAPABILITIES_8079 = Object.freeze([
  'issue.read',     // read issues and PR conversations (issues: read)
  'issue.write',    // comment on and label issues and PRs, open and close issues (issues: write)
  'ci.read',        // read Actions runs, jobs, checks and artifacts (actions: read, checks: read)
  'ci.dispatch',    // dispatch a workflow on main (actions: write; `gh workflow run`)
  'code.enqueue',   // ask the merge queue to take a PR; the queue merges it, never the agent
  'security.read',  // read code scanning alerts (security-events: read)
]);

/**
 * Names that exist and are never grantable to an agent: a person does them (#8070).
 * `prod:deploy` is the audit's spelling of `deploy.production` (#8079).
 */
export const PROD_DEPLOY = Object.freeze(['prod:deploy', 'deploy.production']);
export const UNGRANTABLE = Object.freeze(['code.merge', 'deploy.production', 'cloud.write', 'finance.execute', 'email.send']);

/** Capabilities whose use reaches outside the platform: approval is always required (#8079). */
const EXTERNAL = /^(?:email\.|relationships\.request-introduction$|finance\.)/;

const CATALOGUE = Object.freeze([...CAPABILITIES_8070, ...CAPABILITIES_8079]);
const RESERVED = Object.freeze([...new Set([...UNGRANTABLE, ...PROD_DEPLOY])]);

/**
 * #8067's privileged path list, written as globs. #8067 moves it to
 * `scripts/lib/privilegedPaths.mjs`; until that lands this is the one copy here,
 * taken from what decides a privileged change on main today: the landing bot's
 * PROTECTED (`scripts/landing-bot/rules.mjs`) and merge-policy's T2 path rule
 * SENSITIVE (`merge-control/src/lib/classify.mjs`). Its keyword rule
 * (SENSITIVE_NAME: auth, billing, …) tiers a PR by a word in a path; it names no
 * location and is not on this list. Matching ignores case, as SENSITIVE does.
 * When #8067 lands, this constant imports its list instead; the test that compares
 * it with PROTECTED and SENSITIVE stays.
 */
export const PRIVILEGED_PATHS = Object.freeze([
  '**/.github/**',               // workflows, CODEOWNERS, labels, templates (PROTECTED, SENSITIVE)
  '**/scripts/**',               // build, deploy and CI guards (SENSITIVE; PROTECTED names scripts/ci/)
  '**/merge-control/**',         // the merge-queue Worker (PROTECTED, SENSITIVE)
  '**/attached_assets/**',       // legal templates and specs (SENSITIVE)
  'cloudflare-worker/sql/**',    // D1 schema and migrations (PROTECTED, SENSITIVE)
  'cloudflare-worker/src/middleware/**', // the Worker's auth middleware (SENSITIVE)
  '**/AGENTS.md',                // agent rules (PROTECTED at the root, SENSITIVE anywhere)
  '**/CLAUDE.md',                // architecture truth (PROTECTED at the root, SENSITIVE anywhere)
  '**/CODEOWNERS',               // review routing (PROTECTED, SENSITIVE)
  '**/.gitattributes',           // merge drivers (PROTECTED)
  '**/package*.json',            // manifests and npm lockfiles (PROTECTED, SENSITIVE)
  '**/npm-shrinkwrap.json',      // npm lockfile (PROTECTED)
  '**/yarn.lock', '**/pnpm-lock.yaml', '**/bun.lock', '**/bun.lockb', // lockfiles (PROTECTED)
  '**/*.lock',                   // any lockfile (PROTECTED, SENSITIVE)
  '**/*lockfile', '**/*lockfile/**', // lockfiles by name (SENSITIVE)
  '**/*.lock.json', '**/*-lock.json', '**/*_lock.json', '**/*.lock.yaml', '**/*-lock.yaml',
  '**/*_lock.yaml', '**/*.lock.yml', '**/*-lock.yml', '**/*_lock.yml', // lock data (SENSITIVE)
  '**/wrangler*.toml',           // Worker configuration (PROTECTED, SENSITIVE)
]);

export const KINDS = Object.freeze(['platform', 'venture']);
/** #8061's three Apps, a slot session, or the workflow's own token. */
export const IDENTITIES = Object.freeze(['studioos-landing-bot', 'studioos-agent-publisher', 'studioos-coordinator', 'session', 'github-actions']);
export const RUNNER_POOLS = Object.freeze(['trusted', 'untrusted', 'none']);
export const MODEL_ROUTES = Object.freeze(['gateway', 'direct', 'none']);
export const STATUSES = Object.freeze(['live', 'paused', 'retired']);
export const LIMITS = Object.freeze(['runtime', 'tokens', 'parallel_tasks', 'child_agents', 'prs']);
const KEYS = Object.freeze(['name', 'kind', 'owner', 'identity', 'capabilities', 'models', 'resources', 'limits',
  'network', 'allowed_paths', 'runner_pool', 'approval', 'escalation', 'status', 'sources']);

const SLOT = /^(?:S\d{2}|chatgptpro)$/;
const OWNER = /^(?:S\d{2}|chatgptpro|owner|role:[a-z][a-z-]*)$/;
const ESCALATION = /^(?:S\d{2}|chatgptpro|owner)$/;
const NAME = /^[a-z][a-z0-9-]*$/;
const CAPABILITY = /^(?:\*|[a-z]+\.(?:\*|[a-z][a-z-]*)|[a-z]+:[a-z][a-z-]*)$/;
const MODEL_KEY = /^[a-z0-9][a-z0-9._:/@-]*$/i;
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const MEMORY = /^[1-9]\d*(?:MiB|GiB)$/;
const GLOB_CHARS = /^[A-Za-z0-9._\-/*?@+]+$/;

// ── Globs ────────────────────────────────────────────────────────────────────
// A glob here has `*` (any characters but `/`), `**` (any whole segments, none
// included) and `?` (one character but `/`). Nothing else is special; braces,
// classes and negation are refused by the schema, so every entry reads one way.

/** A glob as alternatives of tokens: a character, S (= [^/]*), A (= .*), Q (= [^/]). */
function tokenize(glob) {
  const g = glob.toLowerCase();
  let alternatives = [[]];
  for (let i = 0; i < g.length; i++) {
    if (g.startsWith('**/', i) && (i === 0 || g[i - 1] === '/')) {
      // `**/` is any run of whole segments, possibly none: nothing, or A then `/`.
      alternatives = alternatives.flatMap((t) => [t, [...t, 'A', '=/']]);
      i += 2;
    } else if (g.startsWith('**', i)) { alternatives = alternatives.map((t) => [...t, 'A']); i += 1; }
    else if (g[i] === '*') alternatives = alternatives.map((t) => [...t, 'S']);
    else if (g[i] === '?') alternatives = alternatives.map((t) => [...t, 'Q']);
    else alternatives = alternatives.map((t) => [...t, `=${g[i]}`]);
  }
  return alternatives;
}

const isStar = (t) => t === 'S' || t === 'A';
/** Can token `t` (a single-character token) produce the character produced by `u`? */
function oneChar(t, u) {
  if (t === 'Q' && u === 'Q') return true;
  if (t === 'Q') return u !== '=/';
  if (u === 'Q') return t !== '=/';
  return t === u;
}

/** Whether two token lists match at least one common path. */
function tokensMeet(p, q) {
  const seen = new Map();
  const go = (i, j) => {
    const key = i * 4096 + j;
    if (seen.has(key)) return seen.get(key);
    seen.set(key, false);
    let out = false;
    if (i === p.length && j === q.length) out = true;
    else if (i < p.length && isStar(p[i]) && go(i + 1, j)) out = true;
    else if (j < q.length && isStar(q[j]) && go(i, j + 1)) out = true;
    else if (i < p.length && j < q.length) {
      const a = p[i]; const b = q[j];
      if (isStar(a) && !isStar(b)) out = (a === 'A' || b !== '=/') && go(i, j + 1);
      else if (isStar(b) && !isStar(a)) out = (b === 'A' || a !== '=/') && go(i + 1, j);
      else if (isStar(a) && isStar(b)) out = false; // either may stop first: the two branches above cover it
      else out = oneChar(a, b) && go(i + 1, j + 1);
    }
    seen.set(key, out);
    return out;
  };
  return go(0, 0);
}

/** Whether some path matches both globs (case ignored). */
export function globsMeet(a, b) {
  return tokenize(a).some((p) => tokenize(b).some((q) => tokensMeet(p, q)));
}

/** Whether `path` matches `glob` (case ignored). A path is a glob with no wildcard. */
export const globMatches = (glob, path) => globsMeet(glob, path.replace(/[*?]/g, '_'));

/** The privileged globs an `allowed_paths` entry can reach. */
export const privilegedHits = (glob) => PRIVILEGED_PATHS.filter((p) => globsMeet(glob, p));

// ── Capabilities ─────────────────────────────────────────────────────────────

/** The names a capability entry stands for: itself, or the catalogue and reserved names a wildcard covers. */
function expand(cap) {
  if (cap === '*') return [...CATALOGUE, ...RESERVED];
  if (cap.endsWith('.*')) {
    const domain = cap.slice(0, -1);
    return [...CATALOGUE, ...RESERVED].filter((n) => n.startsWith(domain));
  }
  return [cap];
}

// ── The schema ───────────────────────────────────────────────────────────────

const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isList = (v) => Array.isArray(v);
const isCount = (v) => Number.isSafeInteger(v) && v >= 0;

/**
 * The refusals for one parsed manifest, as `[{ code, message }]`; empty when it is valid.
 * @param doc the parsed YAML
 * @param stem the file name without `.agent.yml`
 * @param exists (path) => boolean, for `sources`; defaults to the repository root
 */
export function validateManifest(doc, stem, exists = (p) => existsSync(join(ROOT, p))) {
  const out = [];
  const no = (code, message) => out.push({ code, message });
  const schema = (message) => no('schema', message);
  if (!isMap(doc)) { schema('the file is not a mapping'); return out; }

  for (const key of Object.keys(doc)) if (!KEYS.includes(key)) schema(`unknown key \`${key}\``);
  for (const key of KEYS) if (!(key in doc)) schema(`missing \`${key}\``);

  const { name, kind, owner, identity, capabilities, models, resources, limits, network,
    allowed_paths: allowedPaths, runner_pool: runnerPool, approval, escalation, status, sources } = doc;

  if ('name' in doc && (typeof name !== 'string' || !NAME.test(name))) schema('`name` is lower-case letters, digits and hyphens');
  else if ('name' in doc && name !== stem) schema(`\`name\` is \`${name}\` but the file is \`${stem}.agent.yml\``);
  if ('kind' in doc && !KINDS.includes(kind)) schema(`\`kind\` is one of ${KINDS.join(', ')}`);
  if ('owner' in doc && !(typeof owner === 'string' && OWNER.test(owner))) schema('`owner` is a slot (S01…, chatgptpro), `owner` or `role:<name>`');
  if ('identity' in doc && !IDENTITIES.includes(identity)) schema(`\`identity\` is one of ${IDENTITIES.join(', ')}`);
  if ('runner_pool' in doc && !RUNNER_POOLS.includes(runnerPool)) schema(`\`runner_pool\` is one of ${RUNNER_POOLS.join(', ')}`);
  if ('escalation' in doc && !(typeof escalation === 'string' && ESCALATION.test(escalation))) schema('`escalation` is a slot or `owner`');
  if ('status' in doc && !STATUSES.includes(status)) schema(`\`status\` is one of ${STATUSES.join(', ')}`);
  if ('owner' in doc && kind === 'venture' && typeof owner === 'string' && SLOT.test(owner)) {
    schema('a venture agent is owned by `owner` or a `role:`, not a platform slot');
  }

  // capabilities
  const granted = [];
  if ('capabilities' in doc) {
    if (!isList(capabilities)) schema('`capabilities` is a list');
    else {
      const seen = new Set();
      for (const cap of capabilities) {
        if (typeof cap !== 'string' || !CAPABILITY.test(cap)) { schema(`capability \`${String(cap)}\` is not \`<domain>.<action>\` or \`<domain>.*\``); continue; }
        if (seen.has(cap)) schema(`capability \`${cap}\` is listed twice`);
        seen.add(cap);
        const names = expand(cap);
        const prod = names.filter((n) => PROD_DEPLOY.includes(n));
        const reserved = names.filter((n) => RESERVED.includes(n) && !PROD_DEPLOY.includes(n));
        if (prod.length) no('prod_deploy', `\`${cap}\` grants a production deploy (${prod.join(', ')}); no agent deploys to production (#8070, #8079)`);
        if (reserved.length) no('capability_ungrantable', `\`${cap}\` covers ${reserved.join(', ')}, which a person does and no agent is granted (#8070)`);
        if (prod.length || reserved.length) continue;
        if (!names.length || names.some((n) => !CATALOGUE.includes(n))) {
          no('capability_unknown', `\`${cap}\` is not in the catalogue (#8070's names and D8079's additions)`);
          continue;
        }
        granted.push(...names);
      }
    }
  }

  // models
  if ('models' in doc) {
    if (!isMap(models)) schema('`models` is a mapping: `route`, `allowed`');
    else {
      for (const key of Object.keys(models)) if (!['route', 'allowed'].includes(key)) schema(`unknown key \`models.${key}\``);
      if (!MODEL_ROUTES.includes(models.route)) schema(`\`models.route\` is one of ${MODEL_ROUTES.join(', ')}`);
      if (!isList(models.allowed) || models.allowed.some((m) => typeof m !== 'string' || !MODEL_KEY.test(m))) schema('`models.allowed` is a list of model keys');
      else if (models.route === 'none' && models.allowed.length) schema('`models.route: none` takes an empty `models.allowed`');
      else if (models.route !== 'none' && !models.allowed.length) schema(`\`models.route: ${models.route}\` names at least one model key`);
    }
  }

  // resources
  if ('resources' in doc) {
    if (!isMap(resources) || Object.keys(resources).some((k) => !['cpu', 'memory'].includes(k)) || !('cpu' in resources) || !('memory' in resources)) {
      schema('`resources` is a mapping of `cpu` and `memory`');
    } else {
      const none = [resources.cpu, resources.memory].filter((v) => v === 'none').length;
      if (none === 1) schema('`resources.cpu` and `resources.memory` are both `none` (no container) or both set');
      if (none === 0 && !(typeof resources.cpu === 'number' && resources.cpu > 0)) schema('`resources.cpu` is a number of vCPUs, or `none`');
      if (none === 0 && !(typeof resources.memory === 'string' && MEMORY.test(resources.memory))) schema('`resources.memory` is like `512MiB` or `4GiB`, or `none`');
    }
  }

  // limits
  if ('limits' in doc) {
    if (!isMap(limits)) schema('`limits` is a mapping');
    else {
      for (const key of Object.keys(limits)) if (!LIMITS.includes(key)) schema(`unknown key \`limits.${key}\``);
      for (const key of LIMITS) {
        if (!(key in limits)) schema(`missing \`limits.${key}\``);
        else if (!(isCount(limits[key]) || limits[key] === 'none')) schema(`\`limits.${key}\` is a whole number, or \`none\` when no cap is set`);
      }
    }
  }

  // network
  if ('network' in doc) {
    if (!isMap(network) || Object.keys(network).some((k) => !['internet', 'egress'].includes(k))) schema('`network` is a mapping: `internet`, `egress`');
    else {
      if (typeof network.internet !== 'boolean') schema('`network.internet` is true or false');
      if (!isList(network.egress) || network.egress.some((h) => typeof h !== 'string' || !HOST.test(h))) schema('`network.egress` is a list of host names');
    }
  }

  // allowed_paths
  if ('allowed_paths' in doc) {
    if (!isList(allowedPaths)) schema('`allowed_paths` is a list of globs (empty: writes no file)');
    else {
      for (const glob of allowedPaths) {
        if (typeof glob !== 'string' || !glob || !GLOB_CHARS.test(glob) || glob.startsWith('/') || /(?:^|\/)\.\.(?:\/|$)/.test(glob) || /\*\*\*/.test(glob)) {
          schema(`\`allowed_paths\` entry \`${String(glob)}\` is a repository-relative glob of names, \`*\`, \`**\` and \`?\``);
          continue;
        }
        if (kind === 'venture') {
          const hits = privilegedHits(glob);
          if (hits.length) no('privileged_path', `\`${glob}\` can reach privileged path${hits.length > 1 ? 's' : ''} ${hits.map((h) => `\`${h}\``).join(', ')} (#8067); a venture agent never writes there`);
        }
      }
    }
  }

  // approval
  if ('approval' in doc) {
    if (!isMap(approval) || Object.keys(approval).some((k) => k !== 'external_actions') || !['required', 'not-required'].includes(approval.external_actions)) {
      schema('`approval` is `{ external_actions: required | not-required }`');
    } else if (approval.external_actions !== 'required') {
      const external = granted.filter((c) => EXTERNAL.test(c));
      if (external.length) no('approval_required', `${external.join(', ')} send email, ask for an introduction or move money: \`approval.external_actions\` is \`required\``);
    }
  }

  // sources
  if ('sources' in doc) {
    if (!isList(sources) || !sources.length) schema('`sources` lists the files that run this agent');
    else for (const src of sources) {
      if (typeof src !== 'string' || !src || src.startsWith('/') || src.includes('..')) schema(`\`sources\` entry \`${String(src)}\` is a repository-relative path`);
      else if (!exists(src)) schema(`\`sources\` names \`${src}\`, which does not exist`);
    }
  }
  return out;
}

/** Parse one manifest's text; a YAML error is a `schema` refusal. */
export function readManifest(text) {
  try {
    return { doc: parse(text, { uniqueKeys: true, maxAliasCount: 0, prettyErrors: false, strict: true }), error: null };
  } catch (e) {
    return { doc: null, error: String(e?.message ?? e).split('\n')[0] };
  }
}

/**
 * Check every file in `dir`. Returns `{ files, problems: [{ file, code, message }] }`.
 * The folder holds `README.md` and `*.agent.yml` only, so a misspelt extension is
 * refused rather than skipped.
 */
export function checkFolder(dir, exists) {
  const problems = [];
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return { files: [], problems: [{ file: dir, code: 'schema', message: 'the agents folder does not exist' }] };
  }
  const files = [];
  const names = new Map();
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === 'README.md') continue;
    if (!entry.isFile() || !entry.name.endsWith('.agent.yml')) {
      problems.push({ file: entry.name, code: 'schema', message: 'the agents folder holds README.md and `<name>.agent.yml` files only' });
      continue;
    }
    files.push(entry.name);
    const stem = entry.name.slice(0, -'.agent.yml'.length);
    const { doc, error } = readManifest(readFileSync(join(dir, entry.name), 'utf8'));
    if (error) { problems.push({ file: entry.name, code: 'schema', message: `unreadable YAML: ${error}` }); continue; }
    for (const p of validateManifest(doc, stem, exists)) problems.push({ file: entry.name, ...p });
    const key = String(doc?.name ?? stem).toLowerCase();
    if (names.has(key)) problems.push({ file: entry.name, code: 'schema', message: `the name \`${key}\` is already declared by ${names.get(key)}` });
    names.set(key, entry.name);
  }
  if (!files.length) problems.push({ file: dir, code: 'schema', message: 'no `*.agent.yml` manifest found' });
  return { files, problems };
}

function main() {
  const at = process.argv.indexOf('--dir');
  const dir = resolve(process.cwd(), at > -1 ? process.argv[at + 1] ?? '' : join(ROOT, 'agents'));
  const { files, problems } = checkFolder(dir);
  const shown = relative(process.cwd(), dir) || '.';
  if (problems.length) {
    console.error(`✖ check-agent-manifests (${shown}):\n${problems.map((p) => `  - ${p.file}: ${p.code}: ${p.message}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`✓ check-agent-manifests: ${files.length} manifest(s) in ${shown} valid (D8079).`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
