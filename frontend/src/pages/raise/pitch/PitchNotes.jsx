import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { Lightbox } from '../../../ui';
import {
  NOTES_EMPTY, NOTES_EYEBROW, NOTE_MAX, NOTE_PLACEHOLDER_ADMIN, NOTE_PLACEHOLDER_FOUNDER,
  asList, cardLabel, currentVersion, noteRows, overrideRows, postNoteSentence, versionLabel,
} from './pitchStudioModel';

/**
 * D905 (#2684) — the studio's Notes tab (PD21): the thread on the venture's
 * deck, every version, with a card pill on each note and the composer.
 *
 * An Admin and the Super Admin leave notes; the founders read and answer. Who
 * may post is the Worker's answer (`viewer` on GET /api/decks/:id/notes), not a
 * guess from the role here. Posting opens a dialog that says what it changes.
 * The Super Admin also sets the default template by sector and stage.
 */

const BTN = 'inline-flex min-h-[36px] items-center justify-center gap-2 whitespace-nowrap rounded-[9px] px-3.5 text-[12.5px] font-bold';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const PRIMARY = `${BTN} bg-axal-violet text-white hover:bg-axal-violet-deep disabled:opacity-50`;
const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const EYE = 'font-mono text-[10px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const INK = 'text-axal-ink dark:text-gray-100';
const PILL_MU = 'inline-flex items-center self-start rounded-full border border-axal-hairline bg-axal-ground px-2 py-0.5 text-[10.5px] font-bold text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400';
const FIELD = 'w-full rounded-[7px] border border-axal-hairline bg-white px-3 py-2 text-[12.5px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const SKEL = 'animate-pulse rounded-[9px] bg-axal-hairline dark:bg-gray-800';

export default function PitchNotes({ reads }) {
  const versions = asList(reads.versions.data, 'versions', 'decks');
  const current = currentVersion(versions);
  const deckId = current?.id || null;
  const slideCount = reads.deck.status === 'ok' && Array.isArray(reads.deck.data?.slides) ? reads.deck.data.slides.length : 0;
  const [notes, setNotes] = useState({ status: 'idle', data: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!deckId) { setNotes({ status: 'idle', data: null }); return undefined; }
    let live = true;
    setNotes({ status: 'loading', data: null });
    api.deckNotes(deckId).then(
      (data) => { if (live) setNotes({ status: 'ok', data }); },
      (e) => { if (live) setNotes({ status: 'error', data: null }); reportError('pitch-studio:notes', e); },
    );
    return () => { live = false; };
  }, [deckId, tick]);

  if (reads.versions.status === 'loading' || reads.versions.status === 'idle' || reads.projects.status === 'loading') {
    return <div className={`${SKEL} h-40`} aria-hidden="true" data-testid="pitch-notes-loading" />;
  }
  if (reads.versions.status === 'error') return <Failed text="Your deck's versions could not be read." onRetry={reads.reload} />;
  if (!current) return <div className={`${CARD} p-6 text-center ${MUTED}`} data-testid="pitch-notes-no-deck">No deck yet, so there is nothing to note.</div>;

  const viewer = notes.data?.viewer || null;
  return (
    <div className="grid gap-3.5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" data-testid="pitch-notes">
      <section className={`${CARD} flex flex-col gap-3 p-4`} aria-label="Notes">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={EYE}>{NOTES_EYEBROW}</span>
          <span className="font-mono text-[11px] text-axal-muted dark:text-gray-400">Current: {versionLabel(current)}</span>
        </div>
        {notes.status === 'loading' || notes.status === 'idle' ? <div className={`${SKEL} h-24`} aria-hidden="true" /> : notes.status === 'error' ? (
          <Failed text="The notes could not be read." onRetry={() => setTick((t) => t + 1)} testId="pitch-notes-error" />
        ) : (
          <Thread rows={noteRows(notes.data)} />
        )}
        {viewer ? (
          <Composer deckId={deckId} slideCount={slideCount} viewer={viewer} onPosted={() => setTick((t) => t + 1)} />
        ) : null}
      </section>
      {viewer === 'super_admin' ? <aside aria-label="Super Admin"><DefaultTemplates /></aside> : null}
    </div>
  );
}

