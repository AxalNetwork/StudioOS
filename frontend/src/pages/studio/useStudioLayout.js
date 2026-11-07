/**
 * D1419 (#3698) — one Studio's catalogue, its layout, and edit mode, over the
 * Worker's `/api/studio` (`studioLayoutApi`: D1421, D1418, D1594).
 *
 * - D4622: the two reads start together and each commits on its own. The
 *   saved layout draws its tiles (a module the catalogue has not named yet
 *   shows its fallback title) while the catalogue is still loading, and the
 *   catalogue failing leaves the layout as read. Each has its own retry:
 *   `reload` re-reads the layout only, `reloadModules` the catalogue only.
 * - The two reads settle on their own. A failed layout read draws the
 *   profile's default with SM8a's note (`studioFallback.js`); a 403
 *   `no_studio_profile` draws SM12a; a 500 `layout_unreadable` draws the
 *   default with "Your saved layout could not be read" and Reset.
 * - Customise is local: moves, sizes, adds and removals change a draft.
 *   Done is the one save, `saveLayout(draft, revision, profile)`, showing
 *   Saving… then Saved. A failed save stays in edit mode with the draft kept
 *   (409 → SM8c with Reload layout; 402 → the locked notice; else Try again).
 * - Reset asks first (SM5r), then `resetLayout` at once and leaves edit mode.
 * - D4621: one operation at a time. While a save or reset is in flight the
 *   draft, Customise, Done and Reset do nothing, so the Saved line always
 *   describes what was sent. Each operation carries the generation it began
 *   in; a reload, a profile change or an unmount starts a new one, and a
 *   response from an older one is dropped, never written over the newer read.
 *   Leaving with unsaved edits (a link, Back, closing the tab) asks first.
 * - An administrator names the profile: `profile` is always sent, on every
 *   read, save and reset. D4362 (#4362) supersedes SM11: an admin customises
 *   the Founder, Investor, Advisor or Partner Studio they switch to, and the
 *   layout is the admin's own, keyed by (admin, profile), never a member's.
 *   Arranging modules unlocks nothing: a tile the admin's preview withholds
 *   stays withheld (the home's `withheld`, not `readOnly`).
 *
 * `deriveStudio` is the pure half, so a home renders in a Node test from
 * fixture reads (`studioFromReads`) without this hook.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { studioLayoutApi } from '../../lib/api/studioLayout.js';
import { reportError } from '../../lib/log';
import {
  add as addTo, moveDown, moveUp, move as moveAt, readFailureOf, remove as removeFrom, resize as resizeIn,
  sameLayout, saveFailureOf, toSave,
} from './studioLayoutModel';
import { fallbackLayout } from './studioFallback';
import { useLeaveGuard } from './useLeaveGuard';

// Only the kind is kept: the page branches on the refusal's code, never on its sentence (D258).
const failed = (_e, kind) => ({ failed: true, kind });
const noop = () => {};
const NO_EDIT = Object.freeze({ add: noop, remove: noop, resize: noop, moveUp: noop, moveDown: noop, move: noop });

/** Everything the page draws from the two reads and the edit state. Pure. */
export function deriveStudio({ profile, viewer, readOnly = false, modules, layout, editing = false, draft = [], dismissed = false }) {
  const admin = viewer?.role === 'admin';
  const noProfile = !!(layout?.failed && layout.kind === 'no_profile');
  const layoutRead = layout === undefined ? 'loading' : layout.failed ? 'failed' : 'ready';
  const modulesRead = modules === undefined ? 'loading' : modules.failed ? 'failed' : 'ready';
  const catalogue = modules && !modules.failed && Array.isArray(modules.modules) ? modules.modules : null;
  let placed = [];
  if (layoutRead === 'failed' && !noProfile) placed = fallbackLayout(profile);
  else if (layoutRead === 'ready') placed = toSave(layout.layout);
  const canCustomise = !readOnly && layoutRead === 'ready' && !!catalogue;
  return {
    profile,
    admin,
    readOnly,
    modules,
    catalogue,
    groups: catalogue && Array.isArray(modules.groups) ? modules.groups : [],
    layout,
    layoutRead,
    modulesRead,
    noProfile,
    placed,
    shown: editing ? draft : placed,
    editing: editing && canCustomise,
    dirty: editing && !sameLayout(draft, placed),
    canCustomise,
    dropped: !dismissed && layoutRead === 'ready' && Array.isArray(layout.dropped) ? layout.dropped : [],
  };
}

/** A Studio drawn from fixed reads, with no request and no edit: a Node test's, and nothing else's. */
export function studioFromReads(args) {
  return {
    ...deriveStudio(args),
    saving: args.saving || 'idle',
    saveError: args.saveError || null,
    dismissDropped: noop, reload: noop, reloadModules: noop, customise: noop, done: noop, reset: noop,
    askReset: false, setAskReset: noop, mapOpen: !!args.mapOpen, setMapOpen: noop, lockedKey: args.lockedKey || null, setLockedKey: noop,
    leave: null,
    edit: NO_EDIT,
  };
}

