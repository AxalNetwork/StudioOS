/**
 * The Deck roster (D980, #2766; AP7–AP9 of `design/incoming/Advisors Partners
 * Page.dc.html`): the people the Spin-Out Demo Day deck's Team & Network slide
 * draws, at /admin/advisors-partners/deck.
 *
 * From D974's roster read: the four tiles (Shown, On the slide, Hidden,
 * Archived), search and the Kind filter, the shown people in the deck's order
 * with Move up / Move down, drag, and Alt+Arrow on a focused row (each move
 * announced), each row's reach, its linked-account chip, the line after the
 * sixth, the collapsed Hidden and Archived sections, and the slide preview,
 * which follows the order as rows move. Every change opens an in-page dialog
 * that says what it changes (`advisors/DeckRosterDialogs.jsx`); the rules are
 * `advisors/deckRosterModel.js`.
 *
 * `embedded` is D972's: under the Advisors & Partners header the roster drops
 * its own title, so the page keeps one h1.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { adminNetworkProfiles as api } from '../../lib/api';
import { useToast } from '../../components/useToast';
import ToastMessage from '../../components/ToastMessage';
import { actionGhost, actionPrimary } from '../../ui';
import { CARD, EYE, H2, INPUT, Pill, RowMenu, SUB } from './partners/parts';
import { Avatar, CardDialog, ConfirmDialog } from './advisors/DeckRosterDialogs';
import {
  KINDS, ON_SLIDE, REACH, cardPayload, confirmCopy, dropRow, filterRows, kindLabel, moveLine, moveRow, previewOf,
  splitRoster, tilesOf,
} from './advisors/deckRosterModel';

/**
 * #1437 — one save, with its message. `notify` is the toast hook's
 * `{ success }`. Resolves to the saved row once the write and its message are
 * done; a failed write rejects and reports nothing as saved.
 */
export async function saveProfileForm({ client, editing, form, notify }) {
  const payload = cardPayload(form);
  if (editing?.id) {
    const reply = await client.update(editing.id, payload);
    notify.success('Profile updated');
    return reply?.profile || { ...editing, ...payload };
  }
  const reply = await client.create(payload);
  notify.success('Profile created');
  return reply?.profile || reply;
}

/** Which body the list draws. A failed read is "unreadable", never "No profiles yet". */
export function listState({ loading, loadError, profiles }) {
  if (loading) return 'loading';
  if (loadError) return 'unreadable';
  return profiles.length ? 'list' : 'empty';
}

const LIMIT = 500;
const UPB = 'min-h-[44px] lg:min-h-[28px] rounded-[7px] border border-axal-hairline bg-white px-2 text-[11.5px] font-bold text-axal-ink hover:bg-axal-ground disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';

function useList(params, tick, enabled = true) {
  const [read, setRead] = useState({ status: 'loading', data: null });
  const key = JSON.stringify(params);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    setRead((r) => ({ status: 'loading', data: r.data }));
    api.list(params).then(
      (data) => { if (live) setRead({ status: 'ready', data }); },
      (error) => { if (live) setRead((r) => ({ status: 'error', data: r.data, error })); },
    );
    return () => { live = false; };
    // `params` is rebuilt every render; `key` says when it changed.
  }, [key, tick, enabled]);
  return read;
}

function Tile({ t }) {
  return (
    <div className={`${CARD} flex min-w-0 flex-col gap-1 px-4 py-3`} data-testid={`deck-tile-${t.key}`}>
      <span className={EYE}>{t.label}</span>
      <span className={t.kind === 'value' ? 'font-mono text-[22px] font-medium text-axal-ink dark:text-gray-100' : 'text-[14px] font-bold text-axal-muted dark:text-gray-400'}>{t.text}</span>
      {t.sub ? <span className={SUB}>{t.sub}</span> : null}
    </div>
  );
}

