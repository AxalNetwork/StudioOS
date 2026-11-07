/**
 * D4860 (#4860) — HQ · Platform v2's decision layer, pure for the Node test.
 *
 * The page already reads everything this needs: the platform summary
 * (`GET /api/admin/platform/summary`), the deployments registry, traffic by
 * branch (Analytics Engine, which is what "telemetry" means here) and the
 * build route. This file turns those reads into what the canvas
 * (`design/incoming/Platform v2 Page.dc.html`, PL-01 to PL-09) puts first:
 *
 *   signals        one per platform signal: its status word, the line the
 *                  health strip shows, and the attention items it raises
 *   platformHealth Healthy · Degraded · Unknown · Critical over EVERY
 *                  signal, not cron alone. An unread signal lowers
 *                  confidence and says why; it never reads as zero.
 *   attention      the Needs attention queue: Critical, High, Medium, Low,
 *                  Info, most severe first, each with one remediation link
 *   webhookHealth  Stripe webhook health that does not call silence healthy
 *   keyLevels      Required / Recommended / Optional for the managed keys
 *   switchRows     each switch by business meaning, grouped into active
 *                  overrides, deployment configuration and runtime safety
 *   coverage       capability coverage, read from the switch registry's
 *                  counts and the broadcast and deployment reads
 *   activity       a significant-events feed, from timestamps the reads carry
 *
 * NOTHING HERE IS FETCHED AND NOTHING IS INVENTED. A figure the reads do not
 * carry is `null` with its reason, and the page draws it as Not recorded.
 */

/** The fixed status vocabulary (D4860), each with the symbol it is drawn with. */
export const STATUS = {
  Healthy: { sym: '✓', tone: 'ok' },
  Degraded: { sym: '◐', tone: 'warn' },
  Critical: { sym: '✕', tone: 'bad' },
  Unknown: { sym: '?', tone: 'unknown' },
  Disabled: { sym: '–', tone: 'neutral' },
  'Not configured': { sym: '○', tone: 'neutral' },
  Stale: { sym: '◷', tone: 'warn' },
  Partial: { sym: '◑', tone: 'warn' },
  Available: { sym: '✓', tone: 'ok' },
  Unavailable: { sym: '✕', tone: 'bad' },
  Normal: { sym: '✓', tone: 'ok' },
  Tripped: { sym: '■', tone: 'bad' },
  Enabled: { sym: '●', tone: 'ok' },
  Error: { sym: '✕', tone: 'bad' },
  Unbound: { sym: '○', tone: 'neutral' },
  Configured: { sym: '●', tone: 'neutral' },
  'Verified recently': { sym: '✓', tone: 'ok' },
  'Verification stale': { sym: '◷', tone: 'warn' },
  'Not active': { sym: '–', tone: 'neutral' },
  Active: { sym: '■', tone: 'warn' },
  Reading: { sym: '…', tone: 'neutral' },
  'Not recorded': { sym: '○', tone: 'neutral' },
  Planned: { sym: '◇', tone: 'neutral' },
};

/** The severities of the Needs attention queue, most severe first. */
export const SEVERITIES = ['Critical', 'High', 'Medium', 'Low', 'Info'];
export const SEVERITY_SYM = { Critical: '■', High: '▲', Medium: '◆', Low: '●', Info: 'i' };

/** A dead-letter backlog at or above this is Critical; any backlog is High. */
export const DLQ_CRITICAL = 100;
/** This many failed webhook deliveries in a row, with none since, is Critical. */
export const WEBHOOK_CRITICAL_RUN = 3;
/** The webhook's silence threshold: no delivery for this long reads as Stale. */
export const WEBHOOK_SILENCE_HOURS = 24;
/** A Telegram channel tested within this many hours, with no error since, is Verified recently. */
export const VERIFIED_RECENTLY_HOURS = 24;
/** Nothing schedules a catalog sync, so a mirror older than this reads as Stale. */
export const CATALOG_STALE_DAYS = 7;

const HOUR = 3_600_000;

/**
 * A stored stamp as a Date. SQLite writes `YYYY-MM-DD HH:MM:SS` in UTC with no
 * zone, so a stamp without one is read as UTC rather than as local time.
 */
export function stampDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** `2026-11-07 14:22` from a stamp, always UTC. */
export function utcStamp(v) {
  const d = v instanceof Date ? v : stampDate(v);
  return d ? d.toISOString().slice(0, 16).replace('T', ' ') : null;
}

