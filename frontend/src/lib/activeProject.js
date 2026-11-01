/**
 * D1413 (#3696, PF5) — the project selected in the switcher, on this device.
 *
 * The switcher lists companies with their projects nested and the standalone
 * projects under them. Picking a project selects it here and, when it sits in
 * a company the member belongs to, also makes that company active (the
 * switcher's `switchTo`), so every company-scoped read follows. It is client
 * state only (#3697 correction 9): the server's project scope does not change,
 * and nothing is sent.
 *
 * It lives in `localStorage` under `active_project`, as `{ id, name, company:
 * { uid, name } | null }`. Every read and write is in try/catch: a private
 * window, blocked site data or a throwing store still switches for this tab,
 * it is only not remembered.
 *
 * The sidebar's bottom block reads it through `useActiveProject`, so a project
 * pick draws "Project settings" (standalone) or "Company settings" (a project
 * in a company) without a page publishing a scope.
 */
import { useSyncExternalStore } from 'react';

export const ACTIVE_PROJECT_KEY = 'active_project';

const valid = (p) => p && p.id != null && String(p.id).trim() !== '';
const shape = (p) => (valid(p) ? {
  id: p.id,
  name: String(p.name || '').trim() || null,
  company: p.company && p.company.uid ? { uid: p.company.uid, name: p.company.name || null } : null,
} : null);

function load() {
  try {
    const raw = globalThis.localStorage?.getItem(ACTIVE_PROJECT_KEY);
    return raw ? shape(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

let current;
let loaded = false;
const listeners = new Set();
const read = () => {
  if (!loaded) { current = load(); loaded = true; }
  return current;
};

/** The selected project, or null. */
export const getActiveProject = () => read();

/** Select a project (or null to clear it); remembered on this device when the store allows. */
export function setActiveProject(project) {
  current = shape(project);
  loaded = true;
  try {
    if (current) globalThis.localStorage?.setItem(ACTIVE_PROJECT_KEY, JSON.stringify(current));
    else globalThis.localStorage?.removeItem(ACTIVE_PROJECT_KEY);
  } catch { /* not remembered; this tab still switches */ }
  for (const fn of listeners) fn();
  return current;
}

/**
 * PF5: pick a project. Its company, when the member belongs to it (`companies`
 * is the switcher's membership list), becomes the active company too. A
 * standalone project leaves the active company as it is.
 */
export function selectProject(project, { companies = [], switchTo = null } = {}) {
  const picked = setActiveProject(project);
  const uid = picked?.company?.uid;
  if (uid && typeof switchTo === 'function') {
    const row = (companies || []).find((c) => c.uid === uid);
    if (row) switchTo(row);
  }
  return picked;
}

/** Picking a company clears the project, so the sidebar follows the company alone. */
export const clearActiveProject = () => setActiveProject(null);

const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

/** The selected project, re-read when it changes. */
export function useActiveProject() {
  return useSyncExternalStore(subscribe, read, read);
}

/** Tests only: forget what was loaded, so the next read goes back to the store. */
export function resetActiveProjectForTests() {
  loaded = false;
  current = undefined;
}
