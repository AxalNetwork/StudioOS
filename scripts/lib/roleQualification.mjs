/**
 * D8688 (#8688): the rules of the role qualification — which target it may run
 * against (it fails closed), what a synthetic identity looks like, the build
 * identity a row records, and how a row's steps become its result and its line
 * in the pass/fail matrix. Pure: the CLI (`scripts/qualification/role-matrix.mjs`)
 * runs git and writes files, and the scenarios
 * (`cloudflare-worker/test/_role_qualification_8688.ts`) drive the real Worker.
 *
 * THE TARGET RULE. The qualification seeds identities, a territory licence and
 * records, so it runs only where nothing real lives. A target is refused when:
 *   - its `ENVIRONMENT` is `production`, unset or not one this file knows
 *     (`wrangler.toml`'s top level and `[env.production]` both say
 *     `production`, so a plain `wrangler dev` or a deploy config is refused);
 *   - it names the production D1 (`studioos-db`, or the id `wrangler.toml`
 *     binds to `DB` for production — read from the file by the caller, never
 *     copied here);
 *   - it is remote (a hosted database) without an `isolated` preflight from
 *     `scripts/check-preview-isolation.mjs` under 24 hours old, or it is the
 *     `preview` environment without one;
 *   - it already holds an account that is not synthetic (an address outside
 *     `SYNTHETIC_DOMAIN`): a database with a real member in it is not an
 *     isolated qualification database, whatever its name says.
 * Each refusal is named, so the operator learns which fact stopped the run.
 */

/** The reserved top-level domain (RFC 2606) every synthetic identity's address is under. */
export const SYNTHETIC_DOMAIN = 'qualification.invalid';

/** The environments the qualification knows. `development` is the in-process local Worker. */
export const KNOWN_ENVIRONMENTS = Object.freeze(['development', 'preview', 'production']);

/** A preflight older than this is stale, as `agent-validation-fixtures.mjs` holds it. */
export const PREFLIGHT_MAX_AGE_MS = 24 * 3600_000;

/** The five roles the issue qualifies, in the disposition table's order. */
export const ROLES = Object.freeze(['Admin', 'Founder', 'Investor', 'Advisor', 'Operating Partner']);

/** The four captures every scenario makes, then the scope check against the second tenant. */
export const STEPS = Object.freeze(['start', 'draft', 'reload', 'next_action', 'scope']);

/** A synthetic identity's address: a key and the reserved domain, never a person's. */
export function syntheticEmail(key) {
  const k = String(key ?? '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(k)) throw new Error(`a synthetic identity key is lower-case letters, digits and hyphens: ${JSON.stringify(key)}`);
  return `${k}@${SYNTHETIC_DOMAIN}`;
}

export function isSyntheticEmail(email) {
  return typeof email === 'string' && email.toLowerCase().endsWith(`@${SYNTHETIC_DOMAIN}`);
}

/**
 * The D1 databases `wrangler.toml` binds as `DB` in its top level and in
 * `[env.production]`: the identities a qualification target must never be.
 * A small reader for the one shape the file uses (`[[d1_databases]]` and
 * `[[env.production.d1_databases]]` blocks of `key = "value"` lines).
 */
export function productionDatabases(wranglerToml) {
  const out = [];
  let block = null;
  for (const raw of String(wranglerToml ?? '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const header = /^\[\[?([^\]]+)\]\]?$/.exec(line);
    if (header) {
      if (block) out.push(block);
      const name = header[1].trim();
      block = name === 'd1_databases' || name === 'env.production.d1_databases' ? {} : null;
      continue;
    }
    const kv = /^([A-Za-z_]+)\s*=\s*"([^"]*)"$/.exec(line);
    if (block && kv) block[kv[1]] = kv[2];
  }
  if (block) out.push(block);
  return out.filter((b) => b.binding === 'DB' && (b.database_name || b.database_id))
    .map((b) => ({ name: b.database_name ?? null, id: b.database_id ?? null }));
}