/** "4 d 15 h" / "3 h 20 m" / "12 m" between two times; null when either is missing. */
export function ageText(from, now) {
  const a = from instanceof Date ? from : stampDate(from);
  if (!a || !now) return null;
  const mins = Math.max(0, Math.floor((now.getTime() - a.getTime()) / 60_000));
  if (mins < 60) return `${mins} m`;
  const h = Math.floor(mins / 60);
  if (h < 48) return `${h} h ${mins % 60} m`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

/** A provider key as a name: its first letter capitalised, nothing else changed. */
const cap = (v) => { const t = String(v || ''); return t ? t[0].toUpperCase() + t.slice(1) : t; };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

/* ── managed keys: Required / Recommended / Optional ─────────────────── */

/**
 * D4860's proposal for the fourteen managed keys (services/providerOauthKeys
 * MANAGED_PROVIDERS), for the owner to confirm. None is Required: a key here
 * enables an integration or a channel, and the platform runs without each.
 * A provider this map does not know is Optional, never Required, so an
 * unknown key cannot raise a problem nobody declared.
 */
export const KEY_LEVEL = {
  gcip: ['Recommended', 'SMS backup two-factor sign-in needs it.'],
  github: ['Recommended', 'The support ticket mirror needs it.'],
  telegram: ['Recommended', 'Telegram broadcast needs it.'],
  stripe: ['Recommended', 'Members connecting their own Stripe account need it.'],
  slack: ['Optional', 'Only the Slack integration uses it.'],
  hubspot: ['Optional', 'Only the HubSpot integration uses it.'],
  salesforce: ['Optional', 'Only the Salesforce integration uses it.'],
  docusign: ['Optional', 'Only the DocuSign integration uses it.'],
  linkedin: ['Optional', 'Only the LinkedIn integration uses it.'],
  calendly: ['Optional', 'Only the Calendly integration uses it.'],
  carta: ['Optional', 'Only the Carta integration uses it.'],
  vercel: ['Optional', 'Only the Vercel integration uses it.'],
  crunchbase: ['Optional', 'Only the Crunchbase integration uses it.'],
  affinity: ['Optional', 'Only the Affinity integration uses it.'],
};
export const keyLevel = (provider) => (KEY_LEVEL[provider] || ['Optional', 'No requirement is declared for it.'])[0];

/**
 * The keys counted by requirement. A key that is unset counts as missing only
 * against its level; an optional key that is unset is "not configured", which
 * is a choice and not a problem. An unknown key is counted apart.
 */
export function keyLevels(keys) {
  if (!keys?.available) return null;
  const out = {};
  for (const lvl of ['Required', 'Recommended', 'Optional']) out[lvl] = { total: 0, set: 0, unset: [], unknown: 0 };
  for (const k of keys.items || []) {
    const b = out[keyLevel(k.provider_key)];
    b.total += 1;
    if (k.state === 'env' || k.state === 'db') b.set += 1;
    else if (k.state === 'unset') b.unset.push(k.provider_key);
    else b.unknown += 1;
  }
  return out;
}

/* ── the Stripe webhook ──────────────────────────────────────────────── */

const is2xx = (code) => code != null && code >= 200 && code < 300;

/**
 * Whether the webhook is PROVEN healthy (finding 5). Healthy needs a 2xx
 * delivery inside the silence threshold, and the newest delivery to be one.
 * Zero deliveries in the window is silence: Stale, never Healthy, whatever
 * "0 not 2xx" says. Expected activity has no baseline the platform records
 * (D4860 asks for its source), so it is Not recorded, not assumed.
 */
export function webhookHealth(payments, now) {
  const w = payments?.webhook;
  const configured = payments?.publishable?.configured;
  if (!w) return { state: 'Unknown', why: 'The platform summary could not be read.', fields: null };
  if (!w.available) return { state: 'Unknown', why: w.reason || 'The request log could not be read.', fields: null };
  const last = w.last || null;
  const lastOk = w.last_success === undefined ? undefined : w.last_success;
  const lastBad = w.last_failure === undefined ? undefined : w.last_failure;
  const run = Number.isFinite(w.consecutive_failures) ? w.consecutive_failures : null;
  const silentFor = last ? ageText(last.at, now) : null;
  const lastAge = last && now ? (now.getTime() - (stampDate(last.at)?.getTime() ?? 0)) / HOUR : null;
  const fields = {
    last_delivery: last ? `${utcStamp(last.at)} · ${last.status_code != null ? `HTTP ${last.status_code}` : 'status not recorded'}` : null,
    last_success: lastOk === undefined ? undefined : lastOk ? `${utcStamp(lastOk.at)} · HTTP ${lastOk.status_code}` : null,
    last_failure: lastBad === undefined ? undefined : lastBad ? `${utcStamp(lastBad.at)} · HTTP ${lastBad.status_code}` : null,
    consecutive_failures: run == null ? null : `${run}${w.consecutive_failures_capped ? '+' : ''}`,
    window: `${w.deliveries} in ${w.window_hours} h · ${w.not_2xx} not 2xx`,
    silence_threshold: `${WEBHOOK_SILENCE_HOURS} h`,
    latency: last?.latency_ms != null ? `${last.latency_ms} ms handling, newest delivery` : null,
  };
  if (run != null && run >= WEBHOOK_CRITICAL_RUN) {
    return { state: 'Critical', why: `${run}${w.consecutive_failures_capped ? '+' : ''} deliveries in a row were refused, with no success since.`, fields };
  }
  if (last && last.status_code != null && !is2xx(last.status_code)) {
    return { state: 'Degraded', why: `The newest delivery was answered HTTP ${last.status_code}.`, fields };
  }
  if (!last) {
    return {
      state: configured === false ? 'Not configured' : 'Unknown',
      why: configured === false
        ? 'No publishable key is configured and no delivery was ever recorded.'
        : 'No delivery has ever been recorded, so nothing proves the webhook works.',
      fields,
    };
  }
  if (w.deliveries === 0 || (lastAge != null && lastAge >= WEBHOOK_SILENCE_HOURS)) {
    return {
      state: 'Stale',
      why: `No delivery in the last ${w.window_hours} h: silent ${silentFor}. No failures is not proof of health when nothing arrived.`,
      fields,
    };
  }
  return { state: 'Healthy', why: `The newest delivery succeeded ${silentFor} ago.`, fields };
}

/* ── broadcast ───────────────────────────────────────────────────────── */

/**
 * A Telegram channel in the canvas's operational words (finding 11). The
 * stored state decides Unbound and Disabled; an error on the row is Error;
 * otherwise a test within VERIFIED_RECENTLY_HOURS is Verified recently, an
 * older one Verification stale, and none at all is merely Configured — never
 * "Ready" because it is configured.
 */
export function channelState(ch, now) {
  if (ch.state === 'unbound') return 'Unbound';
  if (ch.state === 'disabled') return 'Disabled';
  if (ch.last_error) return 'Error';
  const tested = stampDate(ch.last_test_at);
  if (!tested) return 'Configured';
  return now && (now.getTime() - tested.getTime()) / HOUR < VERIFIED_RECENTLY_HOURS ? 'Verified recently' : 'Verification stale';
}

/* ── switches by business meaning (finding 9) ────────────────────────── */

/**
 * Each switch the registry returns (services/platformSwitches), named for
 * what it means to a member. `on`/`off` are the registry's own state words;
 * the label never says "X off: off". A key this map does not know keeps its
 * registry label and its raw state, drawn as Unknown.
 */
const SWITCH_WORDS = {
  eadwyn_off: { name: 'Eadwyn', on: ['Unavailable', 'Eadwyn answers every message with a notice that it is unavailable.'], off: ['Available', 'Members and admins can ask Eadwyn, within plan allowances.'] },
  eadwyn_rerank_off: { name: 'Eadwyn question ranking', on: ['Disabled', 'Questions are asked in the bank\'s fixed order.'], off: ['Enabled', 'A model picks the most relevant question to ask next.'] },
  ai_budget_trip: { name: 'AI budget protection', on: ['Tripped', 'Every AI call on the platform is refused until the month\'s budget resets.'], off: ['Normal', 'AI calls are served; the router trips if this month\'s spend passes its cap.'] },
  session_charging: { name: 'Session charging', on: ['Enabled', 'Priced sessions are charged through Stripe.'], off: ['Disabled', 'No member is charged per session.'] },
  stripe_tax: { name: 'Stripe Tax', on: ['Enabled', 'Stripe computes tax on checkouts, invoices and subscriptions.'], off: ['Disabled', 'Tax is not calculated at checkout.'] },
  cf_queue: { name: 'Cloudflare Queue', on: ['Enabled', 'Background jobs run through the Cloudflare queue.'], off: ['Disabled', 'Background jobs run from the D1 job table.'] },
  market_sources_live: { name: 'Market sources', on: ['Enabled', 'Live sources call their providers; the rest serve stub rows.'], off: ['Disabled', 'Every market source serves its stub rows.'] },
  diligence_connectors_live: { name: 'Diligence connectors', on: ['Enabled', 'Switched-on connectors run during a diligence check.'], off: ['Disabled', 'No connector runs during a diligence check.'] },
};

/** The group a switch belongs to (D4860): active override, deployment configuration or runtime safety. */
export function switchGroup(sw) {
  if (sw.writable && sw.operator?.available && sw.operator.thrown) return 'override';
  if (sw.writable || sw.set_by === 'runtime') return 'safety';
  return 'deployment';
}

export function switchRows(switches) {
  if (!switches?.available) return null;
  return (switches.items || []).map((sw) => {
    const words = SWITCH_WORDS[sw.key];
    let state = 'Unknown';
    let impact = sw.effect || null;
    if (words && (sw.state === 'on' || sw.state === 'off')) [state, impact] = words[sw.state];
    if (sw.count && Number.isFinite(sw.count.on)) impact = `${sw.count.on} of ${sw.count.of} live. ${impact}`;
    return {
      key: sw.key,
      name: words?.name || sw.label,
      state,
      impact,
      group: switchGroup(sw),
      changeable: sw.writable ? 'HQ can throw it on Switches' : sw.set_by === 'runtime' ? 'The platform sets it' : 'A deploy changes it',
      last_changed: sw.operator?.available && sw.operator.set_at ? utcStamp(sw.operator.set_at) : null,
      reason: sw.state === 'unreadable' ? (sw.reason || 'Its store could not be read.') : null,
    };
  });
}

/* ── the signals ─────────────────────────────────────────────────────── */

const LINK = {
  monitoring: { to: '/monitoring', label: 'Open Monitoring' },
  payments: { to: '/admin/platform/payments', label: 'Open Payments' },
  keys: { to: '/admin/integration-keys', label: 'Review keys' },
  sync: { to: '/admin/integration-keys#github', label: 'Open GitHub sync' },
  telegram: { to: '/admin/telegram', label: 'Open Telegram' },
  x: { to: '/admin/x', label: 'Provision X' },
  switches: { to: '/admin/platform/switches', label: 'Open Switches' },
  usage: { to: '/admin/platform/ai-usage', label: 'Open AI usage' },
  topology: { to: '/admin/platform/topology', label: 'Open Topology' },
};

/**
 * Every signal the overview reads, each with its status, the strip's word,
 * and the attention items it raises. `observed` is when the page's read of it
 * answered — the reads are made by this page, so that is when it was seen.
 * Loading reads produce `Reading`, which the health rule never counts.
 */
export function signals({ data, deps, traffic, now, observed = {}, UNAVAILABLE }) {
  const out = [];
  const add = (s) => out.push({ items: [], ...s });
  const summaryLoading = data === null;
  const summaryDown = data === UNAVAILABLE;
  const d = summaryLoading || summaryDown ? null : data;
  const seen = observed.summary || null;

  // Telemetry: traffic by branch is the Analytics Engine read.
  if (traffic === null) add({ key: 'telemetry', name: 'Telemetry', status: 'Reading', line: 'reading' });
  else if (traffic === UNAVAILABLE || traffic?.available === false) {
    const why = traffic === UNAVAILABLE ? 'The metrics read did not answer.' : (traffic.reason || 'Analytics Engine returned no answer.');
    add({
      key: 'telemetry', name: 'Telemetry', status: 'Unknown', line: 'unavailable', why, core: true,
      items: [{ severity: 'Medium', title: 'Telemetry unavailable', detail: `${why} Traffic by branch and worker error rates cannot be confirmed, so health confidence is reduced.`, state: 'Unknown', observed: observed.traffic, link: { ...LINK.monitoring, label: 'Check telemetry' } }],
    });
  } else add({ key: 'telemetry', name: 'Telemetry', status: 'Healthy', line: 'reporting', core: true });

  // Scheduled jobs.
  const jobs = d?.jobs;
  if (summaryLoading) add({ key: 'jobs', name: 'Scheduled jobs', status: 'Reading', line: 'reading' });
  else if (!jobs?.available) add({ key: 'jobs', name: 'Scheduled jobs', status: 'Unknown', line: 'could not be read', why: jobs?.reason || 'The platform summary could not be read.', core: true, base: true });
  else {
    const n = jobs.triggers.length;
    const ok = jobs.triggers.filter((j) => j.state === 'ok').length;
    const failed = jobs.triggers.filter((j) => j.state === 'failed');
    const stale = jobs.triggers.filter((j) => j.state === 'stale');
    const items = [];
    for (const j of failed) items.push({ severity: 'High', title: `Scheduled job failing: ${j.name}`, detail: j.error || 'Its last run failed.', state: 'Error', since: utcStamp(j.last_started_at), observed: seen, link: LINK.monitoring });
    for (const j of stale) items.push({ severity: 'Medium', title: `Scheduled job silent: ${j.name}`, detail: `No run recorded since it was last due${j.expected_at ? ` at ${utcStamp(j.expected_at)}` : ''}.`, state: 'Stale', since: utcStamp(j.last_started_at), observed: seen, link: LINK.monitoring });
    add({
      key: 'jobs', name: 'Scheduled jobs', core: true, base: true,
      status: failed.length ? 'Degraded' : stale.length ? 'Stale' : ok === n ? 'Healthy' : 'Unknown',
      line: `${ok}/${n} healthy`,
      why: ok < n && !failed.length && !stale.length ? `${n - ok} declared ${n - ok === 1 ? 'trigger has' : 'triggers have'} never recorded a run.` : undefined,
      items,
    });
  }

  // Dead letters.
  const dlq = d?.monitoring?.dlq;
  if (summaryLoading) add({ key: 'dlq', name: 'DLQ', status: 'Reading', line: 'reading' });
  else if (!dlq?.available) add({ key: 'dlq', name: 'DLQ', status: 'Unknown', line: 'could not be read', why: dlq?.reason || 'The platform summary could not be read.', core: true, base: true });
  else {
    const crit = dlq.total >= DLQ_CRITICAL;
    add({
      key: 'dlq', name: 'DLQ', core: true, base: true, line: String(dlq.total),
      status: crit ? 'Critical' : dlq.total > 0 ? 'Degraded' : 'Healthy',
      items: dlq.total > 0 ? [{ severity: crit ? 'Critical' : 'High', title: `${plural(dlq.total, 'dead letter', 'dead letters')} waiting`, detail: `${dlq.legacy} from the D1 queue, ${dlq.mirror} from Cloudflare Queues.`, state: crit ? 'Critical' : 'Degraded', observed: seen, link: { ...LINK.monitoring, label: 'Inspect DLQ' } }] : [],
    });
  }

  // Integrations in error.
  const ints = d?.integrations;
  if (summaryLoading) add({ key: 'integrations', name: 'Integrations', status: 'Reading', line: 'reading' });
  else if (!ints?.available) add({ key: 'integrations', name: 'Integrations', status: 'Unknown', line: 'could not be read', why: ints?.reason || 'The platform summary could not be read.', core: true });
  else {
    const bad = (ints.providers || []).map((p) => ({ p, n: (p.by_status?.error || 0) + (p.by_status?.disconnected || 0) })).filter((x) => x.n > 0);
    add({
      key: 'integrations', name: 'Integrations', core: true,
      status: bad.length ? 'Degraded' : 'Healthy',
      line: bad.length ? `${plural(sum(bad.map((x) => x.n)), 'connection needs', 'connections need')} attention` : `${ints.total} healthy`,
      items: bad.map(({ p, n }) => ({ severity: 'High', title: `${cap(p.provider)} integration in error`, detail: `${plural(n, 'connection is', 'connections are')} in error or disconnected.`, state: 'Error', observed: seen, link: { ...LINK.keys, label: `Reconnect ${cap(p.provider)}` } })),
    });
  }

  // The Stripe webhook.
  const wh = summaryLoading ? null : webhookHealth(d?.payments_catalog, now);
  if (summaryLoading) add({ key: 'webhook', name: 'Stripe webhook', status: 'Reading', line: 'reading' });
  else {
    const sev = { Critical: 'Critical', Degraded: 'High', Stale: 'Medium', Unknown: 'Medium' }[wh.state];
    add({
      key: 'webhook', name: 'Stripe webhook', core: true, status: wh.state, why: wh.why,
      line: { Healthy: 'delivering', Stale: 'silent', Degraded: 'failing', Critical: 'failing', Unknown: 'unknown', 'Not configured': 'not configured' }[wh.state],
      // An unread summary raises no item of its own: the page says it once,
      // and the queue's empty state names every Unknown signal.
      items: sev && d ? [{ severity: sev, title: wh.state === 'Stale' ? 'Stripe webhooks silent' : wh.state === 'Unknown' ? 'Stripe webhook health unknown' : 'Stripe webhooks failing', detail: wh.why, state: wh.state, observed: seen, link: { ...LINK.payments, label: 'Verify webhook endpoint' } }] : [],
    });
  }

  // Branch deployments: a branch that answers with a failing database, or does not answer.
  if (deps === null) add({ key: 'branches', name: 'Branches', status: 'Reading', line: 'reading' });
  else if (deps === UNAVAILABLE || deps?.registry_available === false) add({ key: 'branches', name: 'Branches', status: 'Unknown', line: 'could not be read', why: deps === UNAVAILABLE ? 'The deployments list could not be read.' : deps.registry_reason });
  else {
    const asked = (deps.deployments || []).filter((x) => x.live_state !== 'not_deployed');
    const failing = asked.filter((x) => !(x.live_state === 'ok' && x.live?.db_ok === true));
    add({
      key: 'branches', name: 'Branches', status: failing.length ? 'Critical' : asked.length ? 'Healthy' : 'Not configured',
      line: asked.length ? `${asked.length - failing.length}/${asked.length} healthy` : 'none deployed',
      items: failing.map((x) => ({ severity: 'Critical', title: `Branch ${x.code} ${x.live_state === 'ok' ? 'database failing' : 'not answering'}`, detail: x.live?.detail || x.live_reason || 'The branch did not report a working database.', state: 'Critical', observed: observed.deps, link: LINK.topology })),
    });
  }

  // Switches: a thrown operator override, and the AI budget trip.
  const sws = d?.switches;
  if (summaryLoading) add({ key: 'overrides', name: 'HQ overrides', status: 'Reading', line: 'reading' });
  else if (!sws?.available) add({ key: 'overrides', name: 'HQ overrides', status: 'Unknown', line: 'could not be read', why: sws?.reason || 'The platform switches could not be read.' });
  else {
    const writable = sws.items.filter((s) => s.writable);
    const blind = writable.find((s) => !s.operator?.available);
    const thrown = writable.filter((s) => s.operator?.available && s.operator.thrown);
    const trip = sws.items.find((s) => s.key === 'ai_budget_trip');
    const items = thrown.map((s) => ({ severity: 'Medium', title: `Emergency override active: ${SWITCH_WORDS[s.key]?.name || s.label} ${SWITCH_WORDS[s.key]?.on?.[0]?.toLowerCase() || 'thrown'}`, detail: s.operator.reason || 'Thrown by HQ.', state: 'Active', since: utcStamp(s.operator.set_at), observed: seen, link: LINK.switches }));
    if (trip?.state === 'on') items.unshift({ severity: 'Critical', title: 'AI budget protection tripped', detail: 'Every AI call on the platform is refused until the month\'s budget resets.', state: 'Critical', observed: seen, link: LINK.usage });
    add({
      key: 'overrides', name: 'HQ overrides',
      status: trip?.state === 'on' ? 'Critical' : blind ? 'Unknown' : thrown.length ? 'Degraded' : 'Healthy',
      line: blind ? 'could not be read' : String(thrown.length),
      why: blind ? (blind.operator?.reason || 'The operator switch store could not be read.') : undefined,
      items,
    });
  }

  // Broadcast and keys: configuration, never a health failure on their own.
  const tg = d?.broadcast?.telegram;
  const x = d?.broadcast?.x;
  if (!summaryLoading && d) {
    const items = [];
    if (tg?.available) {
      for (const ch of tg.channels) {
        const st = channelState(ch, now);
        if (st === 'Unbound') items.push({ severity: 'Low', title: `Telegram ${ch.label} channel unbound`, detail: 'Posts for this channel have nowhere to go.', state: 'Unbound', observed: seen, link: { ...LINK.telegram, label: 'Bind channel' } });
        if (st === 'Error') items.push({ severity: 'Medium', title: `Telegram ${ch.label} channel error`, detail: ch.last_error, state: 'Error', observed: seen, link: LINK.telegram });
      }
      if (tg.token_configured === false) items.push({ severity: 'Low', title: 'No Telegram bot token', detail: 'No Telegram channel can send on this deployment.', state: 'Not configured', observed: seen, link: LINK.keys });
    }
    if (x && x.client_configured === false) items.push({ severity: 'Low', title: 'X OAuth not provisioned', detail: 'X broadcasting is unavailable.', state: 'Not configured', observed: seen, link: LINK.x });
    add({ key: 'broadcast', name: 'Broadcast', status: tg?.available ? (items.some((i) => i.state === 'Error') ? 'Degraded' : 'Healthy') : 'Unknown', line: '', items, config: true });

    const lv = keyLevels(d.integration_keys);
    const kItems = [];
    if (lv) {
      if (lv.Required.unset.length) kItems.push({ severity: 'High', title: `${plural(lv.Required.unset.length, 'required key', 'required keys')} not set`, detail: lv.Required.unset.join(', '), state: 'Not configured', observed: seen, link: LINK.keys });
      if (lv.Recommended.unset.length) kItems.push({ severity: 'Low', title: `${plural(lv.Recommended.unset.length, 'recommended key', 'recommended keys')} not set`, detail: `${lv.Recommended.unset.join(', ')}. The features that use them are off.`, state: 'Not configured', observed: seen, link: LINK.keys });
    }
    add({ key: 'keys', name: 'Integration keys', status: lv ? 'Healthy' : 'Unknown', line: '', items: kItems, config: true, levels: lv });

    const cat = d.payments_catalog?.catalog;
    if (cat?.available && cat.products && cat.products.active < cat.products.all) {
      add({ key: 'catalog', name: 'Catalog', status: 'Partial', line: '', config: true, items: [{ severity: 'Info', title: 'Stripe catalog partly inactive', detail: `${cat.products.active} of ${cat.products.all} products and ${cat.prices.active} of ${cat.prices.all} prices active. Confirm the inactive ones are intentional.`, state: 'Partial', since: utcStamp(cat.last_written_at), observed: seen, link: { ...LINK.payments, label: 'Review catalog' } }] });
    }

    const sync = d.github_sync;
    if (sync?.target && !sync.target.configured) add({ key: 'sync', name: 'GitHub sync', status: 'Not configured', line: '', config: true, items: [{ severity: 'Low', title: 'Ticket mirror off', detail: 'A ticket is still filed and reaches no GitHub issue.', state: 'Not configured', observed: seen, link: LINK.sync }] });
    else if (sync?.window?.available && sync.window.failed > 0) add({ key: 'sync', name: 'GitHub sync', status: 'Degraded', line: '', config: true, items: [{ severity: 'Medium', title: `${plural(sync.window.failed, 'ticket', 'tickets')} failed to mirror`, detail: `In the last ${sync.window.window_hours} h.`, state: 'Error', observed: seen, link: LINK.sync }] });
  }

  if (summaryDown) {
    for (const s of out) if (s.status === 'Reading') s.status = 'Unknown';
  }
  return out;
}

/* ── overall health ──────────────────────────────────────────────────── */

/**
 * D4860's rule. Critical when a known user-facing capability is failing (any
 * Critical signal). Unknown when the core base signals — the summary, or both
 * scheduled jobs and the dead-letter queue — cannot be read. Degraded when
 * anything else is wrong OR any core signal is unknown: unread is reduced
 * confidence, never a zero. Healthy only when every core signal was read and
 * is healthy. Configuration items (an unset optional key, an unbound
 * channel) are warnings in the queue and never lower health on their own.
 */
export function platformHealth(sigs, { summaryDown = false, loading = false } = {}) {
  if (loading) return { state: 'Reading', confidence: 'Reading the platform…' };
  const core = sigs.filter((s) => s.core);
  const unknown = core.filter((s) => s.status === 'Unknown');
  const base = sigs.filter((s) => s.base);
  const baseBlind = summaryDown || (base.length > 0 && base.every((s) => s.status === 'Unknown'));
  const critical = sigs.find((s) => s.status === 'Critical');
  if (critical) return { state: 'Critical', confidence: `${critical.name}: ${critical.items[0]?.detail || critical.why || 'failing'}` };
  if (baseBlind) {
    return { state: 'Unknown', confidence: `Health can't be determined: ${summaryDown ? 'the platform summary could not be read' : 'scheduled jobs and the dead-letter queue could not be read'}. Don't treat this as healthy.` };
  }
  const wrong = sigs.filter((s) => !s.config && ['Degraded', 'Stale', 'Partial'].includes(s.status));
  if (unknown.length || wrong.length) {
    const parts = [];
    if (unknown.length) parts.push(`Confidence reduced: ${unknown.map((s) => `${s.name.toLowerCase()} ${s.why ? `(${s.why.replace(/\.$/, '')})` : 'unknown'}`).join('; ')}.`);
    if (wrong.length) parts.push(`${wrong.map((s) => s.name).join(', ')} ${wrong.length === 1 ? 'needs' : 'need'} attention.`);
    return { state: 'Degraded', confidence: parts.join(' ') };
  }
  return { state: 'Healthy', confidence: 'Every core signal was read just now and is healthy.' };
}

/** The strip under the state: Telemetry · Integrations · Scheduled jobs · DLQ · HQ overrides. */
export function healthLine(sigs) {
  const order = ['telemetry', 'integrations', 'jobs', 'webhook', 'dlq', 'overrides'];
  return order.map((k) => sigs.find((s) => s.key === k)).filter(Boolean).map((s) => [s.name, s.line]);
}

/** The Needs attention queue: every item, most severe first, stable within a severity. */
export function attention(sigs) {
  const items = sigs.flatMap((s) => s.items.map((it) => ({ ...it, signal: s.key })));
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => SEVERITIES.indexOf(a.it.severity) - SEVERITIES.indexOf(b.it.severity) || a.i - b.i)
    .map(({ it }) => it);
}

