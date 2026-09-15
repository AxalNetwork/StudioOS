/**
 * A branch Worker's config, derived from HQ's — never written by hand.
 *
 * WHY IT IS DERIVED. A branch is the same codebase deployed again
 * (`studioos-<code>` at `<code>.axal.vc`) over its own database, so its
 * config must declare every binding HQ declares. Hand-maintaining N copies of
 * a table that already drifts between two (`wrangler.toml:405-422` records the
 * outage that came of it) would fail the first time someone added a binding.
 * So this renders `[env.production]` — the table that actually ships — with
 * names and ids swapped, and copies everything it does not know about
 * verbatim. A new binding on HQ reaches every branch by construction, and
 * `scripts/check-branch-config.mjs` fails the build if the rename map ever
 * stops covering one.
 *
 * WHAT IS NOT DERIVED, and why each is deliberate:
 *   · `[[routes]]` — exactly one, the branch host. Rendering HQ's would bind
 *     `axal.vc` and `app.axal.vc` to the BRANCH Worker: a custom domain
 *     belongs to one Worker, so the apex would move. That is the single most
 *     destructive thing a generator here could do, so the route table is
 *     replaced rather than transformed, and the guard re-checks it.
 *   · `analytics_engine_datasets` — NOT renamed. One dataset across every
 *     branch is the design (the HQ statements and the anonymised median are
 *     computed from it), with `BRANCH_CODE` as the index.
 *   · `triggers` — trimmed to the two cadences a branch needs. The platform
 *     content crons (market-intel connectors, persona digests) would otherwise
 *     run N times over the same external sources.
 *   · `[[services]]` — added. A branch calls HQ through a service binding;
 *     HQ's side of the pair is committed into `wrangler.toml` when the branch
 *     is provisioned.
 *
 * The output is FLAT — no `[env.*]` — so `--env` is never combined with
 * `--name`, and the non-inheritance trap cannot recur inside a branch config.
 *
 * Pure: no filesystem, no network. `scripts/gen-branch-wrangler.mjs` writes
 * the file; `scripts/check-branch-config.mjs` checks it; both call in here.
 */

/** A branch code is one hostname label: `fr`, `dach`, `dubai-2`. */
export const BRANCH_CODE_RE = /^[a-z][a-z0-9-]{1,15}$/;

/** Hosts that are HQ's and can never be a branch's. */
export const HQ_HOSTS = ['axal.vc', 'app.axal.vc'];

/** Residency values Cloudflare actually offers (verified 2026-09-14). */
export const D1_JURISDICTIONS = new Set(['eu', 'fedramp']);
export const LOCATION_HINTS = new Set(['weur', 'eeur', 'enam', 'wnam', 'apac', 'oc']);
export const DO_JURISDICTIONS = new Set(['eu', 'us', 'fedramp']);
export const R2_JURISDICTIONS = new Set(['eu', 'fedramp']);

/** A registry entry is one of these; anything else is refused. */
export const BRANCH_STATUSES = new Set(['provisioning', 'live', 'suspended', 'example']);

/** Every name a branch's resources take, from the code alone. */
export function derivedNames(code) {
  return {
    worker: `studioos-${code}`,
    hostname: `${code}.axal.vc`,
    d1: `studioos-${code}`,
    queue: `studioos-${code}-job-queue`,
    dlq: `studioos-${code}-job-queue-dlq`,
    r2: {
      FILES: `studioos-${code}-files`,
      PUBLICATIONS: `studioos-${code}-publications`,
      BACKUPS: `studioos-${code}-backups`,
    },
    vectorize: `axal-search-${code}`,
  };
}

/** The crons a branch runs: the queue drain and the nightly cleanup, nothing else. */
export const BRANCH_CRONS = ['* * * * *', '0 3 * * *'];

const KV_ID_KEY = { TOKENS: 'kv_tokens', RATE_LIMITS: 'kv_rate_limits' };

/**
 * Problems with a registry entry, as sentences. Empty means usable.
 *
 * Every id is checked against HQ's when `hqIds` is supplied: a copy-pasted
 * entry that still carries production's database id would deploy a branch
 * Worker bound to the HQ database — isolation gone, silently, on a config
 * that looks right.
 */
