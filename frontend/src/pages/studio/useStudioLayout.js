/**
 * D1419 (#3698) — one Studio's catalogue, its layout, and edit mode, over the
 * Worker's `/api/studio` (`studioLayoutApi`: D1421, D1418, D1594).
 *
 * - The two reads settle on their own. A failed layout read draws the
 *   profile's default with SM8a's note (`studioFallback.js`); a 403
 *   `no_studio_profile` draws SM12a; a 500 `layout_unreadable` draws the
 *   default with "Your saved layout could not be read" and Reset.
 * - Customise is local: moves, sizes, adds and removals change a draft.
 *   Done is the one save, `saveLayout(draft, revision, profile)`, showing
 *   Saving… then Saved. A failed save stays in edit mode with the draft kept
 *   (409 → SM8c with Reload layout; 402 → the locked notice; else Try again).
 * - Reset asks first (SM5r), then `resetLayout` at once and leaves edit mode.
 * - An administrator previews: `profile` is always sent and Customise is
 *   never offered (SM11), so an admin never writes a row.
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

// Only the kind is kept: the page branches on the refusal's code, never on its sentence (D258).
const failed = (_e, kind) => ({ failed: true, kind });
const noop = () => {};
const NO_EDIT = Object.freeze({ add: noop, remove: noop, resize: noop, moveUp: noop, moveDown: noop, move: noop });

/** Everything the page draws from the two reads and the edit state. Pure. */
export function deriveStudio({ profile, viewer, readOnly = false, modules, layout, editing = false, draft = [], dismissed = false }) {
  const admin = viewer?.role === 'admin';
  const noProfile = !!(layout?.failed && layout.kind === 'no_profile');
  const layoutRead = layout === undefined ? 'loading' : layout.failed ? 'failed' : 'ready';
  const catalogue = modules && !modules.failed && Array.isArray(modules.modules) ? modules.modules : null;
  let placed = [];
  if (layoutRead === 'failed' && !noProfile) placed = fallbackLayout(profile);
  else if (layoutRead === 'ready') placed = toSave(layout.layout);
  const canCustomise = !readOnly && !admin && layoutRead === 'ready' && !!catalogue;
  return {
    profile,
    admin,
    readOnly: readOnly || admin,
    modules,
    catalogue,
    groups: catalogue && Array.isArray(modules.groups) ? modules.groups : [],
    layout,
    layoutRead,
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
    dismissDropped: noop, reload: noop, customise: noop, done: noop, reset: noop,
    askReset: false, setAskReset: noop, mapOpen: !!args.mapOpen, setMapOpen: noop, lockedKey: args.lockedKey || null, setLockedKey: noop,
    edit: NO_EDIT,
  };
}

export function useStudioLayout({ profile, viewer, readOnly = false, api = studioLayoutApi }) {
  const sent = viewer?.role === 'admin' ? profile : undefined;
  const [modules, setModules] = useState(undefined);
  const [layout, setLayout] = useState(undefined);
  const [n, setN] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState([]);
  const [saving, setSaving] = useState('idle');
  const [saveError, setSaveError] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [askReset, setAskReset] = useState(false);
  const [lockedKey, setLockedKey] = useState(null);
  const savedTimer = useRef(null);

  useEffect(() => {
    let live = true;
    setModules(undefined);
    setLayout(undefined);
    Promise.allSettled([api.modules(sent), api.layout(sent)]).then(([m, l]) => {
      if (!live) return;
      if (m.status === 'fulfilled') setModules(m.value);
      else { reportError('Studio:modules', m.reason); setModules(failed(m.reason, readFailureOf(m.reason))); }
      if (l.status === 'fulfilled') setLayout(l.value);
      else { reportError('Studio:layout', l.reason); setLayout(failed(l.reason, readFailureOf(l.reason))); }
    });
    return () => { live = false; };
  }, [api, sent, n]);

  useEffect(() => () => clearTimeout(savedTimer.current), []);

  const view = deriveStudio({ profile, viewer, readOnly, modules, layout, editing, draft, dismissed });
  const { placed, canCustomise, dirty } = view;

  // Leaving with unsaved edits asks first.
  useEffect(() => {
    if (!dirty || typeof window === 'undefined') return undefined;
    const ask = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', ask);
    return () => window.removeEventListener('beforeunload', ask);
  }, [dirty]);

  const reload = useCallback(() => { setEditing(false); setSaveError(null); setDismissed(false); setN((x) => x + 1); }, []);

  const customise = useCallback(() => {
    if (!canCustomise) return;
    setDraft(placed);
    setSaveError(null);
    setEditing(true);
  }, [canCustomise, placed]);

  const done = useCallback(async () => {
    if (!editing || saving === 'saving') return;
    if (sameLayout(draft, placed)) { setEditing(false); setMapOpen(false); return; }
    setSaving('saving');
    setSaveError(null);
    try {
      const next = await api.saveLayout(toSave(draft), layout?.revision ?? null, sent);
      setLayout(next);
      setEditing(false);
      setMapOpen(false);
      setSaving('saved');
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaving('idle'), 2400);
    } catch (e) {
      reportError('Studio:saveLayout', e);
      setSaving('idle');
      setSaveError(saveFailureOf(e));
    }
  }, [api, draft, editing, layout, placed, saving, sent]);

  const reset = useCallback(async () => {
    setAskReset(false);
    setSaving('saving');
    try {
      const next = await api.resetLayout(sent);
      setLayout(next);
      setEditing(false);
      setMapOpen(false);
      setSaveError(null);
      setSaving('idle');
    } catch (e) {
      reportError('Studio:resetLayout', e);
      setSaving('idle');
      setSaveError({ kind: 'reset_failed' });
    }
  }, [api, sent]);

  return {
    ...view,
    saving,
    saveError,
    dismissDropped: () => setDismissed(true),
    reload,
    customise,
    done,
    reset,
    askReset,
    setAskReset,
    mapOpen,
    setMapOpen,
    lockedKey,
    setLockedKey,
    edit: {
      add: (mod) => setDraft((d) => addTo(d, mod)),
      remove: (key) => setDraft((d) => removeFrom(d, key)),
      resize: (key, size) => setDraft((d) => resizeIn(d, key, size)),
      moveUp: (key) => setDraft((d) => moveUp(d, key)),
      moveDown: (key) => setDraft((d) => moveDown(d, key)),
      move: (from, to) => setDraft((d) => moveAt(d, from, to)),
    },
  };
}