/** The signals that could not be read, for the "nothing readable is wrong" state (PL-02 C). */
export const unknownSignals = (sigs) => sigs.filter((s) => s.status === 'Unknown');

/* ── capability coverage (finding 10) ────────────────────────────────── */

export function coverage({ data, deps, now, UNAVAILABLE }) {
  const d = data && data !== UNAVAILABLE ? data : null;
  const sw = d?.switches?.available ? d.switches.items : null;
  const count = (key) => {
    const s = sw?.find((x) => x.key === key);
    return s?.count && Number.isFinite(s.count.on) ? s.count : null;
  };
  const market = count('market_sources_live');
  const dil = count('diligence_connectors_live');
  const ints = d?.integrations?.available ? d.integrations : null;
  const tg = d?.broadcast?.telegram?.available ? d.broadcast.telegram : null;
  const x = d?.broadcast?.x;
  let broadcast = null;
  if (tg) {
    const states = tg.channels.map((ch) => channelState(ch, now));
    const total = tg.channels.length + (x ? 1 : 0);
    const verified = states.filter((s) => s === 'Verified recently').length;
    const configured = states.filter((s) => ['Configured', 'Verified recently', 'Verification stale'].includes(s)).length + (x?.client_configured ? 1 : 0);
    broadcast = { verified, configured, total };
  }
  const depsOk = deps && deps !== UNAVAILABLE && deps.registry_available !== false;
  return [
    { key: 'market', name: 'Market sources', value: market ? `${market.on} / ${market.of}` : null, note: market ? 'live' : 'not reported', pct: market && market.of ? Math.round((market.on / market.of) * 100) : null },
    { key: 'diligence', name: 'Diligence connectors', value: dil ? `${dil.on} / ${dil.of}` : null, note: dil ? (dil.on ? 'switched on' : 'none switched on') : 'not reported', pct: dil && dil.of ? Math.round((dil.on / dil.of) * 100) : null },
    { key: 'integrations', name: 'External integrations', value: ints ? String(ints.providers.length) : null, note: ints ? `providers with a connection · ${ints.unhealthy} in error` : 'not reported', pct: null },
    { key: 'broadcast', name: 'Broadcast channels', value: broadcast ? `${broadcast.verified} / ${broadcast.total}` : null, note: broadcast ? `verified recently · ${broadcast.configured} configured` : 'not reported', pct: broadcast && broadcast.total ? Math.round((broadcast.verified / broadcast.total) * 100) : null },
    { key: 'branches', name: 'Branch deployments', value: depsOk ? String((deps.deployments || []).length) : null, note: depsOk ? ((deps.deployments || []).length ? 'in the registry' : 'none provisioned') : deps === null ? 'reading' : 'could not be read', pct: null },
  ];
}