function ReadFailed({ what, error, onRetry, testId }) {
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-[10px] border border-red-200 bg-red-50 p-3.5 text-[13px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" data-testid={testId}>
      <span>{what} could not be read just now{error?.message ? `: ${error.message}` : ''}. That is not the same as none.</span>
      <button type="button" onClick={onRetry} className={`${actionGhost} self-start`}>Try again</button>
    </div>
  );
}

/** One person's row. Shown rows move; hidden and archived rows do not. */
function Row({ p, index, total, canMove, onMove, onDrag, onDrop, onEdit, onAct, state }) {
  const shown = state === 'shown';
  const reach = REACH[p.deck_reach];
  const keyMove = (e) => {
    if (!canMove || !e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    onMove(p.id, e.key === 'ArrowUp' ? -1 : 1);
  };
  const menu = state === 'archived'
    ? [{ key: 'restore', label: 'Restore…', onSelect: () => onAct('restore', p) }]
    : [
      shown ? { key: 'hide', label: 'Hide from the deck…', onSelect: () => onAct('hide', p) } : { key: 'show', label: 'Show on the deck…', onSelect: () => onAct('show', p) },
      { key: 'archive', label: 'Archive…', onSelect: () => onAct('archive', p) },
    ];
  return (
    <li tabIndex={shown ? 0 : undefined} onKeyDown={shown ? keyMove : undefined}
      draggable={shown && canMove} onDragStart={shown ? () => onDrag(p.id) : undefined}
      onDragOver={shown ? (e) => e.preventDefault() : undefined} onDrop={shown ? () => onDrop(p.id) : undefined}
      aria-label={shown ? `${p.name}, position ${index + 1} of ${total}${reach ? `, ${reach.label}` : ''}` : p.name}
      className="flex flex-wrap items-center gap-3 border-t border-axal-hairline py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-axal-violet dark:border-gray-700"
      data-testid={`deck-row-${p.id}`}>
      {shown ? <span className="w-[46px] flex-none font-mono text-[12px] font-bold text-axal-muted dark:text-gray-400" aria-hidden="true">{canMove ? '⋮⋮ ' : ''}{String(index + 1).padStart(2, '0')}</span> : null}
      <Avatar name={p.name} src={p.photo_url} testId={`deck-photo-${p.id}`} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-[13px] font-bold text-axal-ink dark:text-gray-100">{p.name || 'Name not recorded'}</span>
        <span className={`${SUB} truncate`}>{[[p.role, p.company].filter(Boolean).join(', '), (p.skills || []).join(', ')].filter(Boolean).join(' · ') || 'No role or skills recorded'}</span>
        <span className="flex flex-wrap gap-1.5">
          <Pill tone="violet">{kindLabel(p.kind)}</Pill>
          {shown && reach ? <Pill tone={p.deck_reach === 'on_slide' ? 'violet' : 'muted'} title={reach.tip} testId={`deck-reach-${p.id}`}>{p.deck_reach === 'on_slide' ? '▣' : '•'} {reach.label}</Pill> : null}
          {p.linked_user ? <Pill tone="muted" testId={`deck-linked-${p.id}`}>⛓ Linked to {p.linked_user.name || 'a member'}’s account</Pill> : <Pill tone="muted" testId={`deck-linked-${p.id}`}>○ Not linked</Pill>}
          {state === 'archived' && p.archived_at ? <Pill tone="muted">Archived</Pill> : null}
        </span>
      </div>
      <span className="flex flex-wrap items-center gap-1.5">
        {shown ? (
          <>
            <button type="button" className={UPB} disabled={!canMove || index === 0} onClick={() => onMove(p.id, -1)} aria-label={`Move ${p.name} up`} data-testid={`deck-up-${p.id}`}>↑ Up</button>
            <button type="button" className={UPB} disabled={!canMove || index === total - 1} onClick={() => onMove(p.id, 1)} aria-label={`Move ${p.name} down`} data-testid={`deck-down-${p.id}`}>↓ Down</button>
          </>
        ) : null}
        {state !== 'archived' ? <button type="button" className={UPB} onClick={() => onEdit(p)} data-testid={`deck-edit-${p.id}`}>Edit</button> : null}
        <RowMenu name={p.name} items={menu} testId={`deck-more-${p.id}`} />
      </span>
    </li>
  );
}

function Preview({ shown }) {
  const v = previewOf(shown);
  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-3 px-[18px] py-4`} aria-labelledby="deck-preview-h" data-testid="deck-preview">
      <h2 id="deck-preview-h" className={H2}>Slide preview</h2>
      <span className={SUB}>It follows the order as rows move.</span>
      <div role="img" aria-label={v.alt} className="rounded-[10px] border border-axal-hairline bg-axal-ground p-3.5 dark:border-gray-700 dark:bg-gray-800">
        <div className={`${EYE} mb-2.5`}>Team &amp; Network</div>
        <div className="grid grid-cols-3 gap-2">
          {v.drawn.map((d) => (
            <div key={d.id} className="flex flex-col items-center gap-1 rounded-[8px] border border-axal-hairline bg-white px-1.5 py-2.5 text-center dark:border-gray-700 dark:bg-gray-900" data-testid={`deck-preview-${d.id}`}>
              <Avatar name={d.name} src={d.photo} size={34} />
              <b className="text-[11px] leading-tight text-axal-ink dark:text-gray-100">{d.name}</b>
              <span className="text-[10px] leading-tight text-axal-muted dark:text-gray-400">{d.role.split(',')[0]}</span>
            </div>
          ))}
        </div>
        <div className="mt-2.5 font-mono text-[11px] font-semibold text-axal-muted dark:text-gray-400" data-testid="deck-preview-line">{v.line}</div>
      </div>
    </section>
  );
}

export default function AdminNetworkProfiles({ embedded = false }) {
  const [tick, setTick] = useState(0);
  const read = useList({ limit: LIMIT }, tick);
  const [openHidden, setOpenHidden] = useState(false);
  const [openArchived, setOpenArchived] = useState(false);
  const archived = useList({ state: 'archived', limit: LIMIT }, tick, openArchived);
  const [order, setOrder] = useState(null);
  const [reorderError, setReorderError] = useState('');
  const [saving, setSaving] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [editing, setEditing] = useState(null);
  const [asking, setAsking] = useState(null);
  const dragId = useRef(null);
  // `success` and `error` are stable; `toast` (the current message) is data to
  // draw and is never a dependency, or every message would reload the list.
  const { toast, success, dismissToast } = useToast();
  const reload = useCallback(() => setTick((t) => t + 1), []);

  const profiles = Array.isArray(read.data?.profiles) ? read.data.profiles : [];
  const split = useMemo(() => splitRoster(read.data?.profiles), [read.data]);
  useEffect(() => { setOrder(null); }, [read.data]);
  const shown = order || split.shown;
  const filtering = Boolean(q.trim() || kind);
  const truncated = Boolean(read.data?.truncated);
  const canMove = read.status === 'ready' && !filtering && !truncated && !saving;
  const tiles = tilesOf(read, split.shown);

  const persist = async (next, moved) => {
    const before = shown;
    setOrder(next);
    setReorderError('');
    setAnnounce(moveLine(moved, next.length));
    setSaving(true);
    try {
      await api.reorder(next.map((p) => p.id));
    } catch (e) {
      setOrder(before);
      setReorderError(`The new order could not be saved${e?.message ? `: ${e.message}` : ''}. The list shows the saved order.`);
      setAnnounce('The new order could not be saved.');
    } finally { setSaving(false); }
  };
  const onMove = (id, delta) => {
    if (!canMove) return;
    const next = moveRow(shown, id, delta);
    if (next) persist(next, next.find((p) => p.id === id));
  };
  const onDrop = (targetId) => {
    const id = dragId.current;
    dragId.current = null;
    if (!canMove || id == null) return;
    const next = dropRow(shown, id, targetId);
    if (next) persist(next, next.find((p) => p.id === id));
  };

  const saveCard = async ({ editing: row, form, photo }) => {
    const saved = await saveProfileForm({ client: api, editing: row, form, notify: { success } });
    const id = saved?.id ?? row?.id;
    if (photo && id != null) {
      try { await api.uploadPhoto(id, photo); }
      catch (e) { return { row: { ...(row || {}), ...saved, id }, photoError: e?.message || 'Upload failed.' }; }
    }
    return { row: { ...(row || {}), ...saved, id } };
  };
  const onSaved = () => { setEditing(null); reload(); };
  const runAct = async () => {
    const { act, row } = asking;
    if (act === 'hide') await api.update(row.id, { is_active: false });
    else if (act === 'show') await api.update(row.id, { is_active: true });
    else if (act === 'archive') await api.archive(row.id);
    else if (act === 'restore') await api.restore(row.id);
    success(confirmCopy(act, row).done);
    setAsking(null);
    reload();
  };

  const state = listState({ loading: read.status === 'loading' && !read.data, loadError: read.status === 'error' && !read.data ? 'unreadable' : '', profiles });
  const visibleShown = filterRows(shown, { q, kind });
  const visibleHidden = filterRows(split.hidden, { q, kind });
  const archivedRows = filterRows(Array.isArray(archived.data?.profiles) ? archived.data.profiles : [], { q, kind });
  const counts = read.data?.counts || null;
  const rowProps = { total: shown.length, canMove, onMove, onDrag: (id) => { dragId.current = id; }, onDrop, onEdit: setEditing, onAct: (act, row) => setAsking({ act, row }) };

  return (
    <div className={embedded ? 'flex flex-col gap-3.5' : 'mx-auto flex max-w-6xl flex-col gap-3.5 p-6'} data-testid="network-roster">
      <ToastMessage toast={toast} onDismiss={dismissToast} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        {embedded ? null : <h1 className="m-0 text-[22px] font-extrabold text-axal-ink dark:text-gray-100">Deck roster</h1>}
        <p className="m-0 max-w-[720px] text-[13px] font-semibold leading-normal text-axal-ink dark:text-gray-100">
          This list feeds the Team &amp; Network slide of the Demo Day deck. The first {ON_SLIDE} shown people are drawn with photo, name and role. Everyone shown counts in the network total.
        </p>
        <button type="button" className={actionPrimary} onClick={() => setEditing({})} data-testid="deck-add">Add person</button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="deck-tiles">
        {tiles.map((t) => <Tile key={t.key} t={t} />)}
      </div>

      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className={`${CARD} flex min-w-0 flex-col gap-3 px-[18px] py-4`} aria-labelledby="deck-list-h" data-testid="deck-list">
          <h2 id="deck-list-h" className={H2}>Shown on the deck · in order</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, role or company" aria-label="Search name, role or company" className={INPUT} data-testid="deck-search" />
            <label className="flex items-center gap-1.5">
              <span className="sr-only">Kind</span>
              <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind" className={INPUT} data-testid="deck-kind">
                <option value="">Kind: all</option>
                {KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
              </select>
            </label>
          </div>
          <p className="sr-only" aria-live="polite" data-testid="deck-announce">{announce}</p>
          {state === 'loading' ? <span className={SUB} data-testid="deck-loading">Reading…</span> : null}
          {state === 'unreadable' ? <div data-testid="profiles-unreadable"><ReadFailed what="The deck roster" error={read.error} onRetry={reload} /></div> : null}
          {read.status === 'error' && read.data ? <span role="alert" className="text-[12.5px] text-red-700 dark:text-red-300">Could not refresh. The rows below are from the last read. <button type="button" className="underline" onClick={reload}>Try again</button></span> : null}
          {state === 'empty' ? (
            <div className="flex flex-col items-start gap-2 py-4" data-testid="deck-empty">
              <b className="text-[14px] text-axal-ink dark:text-gray-100">No one is on the deck roster.</b>
              <span className={SUB}>The slide shows no advisor block until you add someone.</span>
            </div>
          ) : null}
          {reorderError ? <span role="alert" className="text-[12.5px] font-semibold text-red-700 dark:text-red-300" data-testid="deck-reorder-error">{reorderError}</span> : null}
          {state === 'list' || (state === 'empty' && counts?.archived) ? (
            <>
              {filtering && (visibleShown.length || visibleHidden.length) ? <span className={SUB} data-testid="deck-filtering">Clear the search and the Kind filter to reorder.</span> : null}
              {truncated ? <span className={SUB}>Only the first {LIMIT} people are listed, so reordering waits.</span> : null}
              {filtering && !visibleShown.length && !visibleHidden.length ? (
                <div className="flex flex-wrap items-center gap-2 py-2" data-testid="deck-no-match">
                  <span className="text-[13px] text-axal-ink dark:text-gray-100">No one matches{q.trim() ? ` ‘${q.trim()}’` : ' that kind'}.</span>
                  <button type="button" className="text-[12.5px] font-bold text-axal-violet underline dark:text-violet-300" onClick={() => { setQ(''); setKind(''); }}>Clear the search</button>
                </div>
              ) : null}
              <ol className="m-0 list-none p-0" aria-label="Shown on the deck, in order">
                {visibleShown.map((p) => {
                  const index = shown.indexOf(p);
                  return (
                    <React.Fragment key={p.id}>
                      <Row p={p} index={index} state="shown" {...rowProps} />
                      {!filtering && index === ON_SLIDE - 1 && shown.length > ON_SLIDE ? (
                        <li className="border-t-2 border-dashed border-axal-lavender-edge py-3 text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-violet dark:border-violet-800 dark:text-violet-300" data-testid="deck-divider">Below this line, people are not drawn on the slide.</li>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </ol>
              {!shown.length ? <span className={SUB}>No one is shown, so the slide draws no advisor block.</span> : null}
              <div className="flex flex-col">
                <button type="button" aria-expanded={openHidden} onClick={() => setOpenHidden((o) => !o)} className="self-start py-2 text-[13px] font-bold text-axal-ink dark:text-gray-100" data-testid="deck-hidden-toggle">
                  {openHidden ? '▾' : '▸'} Hidden from the deck {counts ? `(${counts.hidden})` : ''}
                </button>
                {openHidden ? (visibleHidden.length
                  ? <ul className="m-0 list-none p-0" data-testid="deck-hidden">{visibleHidden.map((p, i) => <Row key={p.id} p={p} index={i} state="hidden" {...rowProps} />)}</ul>
                  : <span className={SUB}>No one is hidden.</span>) : null}
                <button type="button" aria-expanded={openArchived} onClick={() => setOpenArchived((o) => !o)} className="self-start py-2 text-[13px] font-bold text-axal-ink dark:text-gray-100" data-testid="deck-archived-toggle">
                  {openArchived ? '▾' : '▸'} Archived {counts ? `(${counts.archived})` : ''}
                </button>
                {openArchived ? (
                  archived.status === 'loading' && !archived.data ? <span className={SUB}>Reading…</span>
                    : archived.status === 'error' ? <ReadFailed what="The archived profiles" error={archived.error} onRetry={reload} testId="deck-archived-unreadable" />
                      : archivedRows.length ? <ul className="m-0 list-none p-0" data-testid="deck-archived">{archivedRows.map((p, i) => <Row key={p.id} p={p} index={i} state="archived" {...rowProps} />)}</ul>
                        : <span className={SUB}>No one is archived.</span>
                ) : null}
              </div>
              <span className={SUB}>Drag a row, use Up and Down, or press Alt + Arrow on a focused row. The new position is announced.</span>
            </>
          ) : null}
        </section>
        {state === 'list' || state === 'empty' ? <Preview shown={shown} /> : null}
      </div>

      {editing ? <CardDialog row={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={onSaved} save={saveCard} /> : null}
      {asking ? <ConfirmDialog act={asking.act} row={asking.row} onClose={() => setAsking(null)} run={runAct} /> : null}
    </div>
  );
}