export function validateBranch(entry, hqIds = null) {
  const bad = [];
  const say = (m) => bad.push(m);
  if (!entry || typeof entry !== 'object') return ['the entry is not an object'];

  const code = entry.code;
  if (typeof code !== 'string' || !BRANCH_CODE_RE.test(code)) {
    say(`code ${JSON.stringify(code)} must match ${BRANCH_CODE_RE}`);
  }
  for (const key of ['licence_uid', 'name']) {
    if (typeof entry[key] !== 'string' || !entry[key].trim()) say(`${key} is required`);
  }
  if (typeof code === 'string' && BRANCH_CODE_RE.test(code)) {
    const want = `${code}.axal.vc`;
    if (entry.hostname !== want) say(`hostname must be ${want}, not ${JSON.stringify(entry.hostname)}`);
  }
  if (HQ_HOSTS.includes(entry.hostname)) say(`hostname ${entry.hostname} is HQ's`);

  if (!Array.isArray(entry.territory) || entry.territory.length === 0) {
    say('territory must be a non-empty array of ISO 3166-1 alpha-2 codes');
  } else {
    for (const t of entry.territory) {
      if (typeof t !== 'string' || !/^[A-Z]{2}$/.test(t)) say(`territory ${JSON.stringify(t)} is not an ISO alpha-2 code`);
    }
  }

  const r = entry.residency;
  if (!r || typeof r !== 'object') say('residency is required (use nulls for "no guarantee")');
  else {
    const one = (key, allowed) => {
      const v = r[key];
      if (v === null || v === undefined) return;
      if (typeof v !== 'string' || !allowed.has(v)) {
        say(`residency.${key} ${JSON.stringify(v)} is not one of ${[...allowed].join(', ')} (or null)`);
      }
    };
    one('d1_jurisdiction', D1_JURISDICTIONS);
    one('location_hint', LOCATION_HINTS);
    one('do_jurisdiction', DO_JURISDICTIONS);
    one('r2_jurisdiction', R2_JURISDICTIONS);
  }

  const ids = entry.ids;
  if (!ids || typeof ids !== 'object') say('ids is required (d1, kv_tokens, kv_rate_limits)');
  else {
    for (const key of ['d1', 'kv_tokens', 'kv_rate_limits']) {
      const v = ids[key];
      if (typeof v !== 'string' || !v.trim()) { say(`ids.${key} is required`); continue; }
      if (hqIds && hqIds.has(v)) say(`ids.${key} is HQ's own id — a branch must never share HQ's storage`);
    }
  }

  if (!BRANCH_STATUSES.has(entry.status)) {
    say(`status ${JSON.stringify(entry.status)} must be one of ${[...BRANCH_STATUSES].join(', ')}`);
  }
  return bad;
}

// ── TOML, only as much as this file needs ──────────────────────────────────

/**
 * `wrangler.toml` as ordered sections, each keeping its keys in order and its
 * values as raw text. Enough to re-render, and no more: this config has no
 * nested inline tables, and the one multi-line array in it (the cron list) is
 * folded onto a line below. A shape it cannot carry throws rather than
 * silently dropping a key, because a binding lost here is a branch Worker
 * that boots without it.
 */
export function parseToml(src) {
  const root = new Map();
  const sections = [];
  let cur = null;
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].replace(/^\s+/, '');
    const header = /^(\[\[?)([A-Za-z0-9_.-]+)\]\]?\s*(?:#.*)?$/.exec(line);
    if (header) {
      cur = { name: header[2], double: header[1] === '[[', kv: new Map() };
      sections.push(cur);
      continue;
    }
    const kv = /^([A-Za-z0-9_-]+)\s*=\s*(.*)$/.exec(line);
    if (!kv) continue;
    let value = stripComment(kv[2]);
    // THE CRON TABLE IS WRITTEN OVER SEVEN LINES, one cadence per line with
    // its own trailing comment, which is how it should be read by a person
    // and is why this cannot be a one-line-per-key parser. Keep consuming
    // until the brackets balance, then re-render on one line: the comments
    // explain HQ's cadences and a branch does not run them.
    if (countUnquoted(value, '[') > countUnquoted(value, ']')) {
      const parts = [value];
      let depth = countUnquoted(value, '[') - countUnquoted(value, ']');
      while (depth > 0) {
        i += 1;
        if (i >= lines.length) throw new Error(`wrangler.toml: array opened at ${kv[1]} is never closed`);
        const piece = stripComment(lines[i].trim());
        parts.push(piece);
        depth += countUnquoted(piece, '[') - countUnquoted(piece, ']');
      }
      value = parts.join(' ').replace(/\s+/g, ' ').replace(/,\s*\]/, ' ]').trim();
    }
    (cur ? cur.kv : root).set(kv[1], value);
  }
  return { root, sections };
}