/* ── operational activity (hierarchy 4) ──────────────────────────────── */

/**
 * Significant events, from the timestamps the reads already carry. Each is a
 * thing that happened at a stored time; nothing is inferred between them.
 */
export function activity({ data, deps, UNAVAILABLE, limit = 8 }) {
  const d = data && data !== UNAVAILABLE ? data : null;
  const ev = [];
  const push = (at, kind, text, to) => { const t = stampDate(at); if (t) ev.push({ at: t, kind, text, to }); };
  if (d) {
    const w = d.payments_catalog?.webhook;
    if (w?.available) {
      if (w.last) push(w.last.at, 'Webhook', `Newest Stripe delivery · ${w.last.status_code != null ? `HTTP ${w.last.status_code}` : 'status not recorded'}`, '/admin/platform/payments');
      if (w.last_failure && w.last_failure.at !== w.last?.at) push(w.last_failure.at, 'Webhook', `Stripe delivery refused · HTTP ${w.last_failure.status_code}`, '/admin/platform/payments');
    }
    const cat = d.payments_catalog?.catalog;
    if (cat?.available && cat.last_written_at) push(cat.last_written_at, 'Catalog sync', `Stripe mirror written: ${cat.products.active}/${cat.products.all} products, ${cat.prices.active}/${cat.prices.all} prices active`, '/admin/platform/payments');
    if (d.jobs?.available) for (const j of d.jobs.triggers) if (j.state === 'failed') push(j.last_started_at, 'Scheduled job', `${j.name} failed${j.error ? ` · ${j.error}` : ''}`, '/monitoring');
    if (d.switches?.available) for (const s of d.switches.items) if (s.operator?.available && s.operator.set_at) push(s.operator.set_at, 'Switch', `${SWITCH_WORDS[s.key]?.name || s.label} override ${s.operator.thrown ? 'thrown' : 'released'} by HQ`, '/admin/platform/switches');
    if (d.integration_keys?.available) for (const k of d.integration_keys.items) if (k.last_set_at) push(k.last_set_at, 'Credential', `${k.provider_key} key saved`, '/admin/integration-keys');
    if (d.github_sync?.recent?.available) for (const t of d.github_sync.recent.items) if (t.status === 'failed') push(t.attempted_at, 'Integration', `Ticket #${t.ticket_id} failed to mirror`, '/admin/integration-keys#github');
  }
  if (deps && deps !== UNAVAILABLE) for (const b of deps.deployments || []) if (b.live_state && b.live_state !== 'ok' && b.live_state !== 'not_deployed') push(b.last_health_at, 'Deployment', `Branch ${b.code}: ${String(b.live_state).replace(/_/g, ' ')}`, '/admin/platform/topology');
  return ev.sort((a, b) => b.at - a.at).slice(0, limit);
}

