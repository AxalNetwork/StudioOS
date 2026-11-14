#!/usr/bin/env node
/**
 * D883 (#2556) — AXAL VC'S OWN MERCURY ACCOUNTS STAY OFF MEMBER SURFACES.
 *
 * The owner, 2026-10-22: "Mercury connector is for users, you put the Mercury
 * Axal VC accounts, which has nothing to do there." `/account/connectors/
 * mercury` had served D752's `entity` variant to an admin on HQ, so Axal VC's
 * four entity accounts showed on a member's connector page. D879–D881
 * (#2552–#2554) took them off: the member connector is a member's own Mercury,
 * by Sign in with Mercury, for Grow and Raise (and an investor's Deals). Axal
 * VC's accounts live only in HQ › Fund administration › Bank accounts, over
 * `/api/admin/mercury` (`routes/admin_mercury.ts`,
 * `pages/admin/fundAdmin/MercuryEntitySheet.jsx`).
 *
 * This guard keeps them off. It fails when:
 *   1. a member page (`frontend/src/pages/account/**`, JS and JSX) names an
 *      Axal entity, `mercury_entity_connections`, the admin Mercury API, or the
 *      entity sheet and its helpers;
 *   2. the `mercury` provider row in `integrations/registry.ts` carries
 *      `entity_roles`, or its description names Axal's entity accounts;
 *   3. `CONNECTOR_METADATA.mercury` (its permissions, feeds and uses) names
 *      them;
 *   4. the registry routes a connector to `mercury_entity_connections`;
 *   5. Mercury's connector pages (`integrations/connectorPages.ts`) have an
 *      `entity` variant again;
 *   6. a member connect route (`routes/integrations.ts`,
 *      `routes/mercury_personal.ts`) answers with the entity refusal
 *      (`entity_connection_only`) again, or names the entity accounts.
 *
 * CODE ONLY. Comments are removed before the sweep, so a line explaining that
 * the entity accounts moved to HQ never reads as one. READMEs are prose and are
 * not swept. HQ's own files (`pages/admin/**`, `routes/admin_mercury.ts`,
 * `services/mercury/**`) are where the entity accounts belong and are never
 * read here.
 *
 * Run: node scripts/check-mercury-member-surfaces.mjs
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ACCOUNT_PAGES = 'frontend/src/pages/account';
const REGISTRY = 'cloudflare-worker/src/integrations/registry.ts';
const PAGES = 'cloudflare-worker/src/integrations/connectorPages.ts';
const CONNECT_ROUTES = ['cloudflare-worker/src/routes/integrations.ts', 'cloudflare-worker/src/routes/mercury_personal.ts'];

/** What names Axal VC's own accounts, or the HQ code that reads them. */
export const ENTITY_TERMS = [
  ['mercury_entity_connections', /mercury_entity_connections/],
  ['the admin Mercury API', /adminMercury|\/api\/admin\/mercury|admin\/mercury\b/],
  ['the entity sheet', /\bMercuryEntity[A-Za-z]*\b/],
  ['the entity helpers', /\b(?:entityRows|isEntityRow|ENTITY_SOURCE)\b/],
  ['an Axal entity', /\bAxal(?:\s+VC['’]?s?)?\s+entit(?:y|ies)\b/i],
  ['the entity accounts', /\bentity\s+(?:accounts?|connections?)\b/i],
];

/**
 * Comments blanked, strings kept: a small scanner that knows quotes and
 * template literals, so `'/api/*'` or `'https://…'` never opens a comment.
 * Every comment character becomes a space and every newline stays, so a
 * finding's line is the file's own line.
 */
export function codeOnly(src) {
  const s = String(src);
  let out = '';
  let quote = null;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (quote) {
      out += c;
      if (c === '\\') { out += s[i + 1] ?? ''; i += 1; } else if (c === quote || (c === '\n' && quote !== '`')) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; out += c; continue; }
    if (c === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') { out += ' '; i += 1; }
      if (i < s.length) out += '\n';
      continue;
    }
    if (c === '/' && s[i + 1] === '*') {
      const close = s.indexOf('*/', i + 2);
      const stop = close < 0 ? s.length : close + 2;
      out += s.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop - 1;
      continue;
    }
    out += c;
  }
  return out;
}

/** The source between `start`'s first match and its closing brace at the same depth, or null. */
export function block(src, start) {
  const at = src.search(start);
  if (at < 0) return null;
  const open = src.indexOf('{', at);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(at, i + 1); }
  }
  return null;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(jsx?|tsx?|mjs)$/.test(p)) out.push(p);
  }
  return out;
}

