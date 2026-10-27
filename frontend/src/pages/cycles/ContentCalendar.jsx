import { useState } from 'react';
import Lightbox from '../../ui/Lightbox';
import { cyclesWrite } from '../../lib/api/cycles';

/**
 * D1090 (#2955) — Distribution's content calendar, from the module read's
 * `parts.content_calendar` (migration 587). Planned pieces: a plan, never a
 * record of what was sent.
 *
 * A piece is typed here ("Plan a piece") or comes from the founder's Notion
 * (marked From Notion). A typed piece is edited here; one from Notion is
 * edited in Notion, so it offers Delete only, and stays deleted. Every change
 * opens a dialog that says what it changes. An unreadable calendar says so on
 * its own with Try again; the channels above it still load.
 */
export const CONTENT_STATUS = Object.freeze([
  ['idea', 'Idea'], ['planned', 'Planned'], ['scheduled', 'Scheduled'], ['published', 'Published'], ['dropped', 'Dropped'],
]);
const STATUS_LABEL = Object.fromEntries(CONTENT_STATUS);

/** A planned day, written out; no date says so, never a guessed one. */
export function plannedLabel(day) {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(String(day))) return 'No date yet';
  const d = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(d.valueOf()) ? 'No date yet' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** The body a dialog sends: every field, a blank one as none. */
export function contentBody(f) {
  return { title: (f.title || '').trim(), planned_on: f.planned_on || null, status: f.status || 'idea', channel_uid: f.channel_uid || null, url: (f.url || '').trim() || null };
}

