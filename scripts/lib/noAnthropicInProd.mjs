import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

export const ANTHROPIC_REFERENCE = /anthropic\.com|claude-[a-z0-9-]+|ANTHROPIC/;

/** Files whose Anthropic references are deliberate and reviewed. No marker-based escape hatch. */
export const ANTHROPIC_REFERENCE_ALLOWLIST = new Set([
  'cloudflare-worker/src/index.ts',
  'cloudflare-worker/src/routes/assistant.ts',
  'cloudflare-worker/src/routes/auth.ts',
  'cloudflare-worker/src/routes/dashboard.ts',
  'cloudflare-worker/src/types.ts',
  // D851: provider catalogue, execution service and adapter. The provider is off by default.
  'cloudflare-worker/src/services/ai/catalogue.ts',
  'cloudflare-worker/src/services/ai/providers/anthropic.ts',
  'cloudflare-worker/src/services/aiProviders.ts',
]);

const FORBIDDEN_ADVISOR_IMPORTS = [
  'services/aiProviders.ts',
  'services/ai/providers/',
];

function walkTs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort().flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walkTs(path) : path.endsWith('.ts') ? [path] : [];
  });
}

export function importsOf(file, srcRoot) {
  const source = readFileSync(file, 'utf8');
  const imports = [];
  const pattern = /(?:import|export)\s[^'\"]*?from\s*['\"](\.[^'\"]+)['\"]|import\s*\(?\s*['\"](\.[^'\"]+)['\"]/g;
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1] ?? match[2];
    const base = resolve(dirname(file), specifier);
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
      if (!existsSync(candidate) || !statSync(candidate).isFile()) continue;
      const inside = relative(srcRoot, candidate);
      if (inside && !inside.startsWith('..')) imports.push(candidate);
      break;
    }
  }
  return imports;
}

export function reachableFrom(entries, srcRoot) {
  const seen = new Set();
  const queue = [...entries];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    queue.push(...importsOf(file, srcRoot));
  }
  return seen;
}

export function defaultAdvisorEntries(srcRoot) {
  return [
    join(srcRoot, 'routes/advisor.ts'),
    join(srcRoot, 'routes/_advisor_cohort_helpers.ts'),
    join(srcRoot, 'routes/admin_advisor_audit.ts'),
    ...walkTs(join(srcRoot, 'services/advisor')),
  ];
}

function lineHits(source) {
  return source.split('\n').flatMap((line, index) => ANTHROPIC_REFERENCE.test(line)
    ? [{ line: index + 1, text: line.trim().slice(0, 160) }]
    : []);
}

export function assistantGateFindings(indexSource) {
  const use = indexSource.indexOf("app.use('/api/assistant/*'");
  const mount = indexSource.indexOf("app.route('/api/assistant', assistantRoutes)");
  if (use < 0 || mount < 0 || use > mount) {
    return [{ kind: 'assistant_gate', file: 'cloudflare-worker/src/index.ts', detail: 'the assistant route is not preceded by its /api/assistant/* middleware' }];
  }
  const gate = indexSource.slice(use, mount);
  const requirements = [
    ["env.STAGE === 'production'", 'STAGE=production is refused'],
    ["env.ENVIRONMENT === 'production'", 'ENVIRONMENT=production is refused'],
    ["env.ENABLE_ANTHROPIC_DEV !== '1'", 'ENABLE_ANTHROPIC_DEV must be exactly 1'],
    ["return c.json({ error: 'not_found' }, 404)", 'closed mounts return not_found'],
    ['await next()', 'the middleware advances only after the checks'],
  ];
  return requirements.flatMap(([needle, detail]) => gate.includes(needle)
    ? []
    : [{ kind: 'assistant_gate', file: 'cloudflare-worker/src/index.ts', detail }]);
}

export function auditNoAnthropicInProduction({ root = process.cwd(), entries, allowlist = ANTHROPIC_REFERENCE_ALLOWLIST } = {}) {
  const srcRoot = join(root, 'cloudflare-worker/src');
  const findings = [];

  for (const file of walkTs(srcRoot)) {
    const repoPath = relative(root, file).replaceAll('\\', '/');
    const hits = lineHits(readFileSync(file, 'utf8'));
    if (hits.length && !allowlist.has(repoPath)) findings.push({ kind: 'reference', file: repoPath, hits });
  }
  for (const repoPath of allowlist) {
    const file = join(root, repoPath);
    if (!existsSync(file)) findings.push({ kind: 'stale_allowlist', file: repoPath, detail: 'allowlisted file does not exist' });
    else if (!ANTHROPIC_REFERENCE.test(readFileSync(file, 'utf8'))) findings.push({ kind: 'stale_allowlist', file: repoPath, detail: 'allowlisted file no longer contains a guarded reference' });
  }

  const advisorEntries = entries ?? defaultAdvisorEntries(srcRoot);
  for (const entry of advisorEntries) {
    if (!existsSync(entry)) findings.push({ kind: 'advisor_entry', file: relative(root, entry).replaceAll('\\', '/'), detail: 'Advisor graph entry is missing' });
  }
  for (const file of reachableFrom(advisorEntries, srcRoot)) {
    const srcPath = relative(srcRoot, file).replaceAll('\\', '/');
    if (FORBIDDEN_ADVISOR_IMPORTS.some((forbidden) => forbidden.endsWith('/') ? srcPath.startsWith(forbidden) : srcPath === forbidden)) {
      findings.push({ kind: 'advisor_import', file: relative(root, file).replaceAll('\\', '/'), detail: 'reachable from the Personal Advisor import graph' });
    }
  }

  const indexPath = join(srcRoot, 'index.ts');
  if (!existsSync(indexPath)) findings.push({ kind: 'assistant_gate', file: relative(root, indexPath).replaceAll('\\', '/'), detail: 'Worker entry is missing' });
  else findings.push(...assistantGateFindings(readFileSync(indexPath, 'utf8')));
  return findings;
}

export function formatNoAnthropicFindings(findings) {
  const lines = ['no-anthropic-in-prod: production Advisor boundary failed:'];
  for (const finding of findings) {
    lines.push(`  ${finding.kind}: ${finding.file}${finding.detail ? ` — ${finding.detail}` : ''}`);
    for (const hit of finding.hits ?? []) lines.push(`    ${hit.line}: ${hit.text}`);
  }
  return lines.join('\n');
}
