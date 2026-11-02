import { useCallback, useEffect, useState } from 'react';
import { adminDeckModelsApi } from '../../lib/api/adminDeckModels';
import { Card, Unreadable } from '../../ui';

/**
 * D1549 (#3796, deck v2 C1) — "Deck models · org default" (aird6b): HQ's
 * default model for each deck element group, and its lock. Drawn on HQ ›
 * AI usage, the HQ AI page whose gate it shares: #3786 (B10), whose admin
 * page the issue names, has not merged, so there is no B10 page to put it on.
 *
 * One row per element group that runs a model (the Worker's answer, so the
 * free groups are not listed): Element group | Model ▾ | Lock. The model
 * list is the group's own from the catalogue, through the Worker; "Catalogue
 * default" clears HQ's row. A lock wins over every other level on every
 * deck, and the AIRail says "🔒 Set by Axal VC HQ" on the group. Nothing is
 * written until Save, and each save is audited by the Worker.
 */

const HEAD = 'grid grid-cols-[minmax(0,1fr)_220px_90px_auto] gap-3 font-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-axal-muted dark:text-gray-400';
const ROW = 'grid grid-cols-[minmax(0,1fr)_220px_90px_auto] items-center gap-3 border-t border-axal-hairline py-2 text-[12.5px] dark:border-gray-800';
const FIELD = 'w-full rounded-axal-sm border border-axal-hairline bg-white px-2 py-1.5 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const SAVE = 'inline-flex items-center justify-center whitespace-nowrap rounded-axal-sm bg-axal-ink px-2.5 py-1 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900';

/** The row as stored: the org model (or '' for the catalogue default) and the lock. */
export const storedOf = (g) => ({ model: g?.org?.model ?? '', locked: Boolean(g?.org?.locked) });

/** The PUT body for a draft, or null when it cannot be saved (a lock needs a model). */
export function saveBody(group, draft) {
  if (draft.locked && !draft.model) return null;
  return { group, model: draft.model || null, locked: Boolean(draft.model) && Boolean(draft.locked) };
}

function GroupRow({ g, onSaved }) {
  const stored = storedOf(g);
  const [draft, setDraft] = useState(stored);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { setDraft(storedOf(g)); }, [g]);
  const dirty = draft.model !== stored.model || draft.locked !== stored.locked;
  const body = saveBody(g.group, draft);
  const save = () => {
    if (!body || busy) return;
    setBusy(true); setError(null);
    adminDeckModelsApi.set(body).then(() => { setBusy(false); onSaved(); }, (e) => {
      setBusy(false); setError(typeof e?.message === 'string' && e.message ? e.message : 'Not saved.');
    });
  };
  const fallback = g.catalogue_default?.name ? `Catalogue default (${g.catalogue_default.name})` : 'Catalogue default';
  return (
    <div className={ROW} data-testid={`hq-deck-models-row-${g.group}`}>
      <span className="font-semibold">{g.label}</span>
      <select className={FIELD} aria-label={`Model for ${g.label}`} value={draft.model} disabled={busy}
        onChange={(e) => setDraft((d) => ({ model: e.target.value, locked: e.target.value ? d.locked : false }))} data-testid={`select-hq-deck-models-${g.group}`}>
        <option value="">{fallback}</option>
        {(g.choices || []).map((m) => <option key={m.id} value={m.id}>{`${m.name || m.id}${m.lock ? ` · ${m.lock}` : ''}`}</option>)}
      </select>
      <button type="button" role="switch" aria-checked={draft.locked} aria-label={`Lock ${g.label}`} disabled={busy || !draft.model}
        className={`h-5 w-9 rounded-full ${draft.locked ? 'bg-axal-violet' : 'bg-axal-hairline dark:bg-gray-700'} disabled:opacity-40`}
        onClick={() => setDraft((d) => ({ ...d, locked: !d.locked }))} data-testid={`switch-hq-deck-models-lock-${g.group}`}>
        <span className={`block h-4 w-4 rounded-full bg-white transition ${draft.locked ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </button>
      <span className="flex items-center gap-2">
        <button type="button" className={SAVE} disabled={!dirty || !body || busy} onClick={save} data-testid={`button-hq-deck-models-save-${g.group}`}>{busy ? 'Saving…' : 'Save'}</button>
        {error ? <span role="alert" className="text-[11.5px] text-red-700 dark:text-red-300" data-testid={`text-hq-deck-models-error-${g.group}`}>{error}</span> : null}
      </span>
    </div>
  );
}

export default function DeckModelsCard() {
  const [state, setState] = useState({ status: 'loading', data: null });
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, status: 'loading' }));
    adminDeckModelsApi.read().then((data) => { if (alive) setState({ status: 'ready', data }); }, () => { if (alive) setState({ status: 'unreadable', data: null }); });
    return () => { alive = false; };
  }, [attempt]);
  const groups = Array.isArray(state.data?.groups) ? state.data.groups : null;
  return (
    <section className="flex flex-col gap-2" data-testid="hq-deck-models">
      <span className="flex items-center gap-2">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[.09em] text-axal-muted">HQ · Platform</span>
        <span className="rounded-full bg-axal-ink px-2 py-0.5 font-mono text-[11px] font-bold text-white dark:bg-gray-100 dark:text-gray-900">HQ</span>
      </span>
      <h2 className="text-[18px] font-semibold text-axal-ink dark:text-gray-100">Deck models · org default</h2>
      <p className="text-[12.5px] text-axal-muted dark:text-gray-400">HQ’s model for each deck element group. A locked group runs its model on every deck, over every other pick, and the AIRail says “Set by Axal VC HQ”.</p>
      <Card className="overflow-x-auto px-4 py-3">
        {state.status === 'loading' && !groups ? <p className="text-[12.5px] text-axal-muted">Reading the deck models…</p> : null}
        {state.status === 'unreadable' ? <Unreadable what="HQ’s deck models" claim="No group is shown as unlocked instead." onRetry={reload} /> : null}
        {groups ? (
          <div className="min-w-[560px]">
            <div className={HEAD}><span>Element group</span><span>Model</span><span>Lock</span><span /></div>
            {groups.map((g) => <GroupRow key={g.group} g={g} onSaved={reload} />)}
          </div>
        ) : null}
      </Card>
    </section>
  );
}
