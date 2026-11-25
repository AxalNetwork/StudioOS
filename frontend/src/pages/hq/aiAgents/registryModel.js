/**
 * D8080 part 2 (#8080) — the HQ › AI agents › Roster › Registry model (boards SA20 to SA24, D4137-p4).
 *
 * Pure: `GET /api/admin/ai-agents/registry` (routes/admin_ai_agents_roster.ts) in, what the screen draws out.
 * The canvas is the layout; this file is what the platform records. Where the two differ:
 *   · `stage`, `cost_profile` and `security_profile` are NULL until the manifest schema records them (D8080):
 *     an entry with no stage sits in its own "Stage not recorded" group, never guessed into one of the five.
 *   · A platform agent has no `team_agents` copy, so its copies and drift arrive as null: Not recorded, never 0.
 *   · A venture entry with no live copy has nothing to compare: Not applicable.
 */

export const STAGES = Object.freeze([
  { key: 'research', label: 'Research' },
  { key: 'build', label: 'Build' },
  { key: 'raise', label: 'Raise' },
  { key: 'grow', label: 'Grow' },
  { key: 'operate', label: 'Operate' },
]);
export const NO_STAGE = Object.freeze({ key: 'none', label: 'Stage not recorded' });
export const STATUSES = Object.freeze({ live: 'Live', paused: 'Paused', retired: 'Retired' });
export const KINDS = Object.freeze({ platform: 'Platform', venture: 'Venture' });

export const REGISTRY_BASE = '/hq/ai-agents/roster/registry';
export const registryHref = (name) => `${REGISTRY_BASE}/${encodeURIComponent(name)}`;
/** The manifest file as the repository names it (D8079), not the canvas's drawn `agents/manifests/[slug]`. */
export const manifestPath = (name) => `agents/${name}.agent.yml`;

/** The registry read, as one of: not_recorded · recorded (with agents). Anything else is unreadable. */
export function readState(body) {
  if (body?.status === 'not_recorded') return 'not_recorded';
  if (body?.status === 'recorded' && Array.isArray(body.agents)) return 'recorded';
  return 'unreadable';
}

