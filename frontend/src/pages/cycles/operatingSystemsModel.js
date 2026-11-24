/**
 * D5078 (#5078; Build v2 boards BD20 A, B and C, BD12, BD24 B) — Operating
 * systems as three sections, Systems · Cadence · Tools, as data. Pure: no React,
 * so `node --test` reads it.
 *
 * The section is the address's hash (`#systems`, `#cadence`, `#tools`), so the
 * Build-level Tools destination (`/build/operating-systems#tools`, D6029) opens
 * Tools, and a link to a section survives a reload. No hash is Systems.
 *
 * The Worker decides every state and action (`parts.systems`, `parts.tools`,
 * `services/operatingSystemsView.ts`); these words only say them.
 */

export const OS_SECTIONS = Object.freeze([
  Object.freeze({ key: 'systems', name: 'Systems' }),
  Object.freeze({ key: 'cadence', name: 'Cadence' }),
  Object.freeze({ key: 'tools', name: 'Tools' }),
]);

/** The section an address's hash names; Systems for none or for one this page does not have. */
export function sectionOf(hash) {
  const key = String(hash || '').replace(/^#/, '').trim().toLowerCase();
  return OS_SECTIONS.some((s) => s.key === key) ? key : 'systems';
}

/** The one canonical home of the operating rituals: the cadence workflow, with the venture kept. */
export const cadenceHref = (search = '') => `/build/cadence${ventureQuery(search)}`;
/** Where a company is formed (BD20 A, BD24 B). */
export const companyCreationHref = (search = '') => `/build/company-creation${ventureQuery(search)}`;

/** `?project_id=<n>` from a page's query (`project_id` or `project`), or nothing. */
export function ventureQuery(search = '') {
  const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  const id = params.get('project_id') || params.get('project');
  return id && /^\d+$/.test(id) ? `?project_id=${id}` : '';
}

/** True when the read says this venture has no company yet: one prerequisite, never five failures. */
export const companyMissing = (data) => data?.parts?.systems?.state === 'not_recorded'
  || (data?.card?.state === 'not_recorded' && !data?.parts?.systems);

const STATE_WORD = { connected: 'Connected', failing: 'Failing', disconnected: 'Reconnect required', not_connected: 'Not connected' };
const STATE_TONE = { connected: 'ok', failing: 'bad', disconnected: 'warn', not_connected: 'grey' };

/** One system row as the page draws it: the state's word and tone, one line, and the action or why there is none. */
export function systemRowView(row) {
  const state = Object.hasOwn(STATE_WORD, row?.state) ? row.state : 'not_connected';
  const href = typeof row?.action?.href === 'string' && row.action.href.startsWith('/') ? row.action.href : null;
  return {
    kind: String(row?.kind || ''),
    label: String(row?.label || row?.kind || 'System'),
    provider: typeof row?.provider === 'string' && row.provider ? row.provider : null,
    state, word: STATE_WORD[state], tone: STATE_TONE[state],
    line: typeof row?.line === 'string' && row.line ? row.line : 'Not recorded',
    why: typeof row?.why === 'string' && row.why ? row.why : null,
    owner: typeof row?.owner === 'string' && row.owner ? row.owner : null,
    action: href ? { text: String(row.action.text || 'Open'), href, primary: row.action.intent === 'reconnect' } : null,
    reason: typeof row?.reason === 'string' && row.reason ? row.reason : null,
  };
}

/** "3 connected · 1 failing · 1 not connected", leaving out a count of none. */
export function systemsSummaryText(summary) {
  if (!summary || typeof summary !== 'object') return '';
  const n = (k) => (Number.isSafeInteger(summary[k]) ? summary[k] : 0);
  return [
    [n('connected'), 'connected'], [n('failing'), 'failing'], [n('disconnected'), 'to reconnect'], [n('not_connected'), 'not connected'],
  ].filter(([count]) => count > 0).map(([count, word]) => `${count} ${word}`).join(' · ');
}

/**
 * BD20 C: the rituals the cadence workflow holds, from its own read
 * (`GET /api/founder/cadence/:projectId`): each active ritual with its kind,
 * and its last filed run. Nothing here is a second store.
 */
export function cadenceView(read) {
  if (!read || typeof read !== 'object') return { state: 'unavailable', rituals: [] };
  if (read.store_ready === false) return { state: 'not_recorded', rituals: [] };
  const runs = Array.isArray(read.runs) ? read.runs : [];
  const rituals = (Array.isArray(read.rituals) ? read.rituals : [])
    .filter((r) => r && Number(r.active) !== 0)
    .map((r) => {
      const last = runs.find((run) => run && Number(run.ritual_id) === Number(r.id)) || null;
      return { id: r.id, name: String(r.name || 'Ritual'), kind: r.kind ?? null, weekday: r.weekday ?? null, frequency: r.frequency ?? null, last };
    });
  return { state: rituals.length ? 'ok' : 'empty', rituals };
}

/** A filed run's state in words: the archive's own two (`RUN_STATES` in `founder_cadence.ts`). */
export const RUN_WORD = Object.freeze({ done: 'Done', missed: 'Missed' });
