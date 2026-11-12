/** D5602: scan admission and opaque, unsuppressed finding state; no network or issue writes. */
import { createHash } from 'node:crypto';

export const SCAN_FILE_CAP = 3000;
export const SCANNERS = Object.freeze(['codeql', 'semgrep']);
export const SCAN_ALERT_TITLE = '[alert] a scan found something new on main';
const LOCKFILE = /(?:^|\/)(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|uv\.lock|poetry\.lock|Pipfile\.lock|Cargo\.lock|Gemfile\.lock|composer\.lock|packages\.lock\.json)$/;
export function sensitiveScanPath(path) {
  return typeof path === 'string' && (path.startsWith('cloudflare-worker/sql/')
    || path === 'cloudflare-worker/src/auth.ts' || path.startsWith('cloudflare-worker/src/middleware/')
    || path.startsWith('.github/') || /^wrangler[^/]*\.toml$/.test(path) || LOCKFILE.test(path)
    || ['.semgrepignore', 'scripts/sarif-summary.py', 'scripts/strip-suppressed-sarif.py'].includes(path));
}

/** Unknown/incomplete PR inventories scan. Renames check both the old and new path. */
export function scanScope({ event, labels = [], files, truncated = false }) {
  if (event === 'push' || event === 'schedule') return true;
  if (event !== 'pull_request') return false;
  if (labels.some(label => (typeof label === 'string' ? label : label?.name) === 'security-scan')) return true;
  if (truncated || !Array.isArray(files) || files.length >= SCAN_FILE_CAP) return true;
  return files.some(file => typeof file === 'string' ? sensitiveScanPath(file)
    : !file || typeof file.filename !== 'string' || sensitiveScanPath(file.filename) || sensitiveScanPath(file.previous_filename));
}

const ruleOk = value => typeof value === 'string' && /^[\w@./:+-]{1,240}$/.test(value);
const hashOk = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function findingSnapshot(sarifs) {
  if (!Array.isArray(sarifs) || !sarifs.length) throw new Error('Missing SARIF');
  const found = new Map();
  for (const sarif of sarifs) {
    if (!Array.isArray(sarif?.runs) || !sarif.runs.length) throw new Error('Invalid SARIF runs');
    for (const run of sarif.runs) {
      if (!Array.isArray(run.results)) throw new Error('Unreadable SARIF results');
      for (const result of run.results) {
        if (Array.isArray(result.suppressions) && result.suppressions.length) continue;
        const rule = result.ruleId;
        const uri = result.locations?.[0]?.physicalLocation?.artifactLocation?.uri;
        if (!ruleOk(rule) || typeof uri !== 'string' || !uri || uri.length > 4096) throw new Error('Finding identity is unavailable');
        const fingerprint = createHash('sha256').update(rule).update('\0').update(uri).digest('hex');
        found.set(fingerprint, { fingerprint, rule });
      }
    }
  }
  return [...found.values()].sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
}

export function validateFindings(rows) {
  if (!Array.isArray(rows) || rows.length > 100000) throw new Error('Invalid finding inventory');
  const seen = new Set();
  for (const row of rows) {
    if (!row || !hashOk(row.fingerprint) || !ruleOk(row.rule) || seen.has(row.fingerprint)) throw new Error('Invalid finding identity');
    seen.add(row.fingerprint);
  }
  return rows;
}

/** Retain introduced findings until resolved, without turning a lost baseline into a clean scan. */
export function advanceScan(current, previous) {
  validateFindings(current);
  if (previous === null) return { version: 1, current, open: [], baseline: false };
  if (previous?.version !== 1) throw new Error('Unknown scan-state version');
  validateFindings(previous.current); validateFindings(previous.open);
  const old = new Set(previous.current.map(row => row.fingerprint));
  const outstanding = new Set(previous.open.map(row => row.fingerprint));
  return { version: 1, current, open: current.filter(row => !old.has(row.fingerprint) || outstanding.has(row.fingerprint)), baseline: true };
}

export function ruleCounts(rows) {
  validateFindings(rows);
  const counts = new Map();
  for (const { rule } of rows) counts.set(rule, (counts.get(rule) || 0) + 1);
  return Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b)));
}

export function scanFacts(value) {
  if (!SCANNERS.includes(value?.scanner) || typeof value.baseline !== 'boolean'
    || !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/[1-9]\d*$/.test(value.runUrl)
    || !value.counts || Array.isArray(value.counts) || typeof value.counts !== 'object'
    || Object.entries(value.counts).some(([rule, count]) => !ruleOk(rule) || !Number.isSafeInteger(count) || count < 1)) {
    throw new Error('Invalid public scan facts');
  }
  return value;
}

/** The issue contains only run links and counts, including each scanner's last unresolved state. */
export function scanAlertBody(states) {
  return '<!-- studioos-scan-alert:v1 -->\n' + SCANNERS.filter(scanner => states[scanner]).map(scanner => {
    const facts = scanFacts(states[scanner]);
    const rows = Object.entries(facts.counts).map(([rule, count]) => `| \`${rule}\` | ${count} |`).join('\n');
    return `## ${scanner}\n\n${facts.runUrl}\n\n| Rule | Unresolved new fingerprints |\n|---|---:|\n${rows}\n`;
  }).join('\n');
}

export function readScanAlert(body) {
  if (!body?.startsWith('<!-- studioos-scan-alert:v1 -->\n')) throw new Error('Unknown scan alert state');
  const states = {};
  for (const section of body.split(/^## /m).slice(1)) {
    const scanner = section.split('\n')[0];
    if (!SCANNERS.includes(scanner) || states[scanner]) throw new Error('Invalid scanner state');
    const runUrl = section.split('\n').find(line => line.startsWith('https://'));
    const counts = Object.create(null);
    for (const line of section.split('\n').filter(line => line.startsWith('| `'))) {
      const match = /^\| `([\w@./:+-]+)` \| ([1-9]\d*) \|$/.exec(line);
      if (!match || Object.hasOwn(counts, match[1])) throw new Error('Invalid scan count');
      counts[match[1]] = Number(match[2]);
    }
    states[scanner] = scanFacts({ scanner, runUrl, counts, baseline: true });
  }
  if (!Object.keys(states).length || scanAlertBody(states) !== body) throw new Error('Unreadable scan alert state');
  return states;
}
