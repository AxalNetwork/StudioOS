/**
 * D5815 (#5815): the Teams recorder's deployment matrix, checked offline.
 *
 * Reads the site's `wrangler.toml`, the bot host's `wrangler.meeting-bot.toml`,
 * `meeting-bot-deploy.yml`, the bot image's Dockerfile and lockfile manifest,
 * and the host's container source. It never calls Cloudflare, never starts a
 * container and never reads a secret. Every row is a capability or presence
 * check: the report names the check, the environment and `pass`/`fail`, never
 * a value (an origin, a bucket name or a version), so its output is safe to
 * paste on a public issue.
 *
 * The positive path (Teams driver fixture in the packaged image, host →
 * signed callback → upload → assembly) is not here: it needs #5812's driver
 * and #5675's isolated preview receipt, and runs in the deploy workflow.
 */
import { parseSections } from '../check-wrangler-binding-parity.mjs';

const unquote = v => (typeof v === 'string' && /^".*"$/.test(v) ? v.slice(1, -1) : v);
const SWITCH = new Set(['off', 'canary', 'on']);

/** The site's and the host's two deployed environments, with the names they must carry. */
export const ENVIRONMENTS = [
  { env: 'production', site: 'env.production.', host: '', hostScript: 'studioos-meeting-bot', appUrl: 'https://app.axal.vc' },
  { env: 'preview', site: 'env.preview.', host: 'env.preview.', hostScript: 'studioos-meeting-bot-preview', appUrl: null },
];

