/**
 * D8070 part 2 (#8070) — the HQ › AI agents › Operations › Policies › Capabilities model (boards SA10 to SA14,
 * D4137-p2).
 *
 * Pure: `GET /api/admin/ai-agents/policy/capabilities` (routes/admin_ai_agents_policy.ts, D8070) in, what the
 * matrix draws out. The canvas is the layout; this file is what the platform records. Where the two differ:
 *   · The ceiling is a standing setting (`ai_agent_policy.capability_ceiling_json`) with no month on it, so the
 *     screen says "as set now", never a month. A null ceiling offers every grantable name; an unreadable policy
 *     (`policy: null`) is Unreadable, never "nothing offered".
 *   · No team is recorded on a matrix row, so there is no team filter.
 *   · The last use of a capability is not recorded, so "Last used" reads Not recorded and Eadwyn's unused-grant
 *     proposal is not drawn.
 * The five reserved names are locked whatever a read says: a row that claimed one was grantable would still be
 * drawn locked, because the Worker refuses them (`capability_ungrantable`) at every check.
 */

/** The five names a person does. They exist so a refusal can name them; no agent is ever granted one (D8070). */
export const RESERVED = Object.freeze(['code.merge', 'deploy.production', 'cloud.write', 'finance.execute', 'email.send']);

/** The catalogue in the canvas's order (DOM on SA10): domain by domain, reserved names last in their domain. */
export const CANONICAL = Object.freeze([
  'research.read', 'research.write', 'company.read', 'company.write', 'fund.read',
  'relationships.read', 'relationships.request-introduction',
  'code.read', 'code.branch', 'code.commit', 'code.pr', 'code.merge',
  'deploy.preview', 'deploy.staging', 'deploy.production', 'cloud.read', 'cloud.write',
  'finance.read', 'finance.execute', 'legal.read', 'legal.draft', 'email.read', 'email.draft', 'email.send', 'web.search',
]);

/** SA10 opens with these domains expanded; the rest show "granted of grantable". */
export const DEFAULT_EXPANDED = Object.freeze(['research', 'company', 'fund', 'code', 'web']);

export const STATUS_WORDS = Object.freeze({ active: 'Active', paused: 'Paused', removed: 'Removed' });

/** D4137-p2 draws 10 to 200 characters (the brief's ≤ 200); the Worker takes 1 to 200 and is the last word. */
export const REASON_MIN = 10;
export const REASON_MAX = 200;
export const reasonLength = (s) => String(s ?? '').trim().length;
export const reasonOk = (s) => reasonLength(s) >= REASON_MIN && reasonLength(s) <= REASON_MAX;

export const CAPABILITIES_BASE = '/hq/ai-agents/operations/policies/capabilities';
/** The run's detail lives on Operations › Runs, which opens `?run=` (the canvas draws the handoff to Audit). */
export const runHref = (uid) => `/hq/ai-agents/operations?run=${encodeURIComponent(uid)}`;

/** The read is recorded (a catalogue and agents) or unreadable. A refusal is told apart by its status. */
export function readState(body) {
  return Array.isArray(body?.catalogue) && Array.isArray(body?.agents) ? 'recorded' : 'unreadable';
}

const rank = (name) => {
  const i = CANONICAL.indexOf(name);
  return i === -1 ? CANONICAL.length : i;
};

/** Catalogue rows in the canvas's order; a name the canvas does not know goes last, by name. */
export function orderCatalogue(catalogue) {
  return [...(catalogue ?? [])].sort((a, b) => rank(a.name) - rank(b.name) || String(a.name).localeCompare(String(b.name)));
}

/** A reserved name is locked even if a row said otherwise; so is any row the catalogue marks ungrantable. */
export const isLocked = (entry) => !entry || entry.grantable !== true || RESERVED.includes(entry.name);

/** The domains in order, each with its entries and its grantable names. */
export function domainsOf(catalogue) {
  const out = [];
  for (const e of orderCatalogue(catalogue)) {
    const d = String(e.domain ?? String(e.name).split('.')[0]);
    let g = out.find((x) => x.domain === d);
    if (!g) { g = { domain: d, entries: [], grantable: [] }; out.push(g); }
    g.entries.push(e);
    if (!isLocked(e)) g.grantable.push(e.name);
  }
  return out;
}

/** The platform ceiling for one name: locked, unreadable (policy not read), offered or not offered. */
export function ceilingState(entry, policy) {
  if (isLocked(entry)) return 'locked';
  if (!policy) return 'unreadable';
  if (policy.ceiling == null) return 'offered';
  return Array.isArray(policy.ceiling) && policy.ceiling.includes(entry.name) ? 'offered' : 'not_offered';
}

/** How many grantable names the platform offers; null when the policy could not be read. */
export function offeredCount(catalogue, policy) {
  if (!policy) return null;
  return (catalogue ?? []).filter((e) => ceilingState(e, policy) === 'offered').length;
}

