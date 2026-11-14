/**
 * D4870 part 2 (#4870): the pure half of the hosted gateway live check, owner
 * decision Q2 = A (2026-11-14). `scripts/gateway-live-check.mjs` drives it;
 * `cloudflare-worker/src/probes/gatewayLiveCheck.ts` is the throwaway Worker.
 *
 *   - `liveCheckNames(run)`  the throwaway Worker's name, `studioos-s4870-<run>`;
 *   - `gatewaySlugOk(slug)`  the gateway id the owner types at dispatch;
 *   - `renderProbeConfig`    a flat config: the probe entry and the AI binding only;
 *   - `checkProbeConfig`     refuses a config that could reach production;
 *   - `liveCheckVerdict`     items 1 and 2 of #4870 from the probe's answer.
 *
 * No secret, prompt or answer text passes through here: the probe answers with
 * states, counts and amounts only.
 */

/** The run id the workflow passes (`a<run id>`), lower case, short enough for a Worker name. */
export function liveCheckNames(run) {
  const id = String(run ?? '').toLowerCase();
  if (!/^[a-z0-9]{1,20}$/.test(id)) throw new Error('the run id must be 1–20 lower-case letters or digits');
  return { run: id, worker: `studioos-s4870-${id}`, configFile: `wrangler.s4870.${id}.toml` };
}

/** An AI Gateway id as the dashboard makes it: lower case, digits and hyphens. */
export function gatewaySlugOk(slug) {
  return typeof slug === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(slug);
}

/** The compatibility date and flags production uses, read from the top of `wrangler.toml`. */
export function productionCompat(toml) {
  const date = /^compatibility_date\s*=\s*"([0-9-]+)"/m.exec(toml)?.[1];
  const flags = /^compatibility_flags\s*=\s*(\[[^\]\n]*\])/m.exec(toml)?.[1];
  if (!date) throw new Error('wrangler.toml has no compatibility_date');
  return { date, flags: flags ?? '[]' };
}

/**
 * The probe's whole config. Flat (no `[env.*]`), so nothing of production's is
 * inherited; workers.dev only; one binding, `AI`; the gateway id and the
 * switches as vars on this Worker alone. Written beside `wrangler.toml`, so
 * `main` is relative to the repository root's `cloudflare-worker/`.
 */
export function renderProbeConfig({ worker, slug, toml }) {
  if (!gatewaySlugOk(slug)) throw new Error('the gateway id is not a valid AI Gateway id');
  const { date, flags } = productionCompat(toml);
  return [
    '# #4870 (D4870 part 2): the throwaway gateway live-check Worker. Written and',
    '# deleted by scripts/gateway-live-check.mjs. Never committed, never production.',
    `name = "${worker}"`,
    'main = "cloudflare-worker/src/probes/gatewayLiveCheck.ts"',
    `compatibility_date = "${date}"`,
    `compatibility_flags = ${flags}`,
    'workers_dev = true',
    '',
    '[ai]',
    'binding = "AI"',
    '',
    '[vars]',
    'ENVIRONMENT = "preview"',
    'STUDIOOS_ENV = "preview"',
    `CF_AI_GATEWAY_SLUG_PROVIDERS = "${slug}"`,
    'AI_GATEWAY_PROVIDERS_ZDR = "on"',
    '',
  ].join('\n');
}

/** The production identities a probe config must never carry. */
export function checkProbeConfig(text, worker) {
  const problems = [];
  if (/^\s*\[env\./m.test(text)) problems.push('an [env.*] table');
  if (/^\s*\[\[?routes\]?\]?|^\s*routes\s*=|^\s*route\s*=/m.test(text)) problems.push('a route');
  if (/custom_domain|axal\.vc/.test(text)) problems.push('a production host');
  if (/^\s*\[\[(d1_databases|kv_namespaces|r2_buckets|queues|durable_objects|services|workflows)/m.test(text)) problems.push('a binding other than AI');
  if (/^\s*\[triggers\]/m.test(text) || /^\s*crons\s*=/m.test(text)) problems.push('a cron');
  if (/AI_PROVIDER_GATEWAY_OPENAI/.test(text)) problems.push('the production switch');
  const name = /^name\s*=\s*"([^"]+)"/m.exec(text)?.[1];
  if (name !== worker || !/^studioos-s4870-[a-z0-9]+$/.test(name)) problems.push(`the name ${name ?? '(none)'}`);
  if (problems.length) throw new Error(`the probe config is refused: ${problems.join(', ')}`);
  return true;
}

const pick = (list, v) => { const i = list.indexOf(v); return i === -1 ? 'other' : list[i]; };
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Number(v) : null);
const LOG_STATES = Object.freeze(['absent', 'no_payload', 'payload_present', 'no_log_id']);
const ERRORS = Object.freeze(['auth', 'billing', 'rate_limited', 'overloaded', 'timeout', 'invalid', 'server', 'refused', 'unknown']);
const COMPLETIONS = Object.freeze(['none', 'unknown']);
const KEY_SOURCES = Object.freeze(['Unified', 'BYOK']);
const FINISH = Object.freeze(['stop', 'length', 'content_filter']);