function section(sections, name, where) {
  return sections.filter(s => s.name === name && (!where || where(s)));
}
function vars(sections, prefix) {
  const out = new Map();
  for (const s of section(sections, `${prefix}vars`)) for (const [k, v] of s.kv) out.set(k, unquote(v));
  return out;
}
function topName(sections, prefix) {
  const env = section(sections, prefix.slice(0, -1))[0];
  return env ? unquote(env.kv.get('name')) : null;
}
function rootKey(source, key) {
  for (const raw of source.split('\n')) {
    if (/^\s*\[/.test(raw)) return null;
    const m = new RegExp(`^${key}\\s*=\\s*"([^"]*)"`).exec(raw.trim());
    if (m) return m[1];
  }
  return null;
}

/**
 * Returns `[{ check, env, ok }]`. `env` is `production`, `preview` or `both`.
 * Inputs are the files' text; tests pass mutated copies.
 */
export function teamsMatrix({ site, bot, workflow, dockerfile, botPackage, container }) {
  const rows = [];
  const add = (check, env, ok) => rows.push({ check, env, ok: Boolean(ok) });
  const S = parseSections(site), B = parseSections(bot);
  const siteNames = { production: topName(S, 'env.production.'), preview: topName(S, 'env.preview.') };
  const hostNames = { production: rootKey(bot, 'name'), preview: topName(B, 'env.preview.') };
  const buckets = {};

  for (const e of ENVIRONMENTS) {
    const sv = vars(S, e.site);
    // 1. Site → host: a cross-script Durable Object binding to this environment's own host.
    const binding = section(S, `${e.site}durable_objects.bindings`, s => s.kv.get('name') === '"MEETING_BOT_CONTAINER"');
    add('site_binds_its_own_bot_host', e.env, binding.length === 1
      && unquote(binding[0].kv.get('class_name')) === 'MeetingBotContainer'
      && unquote(binding[0].kv.get('script_name')) === e.hostScript
      && hostNames[e.env] === e.hostScript);
    // 2. The run-state Durable Object stays on the site (it holds the lease, consent and billing state).
    const run = section(S, `${e.site}durable_objects.bindings`, s => s.kv.get('name') === '"MEETING_BOT_RUN"');
    add('site_has_run_state_object', e.env, run.length === 1 && unquote(run[0].kv.get('class_name')) === 'MeetingBotRun'
      && !run[0].kv.has('script_name'));
    // 3. Chunk uploads land in the site's private FILES bucket; the host binds no bucket.
    const files = section(S, `${e.site}r2_buckets`, s => s.kv.get('binding') === '"FILES"');
    buckets[e.env] = files.length === 1 ? unquote(files[0].kv.get('bucket_name')) : null;
    add('site_has_private_files_bucket', e.env, Boolean(buckets[e.env]));
    // 4. Switches: each var is one of its allowed exact values (anything else silently reads as off).
    add('meeting_bot_switch_valid', e.env, SWITCH.has(sv.get('MEETING_BOT')));
    add('teams_switch_valid', e.env, ['off', 'on'].includes(sv.get('MEETING_BOT_TEAMS')));

    const hv = vars(B, e.host);
    // 5. Callback origin: the host's APP_URL is https, a bare origin, and this environment's site.
    let origin = null;
    try { const u = new URL(hv.get('APP_URL') ?? ''); if (u.protocol === 'https:' && u.pathname === '/' && !u.search && !u.hash && !u.username) origin = u; } catch { /* invalid */ }
    add('host_callback_origin_is_this_site', e.env, origin && (e.appUrl
      ? origin.origin === e.appUrl
      : origin.hostname.startsWith(`${siteNames.preview}.`) && origin.hostname.endsWith('.workers.dev')));
    // 6. Signing context: only the preview host carries the preview audience.
    add('host_signing_audience_scoped', e.env, e.env === 'preview' ? hv.get('CF_BOT_AUDIENCE') === 'preview' : !hv.has('CF_BOT_AUDIENCE'));
    // 7. The host's container: its class, its Durable Object and its migration, from the one Dockerfile.
    const cont = section(B, `${e.host}containers`);
    const image = section(B, `${e.host}containers.images.runtime`);
    const hostDo = section(B, `${e.host}durable_objects.bindings`, s => s.kv.get('name') === '"MEETING_BOT_CONTAINER"');
    const migration = section(B, `${e.host}migrations`, s => (s.kv.get('new_sqlite_classes') ?? '').includes('"MeetingBotContainer"'));
    add('host_container_declared', e.env, cont.length === 1 && unquote(cont[0].kv.get('class_name')) === 'MeetingBotContainer'
      && image.length === 1 && unquote(image[0].kv.get('dockerfile')) === './meeting-bot/Dockerfile'
      && hostDo.length === 1 && migration.length === 1);
    // 8. Member OAuth credentials stay on the application Worker: none named on the host.
    //    The host binds no bucket, database or KV either: chunks reach R2 only through the site's one-use PUT.
    add('host_holds_no_member_oauth', e.env, ![...hv.keys()].some(k => /^(MICROSOFT|MAIL_MICROSOFT|GOOGLE|ZOOM|GMAIL)_/.test(k))
      && ['r2_buckets', 'd1_databases', 'kv_namespaces'].every(t => section(B, `${e.host}${t}`).length === 0));
  }
  // 9. Preview and production never share a host, a site or a bucket.
  add('environments_distinct', 'both', hostNames.production && hostNames.preview && hostNames.production !== hostNames.preview
    && siteNames.production && siteNames.preview && siteNames.production !== siteNames.preview
    && buckets.production && buckets.preview && buckets.production !== buckets.preview);
  // 10. Teams narrows MEETING_BOT: production's Teams switch is never on while its MEETING_BOT is off.
  for (const e of ENVIRONMENTS) {
    const sv = vars(S, e.site);
    add('teams_never_wider_than_bot', e.env, !(sv.get('MEETING_BOT_TEAMS') === 'on' && sv.get('MEETING_BOT') === 'off'));
  }
  // 11. Pinned image and browser: an exact Playwright version, Chromium installed from it, one Node major.
  let pkg = {};
  try { pkg = JSON.parse(botPackage); } catch { /* fails below */ }
  const pw = (pkg.dependencies ?? {}).playwright;
  add('browser_pinned', 'both', typeof pw === 'string' && /^\d+\.\d+\.\d+$/.test(pw)
    && /npx --no-install playwright install --with-deps chromium/.test(dockerfile)
    && /^FROM node:\d+-[a-z]+-slim AS base$/m.test(dockerfile) && /npm ci --omit=dev/.test(dockerfile));
  // 12. Container readiness and egress: one instance type, egress on, a readiness probe before the command.
  add('container_readiness_and_egress', 'both', /enableInternet:true/.test(container) && /instance:'standard-2'/.test(container)
    && /\/healthz/.test(container) && /MEETING_BOT_CALLBACK_ORIGIN:origin/.test(container));
  // 13. Matching revisions: both hosts stamp the commit; preview is verified before production is promoted.
  const previewDeploy = workflow.indexOf('--config wrangler.meeting-bot.toml --env preview');
  const verify = workflow.indexOf('scripts/verify-meeting-bot-preview.mjs\n');
  const promote = workflow.indexOf('--config wrangler.meeting-bot.toml --env ""');
  add('revision_stamped_and_preview_first', 'both', previewDeploy > 0 && verify > previewDeploy && promote > verify
    && (workflow.match(/--var "MEETING_BOT_VERSION:\$\{GITHUB_SHA\}"/g) ?? []).length === 2
    && /verify-production-candidate\.mjs "\$GITHUB_SHA" --wait/.test(workflow));
  return rows;
}

/** One line per row, values never printed. */
export function formatMatrix(rows) {
  return rows.map(r => `${r.ok ? 'pass' : 'FAIL'}  ${r.env.padEnd(10)} ${r.check}`).join('\n');
}