export const cellOf = (agent, name) => (agent?.cells ?? []).find((c) => c.capability === name) ?? null;
export const holds = (agent, name) => cellOf(agent, name)?.granted === true;

/**
 * One cell: locked (the reserved names), granted, not offered (outside the ceiling and not held) or not granted.
 * A grant held outside the ceiling stays Granted: the Worker refuses it at check time once enforced, but the grant
 * row is still there, and hiding it would hide what a revoke would remove.
 */
export function cellState(agent, entry, policy) {
  if (isLocked(entry)) return 'locked';
  if (holds(agent, entry.name)) return 'granted';
  if (ceilingState(entry, policy) === 'not_offered') return 'not_offered';
  return 'not_granted';
}

export const CELL_WORDS = Object.freeze({ granted: 'Granted', not_granted: 'Not granted', locked: 'Locked', not_offered: 'Not offered' });

/** The accessible name of a cell, as the handoff writes it: "[Pitch Writer], email.draft: granted". */
export const cellLabel = (agentName, name, state) => `${agentName}, ${name}: ${(CELL_WORDS[state] ?? state).toLowerCase()}`;

/** A collapsed domain on an agent's row: granted of grantable, "1/2". */
export function domainCount(agent, group) {
  const granted = group.grantable.filter((n) => holds(agent, n)).length;
  return { granted, of: group.grantable.length, text: `${granted}/${group.grantable.length}` };
}

/** A collapsed domain on the ceiling row: offered of grantable, or null when the policy is unreadable. */
export function ceilingDomainCount(group, policy, catalogue) {
  if (!policy) return null;
  const byName = new Map((catalogue ?? []).map((e) => [e.name, e]));
  const on = group.grantable.filter((n) => ceilingState(byName.get(n), policy) === 'offered').length;
  return { offered: on, of: group.grantable.length, text: `${on}/${group.grantable.length}` };
}