/**
 * Whether the qualification may run against `target`, and every reason it may not.
 *
 * target = {
 *   environment,          // the Worker's ENVIRONMENT var
 *   database: { name, id }, // the D1 it writes; `{}` for an in-process SQLite file
 *   remote,               // true for a hosted database
 *   accounts,             // the addresses already in its users table
 *   preflight,            // parsed check-preview-isolation --json output, when remote
 *   now,                  // the caller's clock, in ms (never read here)
 * }
 * production = productionDatabases(wrangler.toml)
 */
export function targetRefusals(target, production = []) {
  const reasons = [];
  const env = String(target?.environment ?? '').trim();
  if (!env) reasons.push({ code: 'environment_unset', message: 'The target names no ENVIRONMENT, so it is not known to be isolated.' });
  else if (env === 'production') reasons.push({ code: 'production_environment', message: 'The target is the production environment.' });
  else if (!KNOWN_ENVIRONMENTS.includes(env)) reasons.push({ code: 'unknown_environment', message: `ENVIRONMENT ${JSON.stringify(env)} is not one the qualification knows.` });

  const db = target?.database ?? {};
  const name = db.name == null ? '' : String(db.name);
  const id = db.id == null ? '' : String(db.id);
  const prodNames = new Set(['studioos-db', ...production.map((p) => p.name).filter(Boolean)]);
  const prodIds = new Set(production.map((p) => p.id).filter(Boolean));
  if (name && prodNames.has(name)) reasons.push({ code: 'production_database', message: `The database ${name} is production's D1.` });
  if (id && prodIds.has(id)) reasons.push({ code: 'production_database', message: 'The database id is the one wrangler.toml binds for production.' });

  const remote = target?.remote === true;
  if (remote || env === 'preview') {
    const pre = target?.preflight;
    const taken = Date.parse(pre?.observed_at ?? '');
    const now = Number(target?.now);
    if (pre?.verdict !== 'isolated') {
      reasons.push({ code: 'not_isolated', message: 'A hosted target needs an "isolated" preflight from check-preview-isolation.mjs.' });
    } else if (!Number.isFinite(taken) || !Number.isFinite(now) || now - taken > PREFLIGHT_MAX_AGE_MS || now < taken) {
      reasons.push({ code: 'preflight_stale', message: 'The isolation preflight is older than 24 hours or undated.' });
    }
  }

  const accounts = Array.isArray(target?.accounts) ? target.accounts : null;
  if (accounts === null) reasons.push({ code: 'accounts_unread', message: 'The target\'s existing accounts were not read, so it is not known to hold only synthetic ones.' });
  else {
    const real = accounts.filter((a) => !isSyntheticEmail(a)).length;
    if (real) reasons.push({ code: 'non_synthetic_accounts', message: `The target already holds ${real} account(s) outside the synthetic domain.` });
  }
  // Deduplicate by code: two production identities are one reason to stop.
  const seen = new Set();
  return reasons.filter((r) => (seen.has(r.code) ? false : seen.add(r.code)));
}

/** Throws, naming every reason, unless `targetRefusals` finds none. */
export function assertIsolatedTarget(target, production = []) {
  const reasons = targetRefusals(target, production);
  if (reasons.length) {
    const err = new Error(`role qualification refused this target: ${reasons.map((r) => r.code).join(', ')}`);
    err.reasons = reasons;
    throw err;
  }
  return true;
}

/**
 * The build a run qualified: the commit, and the app and Worker source trees as
 * git names them (`HEAD:frontend/src`, `HEAD:cloudflare-worker/src`), each
 * marked `+dirty` when the working tree differs. Independent ids, because the
 * disposition asks for the app and the Worker separately: one commit can carry
 * an unchanged Worker under a changed app. `git(args)` returns stdout or throws.
 */
