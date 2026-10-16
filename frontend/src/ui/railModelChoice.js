import { safeReadJSON, safeWriteJSON } from '../lib/storage';
import { railPrefsApi } from '../lib/api/railPrefs.js';
import { ASSIST_MODE_PREFIX, seedAssistModes } from '../hooks/useAssistMode';

/**
 * The model a founder picked on the Eadwyn AI rail, per section and per task.
 *
 * PER TASK, because the router's menus are per task: `validate_tag_pains`
 * offers the 3B and `validate_draft_hypotheses` does not (aiRouter.ts says
 * why). One choice per section would send the 3B to a task that refuses it.
 *
 * PER SECTION, not per zone (D402): a founder picks on Validate and every
 * Validate zone follows. The rail writes this and `FillProposals` reads it
 * when its button is pressed, so the choice on the rail is the model the run
 * asks for. The router still checks it against the task's `alternates`, and a
 * refusal clears it.
 *
 * ON THE WORKER, WITH THIS BROWSER AS THE CACHE (D698). The pick and the
 * assist mode live in `ai_rail_preferences` (migration 465), so a choice made
 * on a laptop is in place on a phone. `readRailModel` stays synchronous and
 * reads the cache, so `FillProposals` does not wait on a request:
 *   · `syncRailPrefs()` reads the Worker once per page load and seeds both
 *     caches. A server row wins over a local value.
 *   · A local value with no server row is written up, once.
 *   · `writeRailModel` writes both. A `model_not_offered` refusal clears the
 *     local value too, so the next run asks for the router's default.
 *   · Signed out, or when the read fails, the local values stand and nothing
 *     is drawn as an error: a preference is not a fact the page reports.
 */
export const RAIL_MODEL_PREFIX = 'worker_rail_model:';

const sectionOf = (workspace) => String(workspace || '').toLowerCase().trim();

export const railModelKey = (workspace, task) =>
  `${RAIL_MODEL_PREFIX}${sectionOf(workspace)}:${task}`;

/** The stored id, or null. Never a default: the router owns the default. */
export function readRailModel(workspace, task) {
  const id = safeReadJSON(railModelKey(workspace, task), null);
  return typeof id === 'string' && id ? id : null;
}

/** The router's refusal for a model the task does not offer (routes/ai.ts). */
const notOffered = (e) => e?.code === 'model_not_offered' || e?.data?.refusal === 'model_not_offered';

function putModel(section, task, id) {
  Promise.resolve()
    .then(() => railPrefsApi.setModel(section, task, id || null))
    .catch((e) => { if (notOffered(e)) safeWriteJSON(railModelKey(section, task), null); });
}

export function writeRailModel(workspace, task, id) {
  safeWriteJSON(railModelKey(workspace, task), id || null);
  putModel(sectionOf(workspace), task, id);
}

/** Every key this browser holds under `prefix`, or none where storage throws. */
function storedKeys(prefix) {
  const keys = [];
  try {
    if (typeof localStorage === 'undefined') return keys;
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (typeof k === 'string' && k.startsWith(prefix)) keys.push(k);
    }
  } catch { /* storage blocked: nothing to write up */ }
  return keys;
}

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

async function runSync() {
  let server;
  try {
    server = await railPrefsApi.read();
  } catch {
    return { ok: false };
  }
  if (server?.ok !== true || !isObject(server.models) || !isObject(server.modes)) return { ok: false };

  // The server's rows win: each is written into the cache it stands for.
  for (const [section, tasks] of Object.entries(server.models)) {
    if (!isObject(tasks)) continue;
    for (const [task, id] of Object.entries(tasks)) {
      if (typeof id === 'string' && id) safeWriteJSON(railModelKey(section, task), id);
    }
  }
  const modes = {};
  for (const [section, mode] of Object.entries(server.modes)) {
    if (mode === 'eadwyn' || mode === 'manual') modes[section] = mode === 'eadwyn';
  }
  seedAssistModes(modes);

  // A local value with no server row is written up once: after this load the
  // row exists, so the next load reads it back instead.
  for (const key of storedKeys(RAIL_MODEL_PREFIX)) {
    const rest = key.slice(RAIL_MODEL_PREFIX.length);
    const at = rest.lastIndexOf(':');
    if (at <= 0) continue;
    const section = rest.slice(0, at);
    const task = rest.slice(at + 1);
    const id = safeReadJSON(key, null);
    if (typeof id !== 'string' || !id || !task) continue;
    if (server.models[section]?.[task]) continue;
    putModel(section, task, id);
  }
  for (const key of storedKeys(ASSIST_MODE_PREFIX)) {
    const section = key.slice(ASSIST_MODE_PREFIX.length);
    const on = safeReadJSON(key, null);
    if (!section || typeof on !== 'boolean' || server.modes[section]) continue;
    Promise.resolve()
      .then(() => railPrefsApi.setMode(section, on ? 'eadwyn' : 'manual'))
      .catch(() => {});
  }
  return { ok: true };
}

let synced = null;

/** One read of the Worker per page load; every caller shares it. */
export function syncRailPrefs() {
  if (!synced) synced = runSync();
  return synced;
}

/** Test seam: let the next call read again. Never called by the app. */
export function __resetRailPrefsSyncForTest() {
  synced = null;
}
