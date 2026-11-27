/**
 * #7002 (X20): one reading of `GET /api/public/status` for both `/status` and
 * `/trust`, so the two pages never disagree. From the same record each page
 * draws the headline, the affected functions with their impact, the open
 * incident (with a link to it on `/status`) and its last update.
 *
 * Nothing here is a percentage (D1072), and nothing is inferred: a function
 * that a probe reports down with no incident on record says so, and its last
 * update is Not recorded, never the time the page was read.
 */
import { overallStatus } from './statusOverall.js';

/** The headline for the overall state, in the words `/status` has always used. */
export const OVERALL_WORDS = {
  operational: 'All monitored services operational',
  degraded: 'Degraded',
  down: 'Outage',
  unknown: 'Unknown',
};

/** One function's impact, in words. */
export const IMPACT_WORDS = { down: 'Outage', degraded: 'Degraded', unknown: 'Unknown' };

export const NO_INCIDENT_RECORDED = 'No incident has been recorded for this yet.';
export const LAST_UPDATE_NOT_RECORDED = 'Last update: Not recorded';

/** Where an incident is drawn on `/status`. */
export const incidentHref = (id) => `/status#incident-${encodeURIComponent(String(id))}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-11-16 14:05:00" or an ISO stamp → "16 Nov 2026, 14:05 UTC"; anything else → null. */
export function stampWords(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(v ?? ''));
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}, ${m[4]}:${m[5]} UTC`;
}

const isInventoryOnly = (s) => s?.monitoring === 'not_monitored' && s?.status === 'unknown';

/**
 * The status record as both pages show it:
 *   `{ state: 'unreadable' }` for a read with no services list, else
 *   `{ state: 'ready', overall, headline, affected: [{ name, impact }], incident, lastUpdate }`.
 * `incident` is the newest unresolved incident (`{ id, title, href }`) or null;
 * `lastUpdate` is its newest update (or its opening) in words, or null.
 */
export function statusSummary(data) {
  const services = Array.isArray(data?.services) ? data.services : null;
  if (!services) return { state: 'unreadable' };
  const overall = overallStatus(services);
  const affected = services
    .filter((s) => s && typeof s.name === 'string' && !isInventoryOnly(s) && s.status !== 'operational')
    .map((s) => ({ name: s.name, impact: IMPACT_WORDS[s.status] || IMPACT_WORDS.unknown }));
  const incidents = Array.isArray(data?.incidents) ? data.incidents : [];
  const open = incidents
    .filter((i) => i && i.status !== 'resolved' && typeof i.created_at === 'string')
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0] || null;
  const stamps = open ? [open.created_at, ...(Array.isArray(open.updates) ? open.updates.map((u) => u?.created_at) : [])].filter((x) => typeof x === 'string').sort() : [];
  return {
    state: 'ready',
    overall,
    headline: OVERALL_WORDS[overall] || OVERALL_WORDS.unknown,
    affected,
    incident: open ? { id: open.id, title: String(open.title || ''), href: incidentHref(open.id) } : null,
    lastUpdate: stamps.length ? stampWords(stamps.at(-1)) : null,
  };
}

/** The lines both pages print under the headline, in order: affected, then the incident or its absence, then the last update. */
export function summaryLines(s) {
  if (!s || s.state !== 'ready' || s.overall === 'operational') return [];
  const lines = [];
  if (s.affected.length) lines.push({ key: 'affected', text: `Affected: ${s.affected.map((a) => `${a.name} (${a.impact})`).join(', ')}` });
  lines.push(s.incident ? { key: 'incident', text: s.incident.title, href: s.incident.href } : { key: 'incident', text: NO_INCIDENT_RECORDED });
  lines.push({ key: 'updated', text: s.lastUpdate ? `Last update ${s.lastUpdate}` : LAST_UPDATE_NOT_RECORDED });
  return lines;
}
