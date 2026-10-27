/**
 * D1096 (#2961) — Vercel's Choose projects, kept pure so its tests read it
 * without a browser. The Worker's `GET /:uid/action/projects` lists what the
 * installation reaches; `PATCH /:uid/config` takes the venture and the chosen
 * projects, and refuses any other id.
 */

/** The most projects one connection reads for a venture (`MAX_PROJECTS` in the provider). */
export const MAX_PROJECTS = 50;

const SENTENCES = {
  project_not_accessible: 'One of those projects is no longer in the Vercel integration. Read the list again, then choose.',
  too_many_projects: `Choose at most ${MAX_PROJECTS} projects.`,
  project_not_enabled: 'Choose a venture in a company this connection is enabled for.',
  company_not_enabled: 'This connection is not enabled for your company. Turn it on under Companies.',
  vercel_reconnect_required: 'Vercel no longer accepts this connection. Connect Vercel again.',
  vercel_rate_limited: 'Vercel asked Axal VC to slow down. Try again in a minute.',
  vercel_unreadable: 'Vercel could not be read. Try again.',
  action_failed: 'Vercel could not be read. Try again.',
};

/** A refusal's sentence: the Worker's own words when it sent some, else ours for its code. */
export function vercelRefusal(e) {
  const code = e?.code || '';
  const msg = typeof e?.message === 'string' ? e.message.trim() : '';
  if (msg && Object.hasOwn(SENTENCES, msg)) return SENTENCES[msg];
  if (msg && msg !== code && !/^[a-z0-9_]+$/.test(msg)) return msg;
  if (code && Object.hasOwn(SENTENCES, code)) return SENTENCES[code];
  return 'Vercel could not be read. Try again.';
}

/** The action's answer, shaped for the page; anything malformed reads as nothing reachable, never as a pick. */
export function projectsRead(result) {
  const r = result?.result ?? result ?? {};
  const available = (Array.isArray(r.available) ? r.available : [])
    .filter((p) => typeof p?.id === 'string' && typeof p?.name === 'string')
    .map((p) => ({ id: p.id, name: p.name, framework: typeof p.framework === 'string' && p.framework ? p.framework : null }));
  const ids = new Set(available.map((p) => p.id));
  const selected = (Array.isArray(r.selected) ? r.selected : []).filter((id) => ids.has(id));
  const projectId = Number(r.project_id);
  return { selection: r.selection === 'selected' ? 'selected' : 'all', available, selected, projectId: Number.isSafeInteger(projectId) && projectId > 0 ? projectId : null };
}

/** What the empty list says: it is never "0 projects". */
export function emptyProjects(selection) {
  return selection === 'selected'
    ? 'The integration reaches no project. Add projects to it on Vercel, then read the list again.'
    : 'This Vercel account has no project yet. Create one on Vercel, then read the list again.';
}

/** The confirm dialog's sentence: what saving changes, and what it does not. */
export function saveSentence(count, ventureName) {
  const what = `${count} ${count === 1 ? 'project' : 'projects'}`;
  const where = ventureName ? ` for ${ventureName}` : '';
  return `Axal VC will read ${what}${where} and sync them now. Nothing changes on Vercel.`;
}

/** The ventures the member may pick, with their names. */
export function ventureOptions(list) {
  const items = Array.isArray(list) ? list : list?.items || list?.projects || [];
  return items.filter((p) => Number.isSafeInteger(Number(p?.id)) && Number(p.id) > 0)
    .map((p) => ({ id: Number(p.id), name: typeof p.name === 'string' && p.name ? p.name : `Venture ${p.id}` }));
}
