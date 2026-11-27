/**
 * D5607, D5620: the landing-policy classifier, pure and platform-free.
 * The one source of truth: `scripts/merge-policy.mjs` re-exports it for the
 * advisory workflow and `../policy.ts` bundles it into the Merge Control
 * Worker. No imports, no I/O and no model call, so both can load it.
 *
 * D6679 (owner answer A on #6679) narrowed T2 in two ways:
 *   · every source folder of the SPA and of the product Worker is named in
 *     ORDINARY, so a file in one is T1 rather than an unmatched path. SENSITIVE
 *     and SENSITIVE_NAME still win: auth, session, permissions, tenancy,
 *     billing, money and the Worker's middleware folder stay protected;
 *   · an edit to an existing test file is T1 when its diff is readable. The
 *     count and skip rules below still raise it to T2 when the file loses a
 *     test or an assertion, or gains a skip, todo or only. Unchanged lines
 *     count the same before and after, so comparing the diff's removed and
 *     added lines is comparing the whole file. Helpers, loaders and fixtures
 *     in a test folder, and a test edit with no diff to read, stay T2.
 */

const TEST_FILE = /\.(?:test|spec)\.[^/]+$|(?:^|\/)test_[^/]+\.py$/;
const TEST = /(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.(?:test|spec)\.[^/]+$|(?:^|\/)test_[^/]+\.py$/;
/**
 * D8067 (#8067): the privileged paths, the one list every gate reads. T2 below, the landing bot's PROTECTED
 * (`scripts/landing-bot/rules.mjs`), the generated CODEOWNERS block and the ruleset's file-path condition
 * (`scripts/check-privileged-paths.mjs`, for #8060) all come from it. Each entry is a gitignore-style glob, so
 * CODEOWNERS and the ruleset take it as written: `**` crosses folders, `*` stays inside one name, and a name also
 * covers everything under a folder of that name. Matching here ignores case; CODEOWNERS does not (D8067).
 */
const LOCK_SUFFIXES = ['-', '_', '.'].flatMap((sep) => ['json', 'yaml', 'yml'].map((ext) => `**/*${sep}lock.${ext}`));
// The product Worker's folder, spelled in parts: Merge Control names its paths as patterns and never imports from
// it, and control.test.ts holds every file here to not even spelling its source folder out (D5618).
const WORKER = ['cloudflare-worker', 'src'].join('/');
export const PRIVILEGED_PATHS = Object.freeze([
  ['**/.github', 'CI workflows, labels, Dependabot and CODEOWNERS: the gates themselves'],
  ['**/scripts', 'the build, check, landing and release scripts every gate runs'],
  ['**/merge-control', 'the Merge Control Worker and this classifier'],
  ['**/attached_assets', 'legal templates, specs and other binary sources'],
  ['cloudflare-worker/sql/**', 'the D1 schema and its migrations'],
  [`${WORKER}/middleware/**`, 'the Worker\'s auth and request middleware'],
  ['**/AGENTS.md', 'the agents\' task protocol'],
  ['**/CLAUDE.md', 'the architecture truth'],
  ['**/CODEOWNERS', 'who reviews what'],
  ['**/.gitattributes', 'merge drivers and the diff and binary rules'],
  ['**/package*.json', 'dependencies and npm scripts'],
  ['**/wrangler*.toml', 'a Worker\'s deploy contract and bindings'],
  ['**/npm-shrinkwrap.json', 'a pinned dependency tree'],
  ['**/*lockfile', 'a pinned dependency tree'],
  ['**/*.lock', 'a pinned dependency tree'],
  ['**/*.lockb', 'a pinned dependency tree'],
  ...LOCK_SUFFIXES.map((glob) => [glob, 'a pinned dependency tree']),
].map(([glob, why]) => Object.freeze({ glob, why })));

/** One glob as a RegExp: `**\/` is any folders or none, a trailing `/**` everything below, `*` one name's part. */
export function globRegExp(glob) {
  const body = glob.replace(/\/\*\*$/, '\u0001').replace(/^\*\*\//, '\u0002').split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*');
  const re = body.replace('\u0002', '(?:.*/)?').replace('\u0001', '/.+');
  return new RegExp(`^${re}${glob.endsWith('/**') ? '' : '(?:/.+)?'}$`, 'i');
}
export const PRIVILEGED = Object.freeze(PRIVILEGED_PATHS.map(({ glob }) => globRegExp(glob)));
/** Whether a path is privileged; an unreadable path is. */
export const isPrivileged = (path) => typeof path !== 'string' || !path || PRIVILEGED.some((re) => re.test(path));
/** The changed files (and renames' old paths) that are privileged, sorted. */
export function privilegedFiles(files) {
  const hit = new Set();
  for (const f of files ?? []) for (const p of [f?.path, f?.previousPath]) if (p !== undefined && isPrivileged(p)) hit.add(String(p));
  return [...hit].sort();
}
const SENSITIVE_NAME = /auth|session|permissions?|tenan(?:t|cy)|billing|money|payment|stripe|entitlement|pricing|subscription|cap.?table|fund.?fee|remittance|valuation|sign.?in|mfa|oauth|access.?control|legal.?template/i;
const LEAF_UI = /^frontend\/src\/(?:components|icons|styles)\//;
const ORDINARY = /^(?:cloudflare-worker\/src\/(?:agents|contracts|data|durable-objects|integrations|mcp|models|probes|routes|rpc|services|templates|util)|backend\/app\/(?:api\/routes|services)|frontend\/src\/(?:brand|contexts|data|decks|hooks|lib|pages|routes|services|templates|ui|workspaces))\//;
const LINK_MODES = new Set(['120000', '160000']);
const BASELINE_DIRECTORY = /(?:^|\/)scripts\/baselines\//i;
const BASELINE_FILENAME = /[-_.](?:baseline|ledger)\.json$/i;
const RESTRICTED_TEST = /(?:\.\s*|\b)(?:skip|todo|only)\s*(?:\(|:\s*(?!false\b))/;
const TIMEOUT = /(?:\b[\w-]*timeout[\w-]*\b)/i;
const TEST_CALL = /\b(?:test|it)\s*\(/g;
const ASSERTION = /\b(?:assert|expect)\s*(?=[.(])/g;

function changedLines(patch) {
  const added = [];
  const removed = [];
  let hunk = false;
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) hunk = false;
    if (line.startsWith('@@ ')) hunk = true;
    if (!hunk) continue;
    if (line.startsWith('+')) added.push(line.slice(1));
    if (line.startsWith('-')) removed.push(line.slice(1));
  }
  return { added: added.join('\n'), removed: removed.join('\n') };
}

/** A diff with at least one hunk: the count rules have something to compare. */
const readable = (patch) => /^@@ /m.test(patch);

function pathPolicy(path, status, patch = '') {
  if (isPrivileged(path) || SENSITIVE_NAME.test(path)) return ['T2', 'protected path'];
  if (TEST.test(path)) {
    if (!TEST_FILE.test(path)) return ['T2', 'test helper or fixture'];
    if (status === 'A') return ['T0', 'added test'];
    if (status === 'M' && readable(patch)) return ['T1', 'edited test, counts checked'];
    return ['T2', 'existing test without a readable diff'];
  }
  if (path.startsWith('documentation/') || LEAF_UI.test(path)) return ['T0', 'documentation or leaf UI'];
  if (ORDINARY.test(path)) return ['T1', 'named source folder'];
  return ['T2', 'unmatched path'];
}

export function classify(files) {
  let tier = 'T0';
  const reasons = new Set();
  const record = (level, reason) => {
    if (level > tier) tier = level;
    reasons.add(reason);
  };

  if (!files.length) record('T2', 'No changed files were available for classification.');
  for (const { path, status, previousPath, mode, patch = '' } of files) {
    const code = status[0];
    const [level, rule] = pathPolicy(path, code, patch);
    record(level, `${level}: ${rule}: ${path}`);
    if (previousPath) {
      const [previousLevel, previousRule] = pathPolicy(previousPath, code);
      record(previousLevel, `${previousLevel}: ${previousRule}: previous path ${previousPath}`);
    }
    if (!'ACDMR'.includes(code) || !code) record('T2', `Unsupported change status: ${path}`);
    if ([path, previousPath].some((file) =>
      file && (BASELINE_DIRECTORY.test(file) || BASELINE_FILENAME.test(file)))) {
      record('T2', `Test baseline or ledger changed: ${path}`);
    }
    const test = TEST.test(path) || (previousPath && TEST.test(previousPath));
    if (test && (code === 'D' || code === 'R')) record('T2', `Test deleted or renamed: ${path}`);

    const { added, removed } = changedLines(patch);
    if (path === 'scripts/test-drift-parts.mjs' && /\bSHARDS\b/.test(patch)) {
      record('T2', `Suite shard declaration changed: ${path}`);
    }
    if (LINK_MODES.has(mode)) record('T2', `Link or submodule present: ${path}`);
    if (/^Binary files .* differ$/m.test(patch)) record('T2', `Binary content changed: ${path}`);
    if (TIMEOUT.test(added) || TIMEOUT.test(removed)) record('T2', `Timeout changed: ${path}`);
    if (test && RESTRICTED_TEST.test(added)) record('T2', `Test skip, todo or only added: ${path}`);
    if (test && [TEST_CALL, ASSERTION].some((pattern) =>
      [...added.matchAll(pattern)].length < [...removed.matchAll(pattern)].length)) {
      record('T2', `Test or assertion count dropped: ${path}`);
    }
  }
  return { tier, reasons: [...reasons].sort() };
}