export const agentName = (a) => [a?.first_name, a?.last_name].filter((x) => typeof x === 'string' && x.trim()).join(' ') || roleLabel(a?.role_key);
export function roleLabel(key) {
  const s = String(key ?? '').replace(/[_-]+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : 'Role not recorded';
}
export const statusWord = (s) => STATUS_WORDS[s] ?? 'Status not recorded';

/** Live grants over every agent, or null when no grant was ever recorded (SA12B: Not recorded, not 0). */
export function grantCount(agents) {
  const list = agents ?? [];
  if (!list.some((a) => (a.cells ?? []).length)) return null;
  return list.reduce((t, a) => t + (a.cells ?? []).filter((c) => c.granted === true).length, 0);
}

/** SA10's summary line, as parts the screen draws (a null part is drawn as its state, never as 0). */
export function summary(data) {
  const catalogue = data?.catalogue ?? [];
  const grantable = catalogue.filter((e) => !isLocked(e)).length;
  return {
    agents: (data?.agents ?? []).length,
    grants: grantCount(data?.agents),
    offered: offeredCount(catalogue, data?.policy ?? null),
    grantable,
    locked: catalogue.filter((e) => isLocked(e)).length,
  };
}

/** The filters kept in the address: `?role=`, `?status=` (active or paused) and `?q=`; anything else is dropped. */
export function filtersFrom(search, agents) {
  const p = new URLSearchParams(search || '');
  const role = p.get('role') ?? '';
  const status = p.get('status') ?? '';
  const roles = new Set((agents ?? []).map((a) => a.role_key));
  return {
    role: role && (!agents || roles.has(role)) ? role : '',
    status: status === 'active' || status === 'paused' ? status : '',
    q: (p.get('q') ?? '').slice(0, 80),
  };
}

export function filtersSearch(f) {
  const p = new URLSearchParams();
  if (f.role) p.set('role', f.role);
  if (f.status) p.set('status', f.status);
  if (f.q) p.set('q', f.q);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function filterAgents(agents, f) {
  const q = String(f?.q ?? '').trim().toLowerCase();
  return (agents ?? []).filter((a) => (!f?.role || a.role_key === f.role)
    && (!f?.status || a.status === f.status)
    && (!q || agentName(a).toLowerCase().includes(q) || roleLabel(a.role_key).toLowerCase().includes(q)));
}

/** The roles on the matrix, for the role filter, by label. */
export function roleChoices(agents) {
  return [...new Set((agents ?? []).map((a) => a.role_key).filter(Boolean))]
    .map((key) => ({ key, label: roleLabel(key) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Q1 = A: "Apply to role" grants the same name to every other live agent of the same role, one grant each, through
 * the same route. Those already holding it are named and left alone.
 */
export function roleMates(agents, agent, name) {
  const mates = (agents ?? []).filter((a) => a.uid !== agent?.uid && a.role_key === agent?.role_key);
  return { toGrant: mates.filter((a) => !holds(a, name)), already: mates.filter((a) => holds(a, name)) };
}

/** "21 Nov 2026, 17:42 UTC" from a D1 stamp; null when absent or unparsable (the caller draws Not recorded). */
export function utcStamp(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(s ?? ''));
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mon = m ? months[Number(m[2]) - 1] : null;
  return mon ? `${Number(m[3])} ${mon} ${m[1]}, ${m[4]}:${m[5]} UTC` : null;
}

/** "20 Nov" for a matrix row (SA10 draws the day; the panel and the phone card give the full stamp). */
export const shortDay = (s) => (utcStamp(s) ? utcStamp(s).split(' ').slice(0, 2).join(' ') : null);

const who = (name) => (typeof name === 'string' && name.trim() ? name : 'a person whose name is not recorded');
const when = (s) => utcStamp(s) ?? 'a time not recorded';

/** "Now": granted by whom, when and why; or not granted. */
export function nowLine(cell) {
  if (cell?.granted) return { granted: true, text: `Granted by ${who(cell.granted_by)} · ${when(cell.granted_at)}`, reason: cell.grant_reason ?? null };
  return { granted: false, text: 'Not granted', reason: null };
}

/** "Last change": the last revoke and the grant before it, or that no change is recorded for this pair. */
export function lastChangeLine(cell) {
  if (!cell) return { recorded: false, text: 'Not recorded: this agent has never held this capability.' };
  if (cell.granted) return { recorded: true, text: `Granted by ${who(cell.granted_by)} · ${when(cell.granted_at)}`, reason: cell.grant_reason ?? null };
  return {
    recorded: true,
    text: `Revoked by ${who(cell.revoked_by)} · ${when(cell.revoked_at)}`,
    reason: cell.revoke_reason ?? null,
    before: `Granted before by ${who(cell.granted_by)} on ${when(cell.granted_at)}.`,
  };
}

/** Q2 = A: the line under every panel. Enforcement is read, never switched here (D8070's rollout question). */
export function effectLine(enforced) {
  const base = 'Applies from the agent’s next run. Runs already going finish under the capabilities they started with.';
  if (enforced === true) return base;
  if (enforced === false) return `${base} Enforcement is off: until a Super Admin turns it on, the Worker refuses only the five reserved names.`;
  return `${base} Whether enforcement is on could not be read.`;
}

/** The revoke's review: what the agent keeps, and what its next run that needs the name will meet. */
export function revokeReview(agent, name, enforced) {
  const keeps = (agent?.cells ?? []).filter((c) => c.granted && c.capability !== name).map((c) => c.capability);
  const keep = keeps.length ? `${agentName(agent)} keeps ${keeps.join(', ')}.` : `${agentName(agent)} keeps no other capability.`;
  const next = enforced === true
    ? `Its next run that needs ${name} is refused with capability_missing.`
    : `Once enforcement is on, its next run that needs ${name} is refused with capability_missing.`;
  return `${keep} ${next} You can grant it again at any time.`;
}

/**
 * A refusal in the Worker's words: its code and its own sentence (`{ error, message }`, D278). A request that
 * got no answer has neither, and says so; `e.message` (a network error's text) is never shown.
 */
export function workerRefusal(e) {
  const d = e?.data && typeof e.data === 'object' ? e.data : null;
  const code = typeof d?.error === 'string' ? d.error : typeof d?.code === 'string' ? d.code : typeof e?.code === 'string' ? e.code : null;
  const message = typeof d?.message === 'string' && d.message.trim() ? d.message : typeof d?.detail === 'string' && d.detail.trim() ? d.detail : null;
  if (!code && !message) return { code: null, message: null, answered: false };
  return { code, message, answered: true };
}

/** The read's outcome from what the client threw: a 403 is Refused (not a super admin); anything else Unreadable. */
export const readFailure = (e) => (Number(e?.status) === 403 ? 'refused' : 'unreadable');

/**
 * The last refusal of one agent, from the run log filtered to its refused runs (newest first) and that run's detail.
 * none: the log answered with no refused run (a measured absence). The code is the run's recorded refusal;
 * a refused run with no code reads Not recorded.
 */
export function lastRefusalFrom(runsBody, runBody) {
  if (!Array.isArray(runsBody?.runs)) return { state: 'unreadable' };
  const run = runsBody.runs[0];
  if (!run) return { state: 'none' };
  const errors = Array.isArray(runBody?.run?.errors) ? runBody.run.errors : null;
  const code = errors?.find((x) => typeof x?.code === 'string')?.code ?? null;
  return { state: 'recorded', uid: run.uid, at: run.at ?? null, code };
}

/** The capability-matrix address keeps the filters; a cell's panel keeps no address of its own. */
export const capabilitiesHref = (f) => `${CAPABILITIES_BASE}${filtersSearch(f ?? {})}`;