function Failed({ text, onRetry, testId }) {
  return (
    <div className="flex flex-col items-start gap-2" data-testid={testId}>
      <span className={`text-[13px] font-bold ${INK}`}>{text}</span>
      {onRetry ? <button type="button" className={GHOST} onClick={onRetry}><RefreshCw size={14} aria-hidden="true" /> Try again</button> : null}
    </div>
  );
}

function Thread({ rows }) {
  if (!rows.length) return <p className={`m-0 ${MUTED}`} data-testid="pitch-notes-empty">{NOTES_EMPTY}</p>;
  return (
    <ol className="m-0 flex list-none flex-col gap-2.5 p-0" data-testid="pitch-notes-thread">
      {rows.map((n) => (
        <li key={n.id} className="flex flex-col gap-1 rounded-[10px] border border-axal-hairline px-3 py-2.5 dark:border-gray-700" data-testid={`pitch-note-${n.id}`}>
          <div className="flex flex-wrap justify-between gap-2 text-[11.5px]">
            <span className={`font-bold ${INK}`}>{n.who}</span>
            <span className="font-mono text-axal-muted dark:text-gray-400">{n.when} · {n.version}</span>
          </div>
          <span className={`whitespace-pre-wrap text-[12.5px] leading-[1.45] ${INK}`}>{n.text}</span>
          <span className={PILL_MU}>{n.card}</span>
        </li>
      ))}
    </ol>
  );
}

function Composer({ deckId, slideCount, viewer, onPosted }) {
  const [body, setBody] = useState('');
  const [card, setCard] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(null);
  const text = body.trim();
  const cardIndex = card === '' ? null : Number(card);

  const post = useCallback(async () => {
    setBusy(true); setFailed(null);
    try {
      await api.deckPostNote(deckId, cardIndex === null ? { body: text } : { body: text, card_index: cardIndex });
      setConfirm(false); setBody(''); setCard('');
      onPosted();
    } catch (e) {
      reportError('pitch-studio:post-note', e);
      setFailed(e?.message || 'The note could not be posted. Try again.');
    } finally {
      setBusy(false);
    }
  }, [deckId, cardIndex, text, onPosted]);

  return (
    <div className="flex flex-col gap-2" data-testid="pitch-notes-composer">
      <label className="sr-only" htmlFor="pitch-note-body">Note</label>
      <textarea
        id="pitch-note-body"
        className={`${FIELD} min-h-[72px]`}
        placeholder={viewer === 'founder' ? NOTE_PLACEHOLDER_FOUNDER : NOTE_PLACEHOLDER_ADMIN}
        maxLength={NOTE_MAX}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        data-testid="pitch-note-body"
      />
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="pitch-note-card">About</label>
        <select id="pitch-note-card" className={`${FIELD} w-auto`} value={card} onChange={(e) => setCard(e.target.value)} data-testid="pitch-note-card">
          <option value="">Whole deck</option>
          {Array.from({ length: slideCount }, (_, i) => <option key={i} value={i}>{cardLabel(i)}</option>)}
        </select>
        <button type="button" className={`${PRIMARY} ml-auto`} disabled={!text} onClick={() => { setFailed(null); setConfirm(true); }} data-testid="pitch-note-post">
          Post note
        </button>
      </div>
      {confirm ? (
        <Lightbox
          label="Post this note"
          title="Post this note?"
          width={480}
          onClose={() => !busy && setConfirm(false)}
          testId="pitch-note-dialog"
          footer={(
            <div className="flex justify-end gap-2">
              <button type="button" className={GHOST} onClick={() => setConfirm(false)} disabled={busy}>Cancel</button>
              <button type="button" className={PRIMARY} onClick={post} disabled={busy} data-testid="pitch-note-confirm">{busy ? 'Posting…' : 'Post note'}</button>
            </div>
          )}
        >
          <p className={`m-0 text-[13px] leading-[1.55] ${INK}`}>{postNoteSentence(viewer, cardIndex)}</p>
          {failed ? <p role="alert" className="m-0 mt-2 text-[12.5px] font-semibold text-axal-destructive dark:text-red-400">{failed}</p> : null}
        </Lightbox>
      ) : null}
    </div>
  );
}