export default function ContentCalendar({ part, channels, projectId, reload, api = cyclesWrite.grow }) {
  const [dialog, setDialog] = useState(null);
  if (!part) return null;
  const done = () => { setDialog(null); reload?.(); };
  return (
    <section className={CARD} data-testid="content-calendar" aria-labelledby="content-calendar-title">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id="content-calendar-title" className="m-0 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100">Content calendar</h2>
          <p className="m-0 text-[12px] text-axal-muted dark:text-gray-400">Pieces you plan to publish. A plan, never a record of what was sent.</p>
        </div>
        {projectId && part.state === 'ready' && (
          <button type="button" className={BTN} onClick={() => setDialog({ kind: 'add' })} data-testid="content-add">Plan a piece</button>
        )}
      </div>
      {part.state === 'unreadable' ? (
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]" data-testid="content-unreadable">
          <span className="text-red-700 dark:text-red-300">{part.reason || 'Unreadable: the content calendar could not be read'}</span>
          {reload && <button type="button" className={BTN} onClick={reload} data-testid="content-retry">Try again</button>}
        </div>
      ) : !(part.items || []).length ? (
        <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="content-empty">Nothing planned yet. Plan a piece here, or map a content calendar from Notion.</p>
      ) : (
        <ul className="m-0 list-none p-0" data-testid="content-items">
          {part.items.map((i) => (
            <li key={i.uid} className="flex flex-wrap items-start justify-between gap-2 border-b border-axal-ground py-2 text-[12.5px] last:border-b-0 dark:border-gray-800" data-testid={`content-item-${i.uid}`}>
              <div className="min-w-0">
                <div className="font-semibold text-axal-ink dark:text-gray-100">
                  {i.url ? <a href={i.url} target="_blank" rel="noopener noreferrer" className="underline decoration-axal-hairline underline-offset-2">{i.title}</a> : i.title}
                </div>
                <div className="text-axal-muted dark:text-gray-400">{plannedLabel(i.planned_on)} · {i.channel_name || 'No channel'}</div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={PILL}>{STATUS_LABEL[i.status] || i.status}</span>
                {i.source === 'notion' && <span className={PILL} data-testid={`content-notion-${i.uid}`}>From Notion</span>}
                {projectId && i.source !== 'notion' && <button type="button" className={LINK} onClick={() => setDialog({ kind: 'edit', item: i })} data-testid={`content-edit-${i.uid}`}>Edit</button>}
                {projectId && <button type="button" className={LINK} onClick={() => setDialog({ kind: 'delete', item: i })} data-testid={`content-delete-${i.uid}`}>Delete</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {dialog?.kind === 'delete' && <DeleteDialog item={dialog.item} onClose={() => setDialog(null)} onConfirm={() => api.contentDelete(projectId, dialog.item.uid).then(done)} />}
      {(dialog?.kind === 'add' || dialog?.kind === 'edit') && (
        <PieceDialog item={dialog.item} channels={channels || []} onClose={() => setDialog(null)}
          onSave={(body) => (dialog.item ? api.contentUpdate(projectId, dialog.item.uid, body) : api.content(projectId, body)).then(done)} />
      )}
    </section>
  );
}

function PieceDialog({ item, channels, onClose, onSave }) {
  const [f, setF] = useState(() => ({ title: item?.title || '', planned_on: item?.planned_on || '', status: item?.status || 'idea', channel_uid: item?.channel_uid || '', url: item?.url || '' }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const title = item ? 'Edit the planned piece' : 'Plan a piece';
  const go = async () => {
    if (!f.title.trim()) { setError('Give the piece a title.'); return; }
    setBusy(true); setError(null);
    try { await onSave(contentBody(f)); } catch (e) { setError(e?.data?.detail || 'The piece could not be saved. Try again.'); setBusy(false); }
  };
  return (
    <Lightbox label={title} title={title} onClose={() => { if (!busy) onClose(); }} width={480} testId="content-dialog" phone="sheet"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={GHOST} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={PRIMARY} onClick={go} disabled={busy} data-testid="content-save">{busy ? 'Saving…' : item ? 'Save changes' : 'Add to the calendar'}</button>
        </div>
      )}>
      <div className="flex flex-col gap-3 px-5 py-4 text-[13px] text-axal-ink dark:text-gray-100">
        <p className="m-0 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="content-what">
          {item ? 'Changes this piece on Distribution’s content calendar. Nothing is published or sent.' : 'Adds a piece to Distribution’s content calendar. Nothing is published or sent.'}
        </p>
        <label className="block font-semibold">Title<input className={INPUT} value={f.title} onChange={set('title')} maxLength={200} data-testid="content-title" /></label>
        <label className="block font-semibold">Planned for<input type="date" className={INPUT} value={f.planned_on} onChange={set('planned_on')} data-testid="content-date" /></label>
        <label className="block font-semibold">Status
          <select className={INPUT} value={f.status} onChange={set('status')} data-testid="content-status">
            {CONTENT_STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="block font-semibold">Channel
          <select className={INPUT} value={f.channel_uid} onChange={set('channel_uid')} data-testid="content-channel">
            <option value="">No channel</option>
            {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="block font-semibold">Link<input type="url" className={INPUT} value={f.url} onChange={set('url')} placeholder="https://" data-testid="content-url" /></label>
        {error && <p className="m-0 text-[12.5px] text-red-700 dark:text-red-300" role="alert" data-testid="content-error">{error}</p>}
      </div>
    </Lightbox>
  );
}

function DeleteDialog({ item, onClose, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const go = async () => {
    setBusy(true); setError(null);
    try { await onConfirm(); } catch (e) { setError(e?.data?.detail || 'The piece could not be deleted. Try again.'); setBusy(false); }
  };
  return (
    <Lightbox label="Delete the planned piece" title="Delete the planned piece" sub={item.title} onClose={() => { if (!busy) onClose(); }} width={440} testId="content-delete-dialog" phone="sheet"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={GHOST} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={DANGER} onClick={go} disabled={busy} data-testid="content-delete-confirm">{busy ? 'Deleting…' : 'Delete'}</button>
        </div>
      )}>
      <p className="m-0 px-5 py-4 text-[12.5px] text-axal-muted dark:text-gray-400" data-testid="content-delete-what">
        {item.source === 'notion'
          ? 'Removes this piece from the calendar. It stays deleted: the next sync from Notion does not bring it back.'
          : 'Removes this piece from the calendar.'}
      </p>
      {error && <p className="m-0 px-5 pb-4 text-[12.5px] text-red-700 dark:text-red-300" role="alert" data-testid="content-delete-error">{error}</p>}
    </Lightbox>
  );
}

const CARD = 'flex min-w-0 flex-col gap-2 rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900';
const PILL = 'whitespace-nowrap rounded-full border border-axal-hairline px-2 py-0.5 text-[10.5px] font-bold text-axal-muted dark:border-gray-700 dark:text-gray-300';
const INPUT = 'mt-1 w-full rounded-axal-sm border border-axal-hairline bg-white px-2.5 py-1.5 text-[13px] font-normal text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 max-sm:min-h-[44px]';
const BTN = 'inline-flex items-center justify-center rounded-axal-sm border border-axal-hairline bg-white px-3 py-1.5 text-[12.5px] font-semibold text-axal-ink hover:border-axal-violet/40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:border-violet-400/40 max-sm:min-h-[44px]';
const LINK = 'text-[12px] font-semibold text-axal-violet hover:underline dark:text-violet-300 max-sm:min-h-[44px]';
const PRIMARY = 'inline-flex items-center justify-center rounded-axal-sm bg-axal-violet px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-axal-violet-deep disabled:opacity-50 dark:hover:bg-violet-500 max-sm:min-h-[44px]';
const DANGER = 'inline-flex items-center justify-center rounded-axal-sm bg-red-700 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-red-800 disabled:opacity-50 dark:bg-red-600 dark:hover:bg-red-500 max-sm:min-h-[44px]';
const GHOST = 'inline-flex items-center justify-center rounded-axal-sm border border-axal-hairline bg-white px-3 py-1.5 text-[12.5px] font-semibold text-axal-ink hover:border-axal-violet/40 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:border-violet-400/40 max-sm:min-h-[44px]';
