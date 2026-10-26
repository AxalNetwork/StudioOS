import React, { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { Lightbox } from '../../../ui';
import { changedPill, compareCards, restoreDialog, vLabel } from './compareModel';
import { dayLabel } from './pitchStudioModel';

/**
 * D898 group D (#2676), PD15 — two versions side by side on the studio's
 * Decks tab: the chosen older version on the left, the current one on the
 * right, each card numbered with its title, the changed ones outlined, and
 * how many changed. "Restore vN" opens a dialog that says what it saves and
 * what stays, then calls the existing restore (`POST /api/decks/:id/restore`),
 * which saves a new version; nothing is deleted. An admin reads; there is no
 * Restore for them.
 *
 * Each version is read on its own; a failed read says so with Try again and
 * blanks nothing else.
 */

const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 text-[12.5px] font-bold disabled:opacity-50';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep`;
const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const INK = 'text-axal-ink dark:text-gray-100';
const AMBER = 'inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10.5px] font-bold text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200';

function useDeck(id) {
  const [state, setState] = useState({ status: 'loading', data: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState({ status: 'loading', data: null });
    api.deckGet(id).then((r) => { if (alive) setState({ status: 'ok', data: r?.deck || r }); },
      (e) => { if (alive) { setState({ status: 'error', data: null }); reportError('pitch-compare:read', e); } });
    return () => { alive = false; };
  }, [id, tick]);
  return { ...state, retry: () => setTick((t) => t + 1) };
}

function Column({ title, date, cards, testId }) {
  return (
    <div className={`${CARD} flex flex-col gap-2.5 p-3.5`} data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <span className={`text-[14px] font-extrabold ${INK}`}>{title}</span>
        <span className="font-mono text-[11.5px] text-axal-muted dark:text-gray-400">{date}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {cards.map((c) => (
          <div key={c.n} className={`flex aspect-video flex-col gap-0.5 rounded-[8px] border p-1.5 ${c.changed ? 'border-2 border-amber-500 dark:border-amber-400' : 'border-axal-hairline dark:border-gray-700'}`}
            data-testid={`${testId}-card-${c.n}`} data-changed={c.changed ? 'yes' : 'no'}>
            <span className="font-mono text-[9px] font-semibold text-teal-600 dark:text-teal-400">{c.n}</span>
            <span className={`text-[10px] font-bold leading-tight ${INK}`}>{c.title}</span>
            {c.changed ? <span className="sr-only">Changed</span> : null}
          </div>
        ))}
        {!cards.length ? <span className={MUTED}>No cards.</span> : null}
      </div>
    </div>
  );
}

export default function VersionCompare({ older, newer, versions, readOnly, onClose, onRestored }) {
  const left = useDeck(older.id);
  const right = useDeck(newer.id);
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const both = left.status === 'ok' && right.status === 'ok';
  const cmp = both ? compareCards(left.data, right.data) : null;
  const d = restoreDialog(older, newer, versions);
  const restore = async () => {
    setBusy(true); setRefusal(null);
    try { const r = await api.deckRestore(older.id); setDialog(false); onRestored?.(r?.deck || r); }
    catch (e) { setRefusal(e?.message || 'The version could not be restored. Nothing changed.'); }
    finally { setBusy(false); }
  };
  return (
    <section className="flex flex-col gap-3" data-testid="pitch-compare" aria-label={`Compare ${vLabel(older)} with ${vLabel(newer)}`}>
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <span className={MUTED}>Changed cards are outlined. {cmp ? <span className={AMBER} data-testid="pitch-compare-count">{changedPill(cmp.changed)}</span> : null}</span>
        <span className="flex gap-2">
          {!readOnly ? <button type="button" className={GHOST} disabled={!both} onClick={() => setDialog(true)} data-testid="pitch-compare-restore">Restore {vLabel(older)}</button> : null}
          <button type="button" className={GHOST} onClick={onClose} data-testid="pitch-compare-close">Close</button>
        </span>
      </div>
      <div className="grid gap-3.5 lg:grid-cols-2">
        {[[left, older, 'pitch-compare-left'], [right, newer, 'pitch-compare-right']].map(([r, v, id]) => (
          r.status === 'error' ? (
            <div key={id} role="alert" className={`${CARD} flex flex-wrap items-center gap-2 p-3.5 text-[13px] font-semibold text-red-700 dark:text-red-300`} data-testid={`${id}-error`}>
              {vLabel(v)} could not be read. That is not the same as no cards.
              <button type="button" className={GHOST} onClick={r.retry}>Try again</button>
            </div>
          ) : r.status !== 'ok' ? <div key={id} className={`${CARD} h-40 animate-pulse`} aria-busy="true" /> : (
            <Column key={id} testId={id} title={`${vLabel(v)}${v.is_current || v.current ? ' · current' : ''}`} date={dayLabel(v.created_at)}
              cards={id === 'pitch-compare-left' ? cmp.left : cmp.right} />
          )
        ))}
      </div>
      {dialog ? (
        <Lightbox label={d.title} title={d.title} width={480} onClose={() => !busy && setDialog(false)} testId="pitch-compare-restore-dialog"
          footer={(
            <div className="flex justify-end gap-2">
              <button type="button" className={GHOST} onClick={() => setDialog(false)} disabled={busy}>Cancel</button>
              <button type="button" className={PRIMARY} onClick={restore} disabled={busy} data-testid="pitch-compare-restore-run">{busy ? 'Restoring…' : d.confirm}</button>
            </div>
          )}>
          <div className="flex flex-col gap-2 text-[13px] leading-[1.55]" data-testid="pitch-compare-restore-lines">
            {d.lines.map((l) => <p key={l} className="m-0">{l}</p>)}
            {refusal ? <p role="alert" className="m-0 font-semibold text-red-700 dark:text-red-300" data-testid="pitch-compare-restore-refusal">{refusal}</p> : null}
          </div>
        </Lightbox>
      ) : null}
    </section>
  );
}