export function useStudioLayout({ profile, viewer, readOnly = false, api = studioLayoutApi }) {
  const sent = viewer?.role === 'admin' ? profile : undefined;
  const [modules, setModules] = useState(undefined);
  const [layout, setLayout] = useState(undefined);
  const [n, setN] = useState(0);
  const [nm, setNm] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState([]);
  const [saving, setSaving] = useState('idle');
  const [saveError, setSaveError] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [askReset, setAskReset] = useState(false);
  const [lockedKey, setLockedKey] = useState(null);
  const savedTimer = useRef(null);
  const gen = useRef(0);
  const busy = useRef(false);

  // The saved layout. A new read (first, retry, profile change) ends whatever the page was doing with the old one.
  useEffect(() => {
    let live = true;
    gen.current += 1;
    busy.current = false;
    setEditing(false);
    setSaving('idle');
    setSaveError(null);
    setAskReset(false);
    setLayout(undefined);
    Promise.resolve().then(() => api.layout(sent)).then(
      (value) => { if (live) setLayout(value); },
      (reason) => { if (!live) return; reportError('Studio:layout', reason); setLayout(failed(reason, readFailureOf(reason))); },
    );
    return () => { live = false; gen.current += 1; busy.current = false; };
  }, [api, sent, n]);

  // The catalogue. Its retry leaves the layout, and any save in flight, alone.
  useEffect(() => {
    let live = true;
    setModules(undefined);
    Promise.resolve().then(() => api.modules(sent)).then(
      (value) => { if (live) setModules(value); },
      (reason) => { if (!live) return; reportError('Studio:modules', reason); setModules(failed(reason, readFailureOf(reason))); },
    );
    return () => { live = false; };
  }, [api, sent, nm]);

  useEffect(() => () => clearTimeout(savedTimer.current), []);

  const view = deriveStudio({ profile, viewer, readOnly, modules, layout, editing, draft, dismissed });
  const { placed, canCustomise, dirty } = view;

  // Leaving with unsaved edits asks first.
  const leave = useLeaveGuard(dirty);

  const reload = useCallback(() => { setEditing(false); setSaveError(null); setDismissed(false); setN((x) => x + 1); }, []);
  const reloadModules = useCallback(() => setNm((x) => x + 1), []);

  const customise = useCallback(() => {
    if (!canCustomise || busy.current) return;
    setDraft(placed);
    setSaveError(null);
    setEditing(true);
  }, [canCustomise, placed]);

  const done = useCallback(async () => {
    if (!editing || busy.current) return false;
    if (sameLayout(draft, placed)) { setEditing(false); setMapOpen(false); return true; }
    const g = gen.current;
    busy.current = true;
    setSaving('saving');
    setSaveError(null);
    try {
      const next = await api.saveLayout(toSave(draft), layout?.revision ?? null, sent);
      if (g !== gen.current) return false;
      busy.current = false;
      setLayout(next);
      setEditing(false);
      setMapOpen(false);
      setSaving('saved');
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaving('idle'), 2400);
      return true;
    } catch (e) {
      reportError('Studio:saveLayout', e);
      if (g !== gen.current) return false;
      busy.current = false;
      setSaving('idle');
      setSaveError(saveFailureOf(e));
      return false;
    }
  }, [api, draft, editing, layout, placed, sent]);

  const reset = useCallback(async () => {
    setAskReset(false);
    if (busy.current) return;
    const g = gen.current;
    busy.current = true;
    setSaving('saving');
    try {
      const next = await api.resetLayout(sent);
      if (g !== gen.current) return;
      busy.current = false;
      setLayout(next);
      setEditing(false);
      setMapOpen(false);
      setSaveError(null);
      setSaving('idle');
    } catch (e) {
      reportError('Studio:resetLayout', e);
      if (g !== gen.current) return;
      busy.current = false;
      setSaving('idle');
      setSaveError({ kind: 'reset_failed' });
    }
  }, [api, sent]);

  // Save, then go where the person was headed; a failed save stays here with its notice.
  const saveAndLeave = useCallback(async () => {
    const held = leave.current();
    if (await done()) leave.proceed(held);
    else leave.stay();
  }, [done, leave]);

  // The draft is frozen while a save or reset is in flight.
  const change = (fn) => { if (!busy.current) setDraft(fn); };

  return {
    ...view,
    saving,
    saveError,
    dismissDropped: () => setDismissed(true),
    reload,
    reloadModules,
    customise,
    done,
    reset,
    askReset,
    setAskReset,
    mapOpen,
    setMapOpen,
    lockedKey,
    setLockedKey,
    leave: { ...leave, saveAndLeave },
    edit: {
      add: (mod) => change((d) => addTo(d, mod)),
      remove: (key) => change((d) => removeFrom(d, key)),
      resize: (key, size) => change((d) => resizeIn(d, key, size)),
      moveUp: (key) => change((d) => moveUp(d, key)),
      moveDown: (key) => change((d) => moveDown(d, key)),
      move: (from, to) => change((d) => moveAt(d, from, to)),
    },
  };
}