/* ── detailed consoles, grouped by domain (PL-07, finding 12) ─────────── */

export const CONSOLE_GROUPS = [
  ['Infrastructure', [['Monitoring', '/monitoring', 'telemetry'], ['Topology', '/admin/platform/topology'], ['Storage', '/admin/platform/storage'], ['Meeting bots', '/admin/platform/meeting-bots'], ['Deployments & licences', '/admin/licences', 'branches']]],
  ['Payments', [['Payments & webhooks', '/admin/platform/payments', 'webhook'], ['Promo codes', '/admin/platform/promo-codes'], ['Bank accounts', '/admin/platform/bank-accounts'], ['Credit rules', '/admin/credit-rules']]],
  ['AI', [['AI allowances', '/admin/platform/allowances'], ['AI usage', '/admin/platform/ai-usage'], ['Scoring', '/admin/platform/scoring']]],
  ['Integrations', [['Integration keys', '/admin/integration-keys', 'keys'], ['GitHub sync', '/admin/integration-keys#github', 'sync'], ['Telegram', '/admin/telegram', 'broadcast'], ['X', '/admin/x']]],
  ['Controls', [['Switches', '/admin/platform/switches', 'overrides'], ['Security & audit', '/admin/security']]],
  ['Product', [['Product testing', '/admin/platform/product-testing'], ['Decks', '/admin/platform/decks']]],
];

/** Destinations that do not yet do what they advertise (finding 17): Preview / Planned. */
export const PREVIEW_CONSOLES = [
  ['Event syndication', '/admin/platform/event-syndication', 'Not built yet: nothing posts. Listed here so nobody relies on it.'],
];