/**
 * The probe's answer rebuilt from known fields only, for the summary file: every
 * string from a fixed list, every amount a finite number. Nothing the probe
 * sent is written as it came.
 */
export function probeFacts(p) {
  if (!p || typeof p !== 'object') return null;
  const call = p.call && typeof p.call === 'object' ? p.call : {};
  const u = p.usage && typeof p.usage === 'object' ? p.usage : null;
  const l = p.log && typeof p.log === 'object' ? p.log : {};
  return {
    latency_ms: num(p.latency_ms),
    call: call.ok === true
      ? { ok: true, finish_reason: pick(FINISH, call.finish_reason), output_chars: num(call.output_chars) }
      : { ok: false, status: num(call.status), error: pick(ERRORS, call.error), completion: pick(COMPLETIONS, call.completion), code: num(call.code) },
    pin: p.pin && typeof p.pin === 'object' ? { served_model_ok: p.pin.served_model_ok === true, key_source: pick(KEY_SOURCES, p.pin.key_source) } : null,
    usage: u ? { tokens_in: num(u.tokens_in), tokens_cached: num(u.tokens_cached), tokens_out: num(u.tokens_out) } : null,
    reasoning_tokens: num(p.reasoning_tokens),
    charge: { settled_microusd: num(p.charge?.settled_microusd) },
    log: { state: pick(LOG_STATES, l.state), reads: num(l.reads), tokens_in: num(l.tokens_in), tokens_out: num(l.tokens_out), cost_usd: num(l.cost_usd) },
    reconcile_marked: p.reconcile_marked === 1 ? 1 : p.reconcile_marked === 0 ? 0 : null,
  };
}

/** How close the gateway log's cost must be to D851's settled charge: a micro-dollar, or 1%. */
export const COST_TOLERANCE = Object.freeze({ microusd: 1, ratio: 0.01 });

/**
 * Items 1 and 2 of #4870, from the probe's answer:
 *   - `answered`: one call answered on Unified Billing (`keySource` Unified)
 *     with the row's model (the pin `runGatewayTextModel` applies);
 *   - `log`: the gateway log carries no payload (`logCarriesNoPayload`), or
 *     there is no log entry at all, which carries none either;
 *   - `cost`: the log's cost against D851's settled charge for the same usage
 *     at multiplier 1. With no log cost or no usage, it is `not_recorded`, a
 *     fail: the comparison is the point of item 2;
 *   - `reconcile_marked`: how many rows this call would have marked
 *     `reconcile: 'gateway_log'` (item 5's input). Reported, never a fail.
 */
export function liveCheckVerdict(p) {
  const fails = [];
  if (!p || typeof p !== 'object') return { verdict: 'fail', fails: ['the probe gave no answer'], checks: {} };
  const answered = p.call?.ok === true && p.pin?.served_model_ok === true && p.pin?.key_source === 'Unified';
  if (!answered) fails.push(p.call?.ok ? 'the answer failed the pin (served model or key source)' : `the call did not answer (${p.call?.error ?? 'unknown'})`);
  const log = p.log?.state;
  if (log !== 'no_payload' && log !== 'absent') fails.push(`the gateway log is ${log ?? 'unread'}`);
  let cost = 'not_recorded';
  let delta = null;
  const ours = p.charge?.settled_microusd;
  const theirs = p.log?.cost_usd;
  if (Number.isFinite(ours) && Number.isFinite(theirs)) {
    delta = Math.abs(ours - theirs * 1_000_000);
    cost = delta <= Math.max(COST_TOLERANCE.microusd, ours * COST_TOLERANCE.ratio) ? 'matches' : 'differs';
  }
  if (cost !== 'matches') fails.push(`the cost ${cost === 'differs' ? 'differs from D851\'s settled charge' : 'could not be compared'}`);
  const tokens = p.log?.tokens_in != null && p.usage
    ? { log_in: p.log.tokens_in, log_out: p.log.tokens_out ?? null, usage_in: p.usage.tokens_in + p.usage.tokens_cached, usage_out: p.usage.tokens_out }
    : null;
  return {
    verdict: fails.length ? 'fail' : 'pass',
    fails,
    checks: {
      answered, log: log ?? 'unread', cost, cost_delta_microusd: delta == null ? null : Math.round(delta * 1000) / 1000,
      tokens, reconcile_marked: Number.isSafeInteger(p.reconcile_marked) ? p.reconcile_marked : null,
    },
  };
}