/** The Super Admin's default template by sector and stage (`/api/decks/admin/recommend-overrides`). */
function DefaultTemplates() {
  const [state, setState] = useState({ status: 'loading', overrides: null, methods: null });
  const [change, setChange] = useState(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    Promise.all([
      api.deckRecommendOverrides(),
      // The template names are a nicety: without them each row names its template by id.
      api.deckMethods().catch(() => null),
    ]).then(
      ([overrides, methods]) => { if (live) setState({ status: 'ok', overrides, methods }); },
      (e) => { if (live) setState({ status: 'error', overrides: null, methods: null }); reportError('pitch-studio:overrides', e); },
    );
    return () => { live = false; };
  }, [tick]);

  const rows = useMemo(() => (state.status === 'ok' ? overrideRows(state.overrides, state.methods) : []), [state]);
  const methods = asList(state.methods, 'methods', 'items');

  const save = useCallback(async () => {
    setBusy(true); setFailed(false);
    try {
      await api.deckSetRecommendOverride({ sector: change.sector, stage: change.stage, method_id: change.methodId });
      setChange(null);
      setTick((t) => t + 1);
    } catch (e) {
      reportError('pitch-studio:set-override', e);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, [change]);

  return (
    <section className={`${CARD} flex flex-col gap-2 bg-axal-ground p-4 dark:bg-gray-800`} data-testid="pitch-default-templates">
      <span className={EYE}>Super Admin</span>
      <span className={`text-[12.5px] font-bold ${INK}`}>Default template by sector and stage</span>
      {state.status === 'loading' ? <div className={`${SKEL} h-12`} aria-hidden="true" /> : state.status === 'error' ? (
        <Failed text="The defaults could not be read." onRetry={() => setTick((t) => t + 1)} />
      ) : !rows.length ? (
        <p className={`m-0 ${MUTED}`}>No default set. Each new deck starts from the recommended template.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {rows.map((r) => (
            <li key={r.key} className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
              <span className={INK}>{r.sector} · {r.stage}</span>
              {methods.length ? (
                <select
                  aria-label={`Template for ${r.sector} · ${r.stage}`}
                  className={`${FIELD} w-auto py-1`}
                  value={r.methodId}
                  onChange={(e) => { setFailed(false); setChange({ ...r, methodId: e.target.value, template: methods.find((m) => m.id === e.target.value)?.label || e.target.value }); }}
                >
                  {methods.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              ) : <span className="font-mono text-axal-muted dark:text-gray-400">{r.template}</span>}
            </li>
          ))}
        </ul>
      )}
      {change ? (
        <Lightbox
          label="Change the default template"
          title="Change the default template?"
          width={480}
          onClose={() => !busy && setChange(null)}
          footer={(
            <div className="flex justify-end gap-2">
              <button type="button" className={GHOST} onClick={() => setChange(null)} disabled={busy}>Cancel</button>
              <button type="button" className={PRIMARY} onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Change'}</button>
            </div>
          )}
        >
          <p className={`m-0 text-[13px] leading-[1.55] ${INK}`}>New decks for {change.sector} · {change.stage} start from {change.template}, on every studio. Decks already made keep theirs.</p>
          {failed ? <p role="alert" className="m-0 mt-2 text-[12.5px] font-semibold text-axal-destructive dark:text-red-400">The default could not be changed. Try again.</p> : null}
        </Lightbox>
      ) : null}
    </section>
  );
}
