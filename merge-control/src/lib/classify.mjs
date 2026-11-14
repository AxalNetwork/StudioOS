/**
 * D5607, D5620: the landing-policy classifier, pure and platform-free.
 * The one source of truth: `scripts/merge-policy.mjs` re-exports it for the
 * advisory workflow and `../policy.ts` bundles it into the Merge Control
 * Worker. No imports, no I/O and no model call, so both can load it.
 */

const TEST_FILE = /\.(?:test|spec)\.[^/]+$|(?:^|\/)test_[^/]+\.py$/;
const TEST = /(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.(?:test|spec)\.[^/]+$|(?:^|\/)test_[^/]+\.py$/;
const SENSITIVE = /(?:^|\/)(?:\.github|scripts|merge-control|attached_assets)(?:\/|$)|^cloudflare-worker\/(?:sql|src\/middleware)\/|(?:^|\/)(?:AGENTS\.md|CLAUDE\.md|CODEOWNERS|package[^/]*\.json|wrangler[^/]*\.toml|[^/]*(?:lockfile|\.lock(?:\.json)?|[-_.]lock\.(?:json|yaml|yml)))(?:$|\/)/i;
const SENSITIVE_NAME = /auth|session|permissions?|tenan(?:t|cy)|billing|money|payment|stripe|entitlement|pricing|subscription|cap.?table|fund.?fee|remittance|valuation|sign.?in|mfa|oauth|access.?control|legal.?template/i;
const LEAF_UI = /^frontend\/src\/(?:components|icons|styles)\//;
const ORDINARY = /^(?:cloudflare-worker\/src\/(?:routes|services)|backend\/app\/(?:api\/routes|services)|frontend\/src\/(?:routes|services|pages))\//;
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

function pathPolicy(path, status) {
  if (SENSITIVE.test(path) || SENSITIVE_NAME.test(path)) return ['T2', 'protected path'];
  if (TEST.test(path)) {
    return status === 'A' && TEST_FILE.test(path) ? ['T0', 'added test'] : ['T2', 'existing test or fixture'];
  }
  if (path.startsWith('documentation/') || LEAF_UI.test(path)) return ['T0', 'documentation or leaf UI'];
  if (ORDINARY.test(path)) return ['T1', 'route, service, or page'];
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
    const [level, rule] = pathPolicy(path, code);
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