/** Occurrences of `ch` outside quotes — enough to balance an array. */
function countUnquoted(text, ch) {
  let inS = false; let inD = false; let n = 0;
  for (const c of text) {
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (c === ch && !inS && !inD) n += 1;
  }
  return n;
}

/** A value with its trailing `#` comment removed, quotes respected. */
function stripComment(raw) {
  let inS = false; let inD = false;
  for (let j = 0; j < raw.length; j += 1) {
    if (raw[j] === "'" && !inD) inS = !inS;
    else if (raw[j] === '"' && !inS) inD = !inD;
    else if (raw[j] === '#' && !inS && !inD) return raw.slice(0, j).trim();
  }
  return raw.trim();
}

const q = (s) => JSON.stringify(String(s));
const arr = (xs) => `[${xs.map(q).join(', ')}]`;

function renderSection(name, double, kv) {
  const head = double ? `[[${name}]]` : `[${name}]`;
  const body = [...kv].map(([k, v]) => `${k} = ${v}`);
  return [head, ...body].join('\n');
}

/**
 * The branch's `wrangler.branch.<code>.toml`, as text.
 *
 * `entry` must already have passed `validateBranch`.
 */
export function renderBranchConfig(tomlSrc, entry) {
  const { root, sections } = parseToml(tomlSrc);
  const code = entry.code;
  const n = derivedNames(code);
  const prod = sections.filter((s) => s.name.startsWith('env.production.'));
  const inherited = sections.filter((s) => ['rules', 'observability', 'observability.logs', 'observability.traces'].includes(s.name));

  const out = [];
  out.push('#:schema node_modules/wrangler/config-schema.json');
  out.push('# GENERATED by scripts/gen-branch-wrangler.mjs — do not edit, and do not commit.');
  out.push(`# Branch "${entry.name}" (${code}) at https://${n.hostname}, from`);
  out.push('# infra/branches/' + code + '.json and wrangler.toml\'s [env.production] table.');
  out.push('# Every binding HQ declares is rendered here with names and ids swapped;');
  out.push('# see scripts/lib/branchConfig.mjs for what is deliberately NOT copied.');
  out.push('');
  out.push(`name = ${q(n.worker)}`);
  for (const key of ['main', 'compatibility_date', 'compatibility_flags', 'minify']) {
    if (root.has(key)) out.push(`${key} = ${root.get(key)}`);
  }
  // A branch is reached at its custom domain and nowhere else: a workers.dev
  // hostname would 410 every OAuth callback (index.ts's workersDev guard) and
  // serve the SPA from an origin no cookie is scoped to.
  out.push('workers_dev = false');
  out.push('preview_urls = false');

  const push = (name, double, kv) => { out.push(''); out.push(renderSection(name, double, kv)); };

  // The one route, replacing HQ's pair.
  push('routes', true, new Map([['pattern', q(n.hostname)], ['custom_domain', 'true']]));

  for (const s of prod) {
    const table = s.name.slice('env.production.'.length);
    const kv = new Map(s.kv);
    switch (table) {
      case 'routes':
        continue; // replaced above
      case 'vars': {
        for (const key of ['APP_URL', 'PUBLIC_BASE_URL', 'OAUTH_CALLBACK_BASE_URL', 'PUBLIC_MARKETING_URL']) {
          if (kv.has(key)) kv.set(key, q(`https://${n.hostname}`));
        }
        kv.set('BRANCH_CODE', q(code));
        kv.set('BRANCH_NAME', q(entry.name));
        kv.set('BRANCH_TERRITORY', q(entry.territory.join(',')));
        // The Analytics Engine dataset is shared on purpose; naming it in a
        // var keeps the SQL-API reader from hardcoding HQ's.
        const ae = prod.find((p) => p.name.endsWith('analytics_engine_datasets'));
        if (ae?.kv.get('dataset')) kv.set('AE_DATASET', ae.kv.get('dataset'));
        // Integration Keys promotes admin-entered keys into Worker secrets;
        // without this it would write them onto HQ's script.
        kv.set('CF_WORKER_SCRIPT_NAME', q(n.worker));
        break;
      }
      case 'd1_databases':
        kv.set('database_name', q(n.d1));
        kv.set('database_id', q(entry.ids.d1));
        break;
      case 'kv_namespaces': {
        const binding = JSON.parse(kv.get('binding'));
        const key = KV_ID_KEY[binding];
        if (!key) throw new Error(`no registry id for KV binding ${binding} — add it to KV_ID_KEY`);
        kv.set('id', q(entry.ids[key]));
        break;
      }
      case 'queues.producers':
        kv.set('queue', q(n.queue));
        break;
      case 'queues.consumers': {
        const isDlq = JSON.parse(kv.get('queue')).endsWith('-dlq');
        kv.set('queue', q(isDlq ? n.dlq : n.queue));
        if (kv.has('dead_letter_queue')) kv.set('dead_letter_queue', q(n.dlq));
        break;
      }
      case 'vectorize':
        kv.set('index_name', q(n.vectorize));
        break;
      case 'r2_buckets': {
        const binding = JSON.parse(kv.get('binding'));
        const name = n.r2[binding];
        if (!name) throw new Error(`no branch bucket name for R2 binding ${binding} — add it to derivedNames`);
        kv.set('bucket_name', q(name));
        break;
      }
      case 'triggers':
        kv.set('crons', arr(BRANCH_CRONS));
        break;
      default:
        break; // analytics_engine_datasets, ai, browser, assets, DOs, migrations, tail_consumers
    }
    push(table, s.double, kv);
  }

  for (const s of inherited) push(s.name, s.double, new Map(s.kv));

  // HQ's side of this pair is committed into wrangler.toml at provisioning.
  push('services', true, new Map([
    ['binding', q('HQ')],
    ['service', q('studioos')],
    ['entrypoint', q('HqEntrypoint')],
  ]));

  return `${out.join('\n')}\n`;
}

