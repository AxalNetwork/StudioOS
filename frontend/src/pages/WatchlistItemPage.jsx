import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { reportError } from '../lib/log';
import {
  DECISION_LABEL, EDITED_AFTER_OUTCOME, editedAfterOutcome, expectedLine, itemName, itemRows, itemSubline, outcomeOf,
} from '../lib/watchlistItem';
import { JournalForm, Modal, OutcomeForm } from './WatchlistJournalPage';

/**
 * D636 (#1394) — one watchlist item and the journal entries written about it:
 * the Ops canvas's sp-watchlist screen at /watchlist/:uid, reached from each
 * row of the Watchlist tab.
 *
 * Reads `GET /api/watchlist/:uid` and `GET /api/journal?watchlist_uid=` (the
 * caller's own entries). The item shows its thesis, conviction, source, tags,
 * status and next check, and how it ended. Each entry shows the decision,
 * conviction out of 5, thesis, risks and what was expected, then the outcome
 * with its notes and actual multiple, marked "Edited after the outcome" from
 * D618's record. Writes go through the journal's own routes, which keep the
 * entry's owner as its actor.
 *
 * The item and its entries are two reads with two states each: a failed read
 * says Unreadable with Try again, never an empty list.
 */

const CARD = 'rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
const PILL = {
  high: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  medium: 'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  low: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  watching: 'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  converted: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  passed_on: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  archived: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  invest: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  pass: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',
  defer: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  hit: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  miss: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',
  partial: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  inconclusive: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
};
const Pill = ({ tone, children, testid }) => (
  <span data-testid={testid} className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${PILL[tone] || PILL.low}`}>{children}</span>
);

function ReadFailed({ what, testid, onRetry }) {
  return (
    <div role="alert" data-testid={testid} className="flex flex-wrap items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12.5px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
      <span className="font-semibold">Unreadable</span>
      <span>{what} could not be read just now.</span>
      <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 font-semibold underline">
        <RefreshCw size={12} aria-hidden="true" /> Try again
      </button>
    </div>
  );
}

/** The item's fields, in the canvas's order; an absent one says Not recorded and why. */
export function ItemFields({ item }) {
  return (
    <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[8rem_1fr]" data-testid="watchlist-item-fields">
      {itemRows(item).map((r) => (
        <React.Fragment key={r.k}>
          <dt className="text-[12px] font-semibold text-gray-500 dark:text-gray-400">{r.k}</dt>
          <dd className="text-[13px] text-gray-900 dark:text-gray-100" data-testid={`watchlist-field-${r.k.toLowerCase().replace(/\s+/g, '-')}`}>
            {r.nr ? (
              <span className="text-gray-500 dark:text-gray-400"><b>Not recorded</b>. {r.nr}</span>
            ) : r.pill ? <Pill tone={r.pill}>{r.v}</Pill> : <span className="whitespace-pre-wrap">{r.v}</span>}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/** One journal entry: the decision and what was expected, then the outcome. */
export function JournalEntryCard({ entry, onRecordOutcome }) {
  const outcome = outcomeOf(entry);
  const expected = expectedLine(entry);
  return (
    <article className={CARD} data-testid="watchlist-journal-entry">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={entry.decision}>{DECISION_LABEL[entry.decision] || entry.decision}</Pill>
        <span className="text-[12px] text-gray-600 dark:text-gray-300" data-testid="journal-conviction">Conviction {entry.conviction} / 5</span>
        {editedAfterOutcome(entry) && (
          <Pill tone="partial" testid="journal-edited-after-outcome">{EDITED_AFTER_OUTCOME}</Pill>
        )}
      </div>
      <dl className="mt-2 grid gap-x-4 gap-y-1.5 text-[12.5px] sm:grid-cols-[8rem_1fr]">
        <dt className="font-semibold text-gray-500 dark:text-gray-400">Thesis</dt>
        <dd className="whitespace-pre-wrap text-gray-900 dark:text-gray-100">{entry.thesis}</dd>
        <dt className="font-semibold text-gray-500 dark:text-gray-400">Risks</dt>
        <dd className="text-gray-900 dark:text-gray-100">{entry.key_risks || <span className="text-gray-500 dark:text-gray-400"><b>Not recorded</b>. No risks were written.</span>}</dd>
        <dt className="font-semibold text-gray-500 dark:text-gray-400">Expected</dt>
        <dd className="text-gray-900 dark:text-gray-100" data-testid="journal-expected">{expected || <span className="text-gray-500 dark:text-gray-400"><b>Not recorded</b>. No outcome, multiple or timeline was expected.</span>}</dd>
      </dl>
      <div className="mt-3 border-t border-gray-100 pt-2 dark:border-gray-800" data-testid="journal-outcome">
        {outcome.recorded ? (
          <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
            <span className="font-semibold text-gray-500 dark:text-gray-400">Outcome</span>
            <Pill tone={outcome.status}>{outcome.label}</Pill>
            {outcome.actual && <span className="text-gray-900 dark:text-gray-100">Actual {outcome.actual}</span>}
            {outcome.notes && <span className="w-full whitespace-pre-wrap text-gray-700 dark:text-gray-300">{outcome.notes}</span>}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-gray-500 dark:text-gray-400">
            <span>Outcome: not recorded yet.</span>
            {onRecordOutcome && (
              <button type="button" onClick={() => onRecordOutcome(entry)} className="rounded-lg border border-gray-200 px-2 py-0.5 text-[12px] font-semibold text-gray-700 dark:border-gray-700 dark:text-gray-200">
                Record outcome
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

/** The whole screen for one item, given its two reads. */
export function WatchlistItemView({ item, entries, onRetryItem, onRetryEntries, onWrite, onRecordOutcome }) {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6" data-testid="watchlist-item-page">
      <Link to="/watchlist" className="inline-flex w-fit items-center gap-1 text-[12.5px] font-semibold text-violet-700 dark:text-violet-300">
        <ArrowLeft size={13} aria-hidden="true" /> Watchlist
      </Link>
      {!item || item.status === 'loading' ? (
        <p className="text-[12.5px] text-gray-500 dark:text-gray-400">Reading this item…</p>
      ) : item.status !== 'ready' ? (
        <ReadFailed what="This item" testid="watchlist-item-unreadable" onRetry={onRetryItem} />
      ) : (
        <>
          <header>
            <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 dark:text-white">{itemName(item.data)}</h1>
            <p className="mt-0.5 text-[12.5px] text-gray-500 dark:text-gray-400">{itemSubline(item.data)}</p>
          </header>
          <section className={CARD}><ItemFields item={item.data} /></section>
        </>
      )}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[14.5px] font-extrabold text-gray-900 dark:text-white">Journal</h2>
          {item?.status === 'ready' && entries?.status === 'ready' && entries.data.length > 0 && (
            <button type="button" onClick={onWrite} className="rounded-lg bg-violet-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-violet-700">Write an entry</button>
          )}
        </div>
        {!entries || entries.status === 'loading' ? (
          <p className="text-[12.5px] text-gray-500 dark:text-gray-400">Reading the journal…</p>
        ) : entries.status !== 'ready' ? (
          <ReadFailed what="The journal entries for this company" testid="watchlist-journal-unreadable" onRetry={onRetryEntries} />
        ) : entries.data.length === 0 ? (
          <div className={`${CARD} flex flex-wrap items-center justify-between gap-2`} data-testid="watchlist-journal-empty">
            <span className="text-[12.5px] text-gray-600 dark:text-gray-300">No journal entry for this company yet.</span>
            {item?.status === 'ready' && (
              <button type="button" onClick={onWrite} className="rounded-lg bg-violet-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-violet-700">Write an entry</button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {entries.data.map((e) => <JournalEntryCard key={e.uid} entry={e} onRecordOutcome={onRecordOutcome} />)}
          </div>
        )}
      </section>
    </main>
  );
}

const LOADING = { status: 'loading' };

export default function WatchlistItemPage() {
  const { uid } = useParams();
  const [item, setItem] = useState(LOADING);
  const [entries, setEntries] = useState(LOADING);
  const [writing, setWriting] = useState(false);
  const [outcomeFor, setOutcomeFor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const loadItem = useCallback(() => {
    setItem(LOADING);
    api.watchlistGet(uid).then(
      (data) => setItem({ status: 'ready', data }),
      (e) => { reportError('WatchlistItemPage:item', e); setItem({ status: 'unreadable' }); },
    );
  }, [uid]);
  const loadEntries = useCallback(() => {
    setEntries(LOADING);
    api.journalList({ watchlist_uid: uid }).then(
      (res) => setEntries({ status: 'ready', data: Array.isArray(res?.items) ? res.items : [] }),
      (e) => { reportError('WatchlistItemPage:journal', e); setEntries({ status: 'unreadable' }); },
    );
  }, [uid]);
  useEffect(() => { loadItem(); loadEntries(); }, [loadItem, loadEntries]);

  const submit = async (fn) => {
    setBusy(true); setError(null);
    try {
      await fn();
      setWriting(false); setOutcomeFor(null);
      loadEntries();
    } catch (e) {
      setError(e?.message || 'It could not be saved. Nothing changed; try again.');
    } finally { setBusy(false); }
  };

  return (
    <>
      <WatchlistItemView
        item={item} entries={entries} onRetryItem={loadItem} onRetryEntries={loadEntries}
        onWrite={() => { setError(null); setWriting(true); }} onRecordOutcome={(e) => { setError(null); setOutcomeFor(e); }}
      />
      <Modal open={writing} onClose={() => setWriting(false)} title={`New journal entry: ${item.status === 'ready' ? itemName(item.data) : ''}`}>
        {error && <p role="alert" className="mb-2 text-[12.5px] text-red-700 dark:text-red-300">{error}</p>}
        <JournalForm busy={busy} initial={{ watchlist_uid: uid }} onSubmit={(form) => submit(() => api.journalCreate(form))} />
      </Modal>
      <Modal open={!!outcomeFor} onClose={() => setOutcomeFor(null)} title="Record the outcome">
        {error && <p role="alert" className="mb-2 text-[12.5px] text-red-700 dark:text-red-300">{error}</p>}
        <OutcomeForm busy={busy} onSubmit={(form) => submit(() => api.journalRecordOutcome(outcomeFor.uid, form))} />
      </Modal>
    </>
  );
}