const lineOf = (src, index) => src.slice(0, index).split('\n').length;

/** Each term `part` names, with its line in `whole` (the file `part` was cut from, at `offset`). */
function termHits(file, part, where = '', whole = part, offset = 0) {
  const out = [];
  for (const [label, re] of ENTITY_TERMS) {
    const m = re.exec(part);
    if (m) out.push({ file, line: lineOf(whole, offset + m.index), what: `${where}names ${label} (\`${m[0]}\`)` });
  }
  return out;
}

/** Every finding under `root`; empty when the member surfaces are clean. A missing file is a finding: the sweep must see what it guards. */
export function scanMemberSurfaces(root = process.cwd()) {
  const findings = [];
  const read = (rel) => {
    const p = join(root, rel);
    if (!existsSync(p)) { findings.push({ file: rel, line: 0, what: 'is missing, so it cannot be checked' }); return null; }
    return readFileSync(p, 'utf8');
  };

  // 1. The member pages.
  const pages = join(root, ACCOUNT_PAGES);
  if (!existsSync(pages)) findings.push({ file: ACCOUNT_PAGES, line: 0, what: 'is missing, so it cannot be checked' });
  else for (const p of walk(pages)) findings.push(...termHits(relative(root, p), codeOnly(readFileSync(p, 'utf8'))));

  // 2–4. The registry: the `mercury` provider row, its metadata, and any routing to the entity table.
  const registry = read(REGISTRY);
  if (registry !== null) {
    const code = codeOnly(registry);
    const row = block(code, /key:\s*'mercury'/);
    if (!row) findings.push({ file: REGISTRY, line: 0, what: "has no `mercury` provider row to check" });
    else {
      const base = code.indexOf(row);
      const roles = /\bentity_roles\b/.exec(row);
      if (roles) findings.push({ file: REGISTRY, line: lineOf(code, base + roles.index), what: 'gives the `mercury` row `entity_roles` again' });
      findings.push(...termHits(REGISTRY, row, 'the `mercury` row ', code, base));
    }
    const meta = block(code, /\n\s*mercury:\s*\{/);
    if (!meta) findings.push({ file: REGISTRY, line: 0, what: 'has no `mercury` metadata to check' });
    else findings.push(...termHits(REGISTRY, meta, '`CONNECTOR_METADATA.mercury` ', code, code.indexOf(meta)));
    const source = /mercury_entity_connections/.exec(code);
    if (source) findings.push({ file: REGISTRY, line: lineOf(code, source.index), what: 'routes a connector to `mercury_entity_connections`' });
  }

  // 5. Mercury's connector pages.
  const connectorPages = read(PAGES);
  if (connectorPages !== null) {
    const code = codeOnly(connectorPages);
    const variant = /type\s+MercuryVariant\s*=[^;]*'entity'/.exec(code) || /variant\s*===\s*'entity'/.exec(code);
    if (variant) findings.push({ file: PAGES, line: lineOf(code, variant.index), what: "gives Mercury's pages an `entity` variant again" });
    const page = block(code, /function\s+mercuryPage\s*\(/);
    if (page) findings.push(...termHits(PAGES, page, '`mercuryPage` ', code, code.indexOf(page)));
  }

  // 6. The member connect routes: the generic connect, and a member's own Mercury.
  for (const file of CONNECT_ROUTES) {
    const route = read(file);
    if (route === null) continue;
    const code = codeOnly(route);
    const refusal = /entity_connection_only/.exec(code);
    if (refusal) findings.push({ file, line: lineOf(code, refusal.index), what: 'answers a member with the entity refusal (`entity_connection_only`) again' });
    findings.push(...termHits(file, code));
  }
  return findings;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const findings = scanMemberSurfaces(resolve(process.cwd()));
  if (findings.length) {
    console.error(`check-mercury-member-surfaces: ${findings.length} finding(s). Axal VC's own Mercury accounts belong to HQ › Fund administration only (D879–D883):`);
    for (const f of findings) console.error(`  ${f.file}${f.line ? `:${f.line}` : ''} ${f.what}`);
    process.exit(1);
  }
  console.log('check-mercury-member-surfaces: OK — no member surface names Axal VC\'s own Mercury accounts.');
}