/** Every id HQ's production table binds, so a branch entry can be checked against them. */
export function hqIds(tomlSrc) {
  const { sections } = parseToml(tomlSrc);
  const out = new Set();
  for (const s of sections) {
    if (!s.name.startsWith('env.production.') && !['d1_databases', 'kv_namespaces'].includes(s.name)) continue;
    for (const key of ['database_id', 'id']) {
      const v = s.kv.get(key);
      if (v) out.add(JSON.parse(v));
    }
  }
  return out;
}

/**
 * Problems with a rendered config, as sentences. Empty means it may deploy.
 *
 * This is the half that outlives the renderer: it re-derives what the output
 * must contain from `wrangler.toml` itself, so a binding added to HQ that the
 * rename map does not cover fails here rather than shipping half-configured.
 */
export function checkRendered(tomlSrc, entry, rendered) {
  const bad = [];
  const code = entry.code;
  const n = derivedNames(code);
  const { root, sections } = parseToml(rendered);
  const byName = (name) => sections.filter((s) => s.name === name);

  if (sections.some((s) => s.name.startsWith('env.'))) {
    bad.push('the rendered config declares an [env.*] table; it must be flat');
  }
  if (root.get('name') !== q(n.worker)) bad.push(`name must be ${q(n.worker)}, found ${root.get('name')}`);
  if (root.get('workers_dev') !== 'false') bad.push('workers_dev must be false');

  const routes = byName('routes');
  if (routes.length !== 1) bad.push(`expected exactly one route, found ${routes.length}`);
  for (const r of routes) {
    const pattern = r.kv.get('pattern') ? JSON.parse(r.kv.get('pattern')) : '';
    if (pattern !== n.hostname) bad.push(`route ${pattern} is not ${n.hostname}`);
    if (HQ_HOSTS.includes(pattern)) bad.push(`route ${pattern} is HQ's own host — deploying this would move the apex`);
    if (r.kv.get('custom_domain') !== 'true') bad.push('the branch route must be a custom domain');
  }

  // Every production table, with matching identities after the rename.
  const IDENTITY = {
    d1_databases: 'binding',
    kv_namespaces: 'binding',
    r2_buckets: 'binding',
    vectorize: 'binding',
    analytics_engine_datasets: 'binding',
    assets: 'binding',
    browser: 'binding',
    ai: 'binding',
    'queues.producers': 'binding',
    'queues.consumers': 'queue',
    'durable_objects.bindings': 'name',
    migrations: 'tag',
    tail_consumers: 'service',
  };
  const prodTables = new Map();
  for (const s of parseToml(tomlSrc).sections) {
    if (!s.name.startsWith('env.production.')) continue;
    const t = s.name.slice('env.production.'.length);
    if (!prodTables.has(t)) prodTables.set(t, []);
    prodTables.get(t).push(s);
  }
  const renamedQueue = (v) => (v.endsWith('-dlq') ? q(n.dlq) : q(n.queue));
  for (const [table, list] of prodTables) {
    if (['routes', 'vars', 'triggers'].includes(table)) continue;
    const here = byName(table);
    if (here.length !== list.length) {
      bad.push(`table ${table}: HQ declares ${list.length}, the branch config has ${here.length}`);
      continue;
    }
    const key = IDENTITY[table];
    if (!key) { bad.push(`table ${table} is not in this guard's IDENTITY map — teach it the rename rule`); continue; }
    const want = list.map((s) => (table === 'queues.consumers' ? renamedQueue(JSON.parse(s.kv.get(key))) : s.kv.get(key))).sort();
    const got = here.map((s) => s.kv.get(key)).sort();
    if (JSON.stringify(want) !== JSON.stringify(got)) {
      bad.push(`table ${table}: expected identities ${want.join(', ')}, found ${got.join(', ')}`);
    }
  }

  // Storage must be the branch's own.
  const ids = hqIds(tomlSrc);
  for (const s of [...byName('d1_databases'), ...byName('kv_namespaces')]) {
    for (const key of ['database_id', 'id']) {
      const v = s.kv.get(key);
      if (v && ids.has(JSON.parse(v))) bad.push(`${s.name}.${key} is HQ's id — the branch would share HQ's storage`);
    }
  }
  const d1 = byName('d1_databases')[0];
  if (d1 && d1.kv.get('database_name') !== q(n.d1)) bad.push(`database_name must be ${q(n.d1)}`);
  const vec = byName('vectorize')[0];
  if (vec && vec.kv.get('index_name') !== q(n.vectorize)) bad.push(`vectorize index must be ${q(n.vectorize)}`);
  for (const s of byName('r2_buckets')) {
    const binding = JSON.parse(s.kv.get('binding'));
    if (s.kv.get('bucket_name') !== q(n.r2[binding])) bad.push(`R2 ${binding} must be ${n.r2[binding]}`);
  }

  // Durable Objects need their migration tag, or a new script has no DO bindings at all.
  const mig = byName('migrations')[0];
  const hqMig = prodTables.get('migrations')?.[0];
  if (!mig) bad.push('the DO migration tag is missing — a new Worker script would have no Durable Object bindings');
  else if (hqMig && mig.kv.get('new_sqlite_classes') !== hqMig.kv.get('new_sqlite_classes')) {
    bad.push('the DO migration classes differ from HQ\'s');
  }

  const assets = byName('assets')[0];
  if (!assets || assets.kv.get('directory') !== q('./docs')) {
    bad.push('the assets directory must be "./docs", resolved from the repo root where the config is written');
  }

  const vars = byName('vars')[0];
  if (!vars) bad.push('[vars] is missing');
  else {
    const v = (k) => (vars.kv.get(k) ? JSON.parse(vars.kv.get(k)) : undefined);
    if (v('BRANCH_CODE') !== code) bad.push(`BRANCH_CODE must be ${code}`);
    if (v('BRANCH_CODE') !== n.hostname.split('.')[0]) bad.push('BRANCH_CODE must be the hostname\'s first label');
    if (v('BRANCH_NAME') !== entry.name) bad.push('BRANCH_NAME must be the registry name');
    if (v('BRANCH_TERRITORY') !== entry.territory.join(',')) bad.push('BRANCH_TERRITORY must be the registry territory');
    if (v('CF_WORKER_SCRIPT_NAME') !== n.worker) bad.push(`CF_WORKER_SCRIPT_NAME must be ${n.worker}`);
    for (const key of ['APP_URL', 'PUBLIC_BASE_URL', 'OAUTH_CALLBACK_BASE_URL', 'PUBLIC_MARKETING_URL']) {
      if (v(key) !== `https://${n.hostname}`) bad.push(`${key} must be https://${n.hostname} — every email link and OAuth callback reads one of these`);
    }
    for (const hqVar of prodTables.get('vars')?.[0]?.kv.keys() ?? []) {
      if (!vars.kv.has(hqVar)) bad.push(`var ${hqVar} is declared on HQ and missing here`);
    }
  }

  const triggers = byName('triggers')[0];
  if (!triggers) bad.push('[triggers] is missing');
  else if (triggers.kv.get('crons') !== arr(BRANCH_CRONS)) {
    bad.push(`branch crons must be ${arr(BRANCH_CRONS)} — the platform-content cadences are HQ's alone`);
  }

  const svc = byName('services')[0];
  if (!svc || JSON.parse(svc.kv.get('service') || '""') !== 'studioos') {
    bad.push('the HQ service binding is missing');
  }

  for (const name of ['rules', 'observability']) {
    if (!byName(name).length) bad.push(`[${name}] is missing — it is inherited at the top level, so it must be rendered explicitly`);
  }
  return bad;
}