/** `n in m domains`, from `<domain>.<action>` names (D8079). */
export function capabilitySummary(caps) {
  const list = Array.isArray(caps) ? caps : [];
  const byDomain = new Map();
  for (const c of list) {
    const d = String(c).split('.')[0];
    byDomain.set(d, (byDomain.get(d) ?? 0) + 1);
  }
  const m = byDomain.size;
  return {
    count: list.length,
    domains: m,
    text: `${list.length} in ${m} domain${m === 1 ? '' : 's'}`,
    byDomain: [...byDomain.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  };
}

/**
 * The drift mark (SA22E): one of five, each a word, never colour alone.
 *   drift          fields disagree at the last sync ("Drift · n")
 *   agrees         compared, and every field agrees ("Agrees · 0", a measured zero)
 *   not_applicable a venture entry with no live copy: nothing to compare
 *   not_recorded   a platform agent: no D1 copy, so the sync does not compare it
 */
export function driftMark(a) {
  if (a?.drift_count == null || a?.live_copies == null) return { kind: 'not_recorded', label: 'Not recorded' };
  if (a.drift_count > 0) return { kind: 'drift', label: `Drift · ${a.drift_count}`, count: a.drift_count };
  if (!a.live_copies) return { kind: 'not_applicable', label: 'Not applicable' };
  return { kind: 'agrees', label: 'Agrees · 0', count: 0 };
}

/** Copies as the screen writes them: a count for a venture entry, Not recorded for a platform one. */
export const copiesText = (a) => (a?.live_copies == null ? 'Not recorded' : String(a.live_copies));
export const orNotRecorded = (v) => (v == null || v === '' ? 'Not recorded' : String(v));
export const stageLabel = (key) => (STAGES.find((s) => s.key === key) ?? NO_STAGE).label;

/** The filters kept in the address: `?stage=` (a stage key or `none`) and `?status=`; anything else is ignored. */
export function filtersFrom(search) {
  const p = new URLSearchParams(search || '');
  const stage = p.get('stage');
  const status = p.get('status');
  return {
    stage: stage && (stage === NO_STAGE.key || STAGES.some((s) => s.key === stage)) ? stage : '',
    status: status && Object.hasOwn(STATUSES, status) ? status : '',
    q: (p.get('q') ?? '').slice(0, 80),
  };
}

export function filtersSearch(f) {
  const p = new URLSearchParams();
  if (f.stage) p.set('stage', f.stage);
  if (f.status) p.set('status', f.status);
  if (f.q) p.set('q', f.q);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function filterAgents(agents, f) {
  const q = String(f?.q ?? '').trim().toLowerCase();
  return (agents ?? []).filter((a) => (!f?.stage || (a.stage ?? NO_STAGE.key) === f.stage)
    && (!f?.status || a.status === f.status)
    && (!q || a.name.toLowerCase().includes(q) || String(a.identity ?? '').toLowerCase().includes(q)));
}

/** The five stage groups in order, then "Stage not recorded"; an empty group is left out. */
export function stageGroups(agents) {
  const groups = [...STAGES, NO_STAGE].map((s) => ({ ...s, agents: (agents ?? []).filter((a) => (a.stage ?? NO_STAGE.key) === s.key) }));
  return groups.filter((g) => g.agents.length).map((g) => ({
    ...g,
    copies: g.agents.some((a) => a.live_copies != null) ? g.agents.reduce((t, a) => t + (a.live_copies ?? 0), 0) : null,
  }));
}

/** SA20's counts line. Copies count venture entries only; with none, the copies are not recorded. */
export function countsLine(agents) {
  const list = agents ?? [];
  const platform = list.filter((a) => a.kind === 'platform').length;
  const venture = list.filter((a) => a.kind === 'venture').length;
  const compared = list.filter((a) => a.live_copies != null);
  const copies = compared.length ? `${compared.reduce((t, a) => t + a.live_copies, 0)} live copies` : 'live copies not recorded';
  const drifting = list.filter((a) => (a.drift_count ?? 0) > 0);
  const fields = drifting.reduce((t, a) => t + a.drift_count, 0);
  const drift = compared.length ? `drift on ${drifting.length} ${drifting.length === 1 ? 'entry' : 'entries'} (${fields} field${fields === 1 ? '' : 's'})` : 'drift not compared';
  return `${list.length} ${list.length === 1 ? 'entry' : 'entries'} · ${platform} platform · ${venture} venture · ${copies} · ${drift}`;
}

/** "21 Nov 2026, 17:42 UTC" from a D1 `YYYY-MM-DD HH:MM:SS` (UTC) stamp; Not recorded when absent or unparsable. */
export function utcStamp(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(s ?? ''));
  if (!m) return 'Not recorded';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mon = months[Number(m[2]) - 1];
  if (!mon) return 'Not recorded';
  return `${Number(m[3])} ${mon} ${m[1]}, ${m[4]}:${m[5]} UTC`;
}

export const shortCommit = (sha) => (/^[0-9a-f]{7,40}$/.test(String(sha ?? '')) ? String(sha).slice(0, 7) : 'Not recorded');
export const shortDigest = (sha) => (/^[0-9a-f]{64}$/.test(String(sha ?? '')) ? `sha256:${sha.slice(0, 4)}…${sha.slice(-4)}` : 'Not recorded');

/** Where a drift row hands off (SAR-H): a capability to Policies, a budget to Spend, a status to Runs. */
export function driftHandoff(field) {
  if (field === 'capabilities') return { to: '/hq/ai-agents/operations/policies', label: 'Open Policies' };
  if (field === 'budgets') return { to: '/hq/ai-agents/operations/spend', label: 'Open Spend' };
  return { to: '/hq/ai-agents/operations', label: 'Open Runs' };
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  // A leading = + - @ would run as a formula in a spreadsheet; quote it as text.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** SA20's "Export CSV": what the screen shows, one row per entry; null stays empty, never 0. */
export function registryCsv(agents) {
  const head = ['name', 'version', 'stage', 'kind', 'owner', 'identity', 'runner_pool', 'status', 'capabilities', 'models', 'cost_profile', 'security_profile', 'live_copies', 'drift_fields', 'manifest_commit', 'synced_at'];
  const rows = (agents ?? []).map((a) => [a.name, a.version, a.stage, a.kind, a.owner, a.identity, a.runner_pool, a.status,
    (a.capabilities ?? []).join(' '), (a.models ?? []).join(' '), a.cost_profile, a.security_profile, a.live_copies, a.drift_count, a.manifest_commit, a.synced_at]);
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}