export function buildIds(git) {
  const read = (args) => { try { return String(git(args)).trim(); } catch { return ''; } };
  const short = (s) => (s ? s.slice(0, 12) : 'unknown');
  const dirty = (path) => (read(['status', '--porcelain', '--', path]) ? '+dirty' : '');
  return {
    commit: short(read(['rev-parse', 'HEAD'])),
    app: short(read(['rev-parse', 'HEAD:frontend/src'])) + dirty('frontend/src'),
    worker: short(read(['rev-parse', 'HEAD:cloudflare-worker/src'])) + dirty('cloudflare-worker/src'),
  };
}

const RESULTS = new Set(['pass', 'fail', 'missing']);

/**
 * A row's result from its steps: `fail` when any step failed, `incomplete`
 * when none failed but one is missing (no product route, or not run here),
 * `pass` otherwise. A row with no steps is `incomplete`, never a pass.
 */
export function rowResult(steps) {
  const values = STEPS.map((s) => steps?.[s]?.result);
  if (values.some((v) => !RESULTS.has(v))) return 'incomplete';
  if (values.includes('fail')) return 'fail';
  if (values.includes('missing')) return 'incomplete';
  return 'pass';
}

/** The 390 px column's result joined to the API result: a browser fail fails the row, a check not run leaves it incomplete. */
export function overallResult(row) {
  const api = rowResult(row.steps);
  const phone = row.phone_390?.result;
  if (api === 'fail' || phone === 'fail') return 'fail';
  if (api === 'incomplete' || phone !== 'pass') return 'incomplete';
  return 'pass';
}

/** Text that may go in the public matrix: no address, URL, bearer value or long token-like run. */
export function isPublishable(text) {
  const s = String(text ?? '');
  return !/@|https?:\/\/|bearer\s|eyJ[A-Za-z0-9_-]{8,}|[A-Za-z0-9_-]{40,}/i.test(s);
}

/** Every evidence string in the rows that `isPublishable` refuses, as `row: text`. */
export function unpublishable(rows) {
  const bad = [];
  for (const row of rows) {
    const texts = [row.workspace, row.scope, ...(row.missing_steps || []), ...(row.evidence || []),
      ...STEPS.map((s) => row.steps?.[s]?.evidence), row.phone_390?.evidence];
    for (const t of texts) if (t != null && !isPublishable(t)) bad.push(`${row.intended_role}: ${t}`);
  }
  return bad;
}

const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

/** The matrix as a Markdown table, one row per scenario, then each row's missing steps. */
export function matrixMarkdown(run) {
  const { build, mode, rows } = run;
  const lines = [
    `Build: commit \`${build.commit}\` · app \`${build.app}\` · Worker \`${build.worker}\` · mode: ${mode}`,
    '',
    '| Intended role | Authenticated role | Workspace | Scope | Start | Draft | Reload | Next action | Second tenant | 390 px | Preview only | Result |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const r of rows) {
    lines.push(`| ${cell(r.intended_role)} | ${cell(r.authenticated_role)} | ${cell(r.workspace)} | ${cell(r.scope)} | `
      + STEPS.map((s) => cell(r.steps?.[s]?.result ?? 'missing')).join(' | ')
      + ` | ${cell(r.phone_390?.result ?? 'not run')} | ${r.preview_only ? 'yes' : 'no'} | **${overallResult(r)}** |`);
  }
  for (const r of rows) {
    lines.push('', `### ${r.intended_role}`, '');
    for (const s of STEPS) lines.push(`- ${s}: ${r.steps?.[s]?.result ?? 'missing'} — ${cell(r.steps?.[s]?.evidence ?? 'not recorded')}`);
    lines.push(`- 390 px: ${r.phone_390?.result ?? 'not run'} — ${cell(r.phone_390?.evidence ?? 'not recorded')}`);
    if (r.missing_steps?.length) lines.push(`- missing: ${r.missing_steps.map(cell).join('; ')}`);
  }
  return lines.join('\n') + '\n';
}
