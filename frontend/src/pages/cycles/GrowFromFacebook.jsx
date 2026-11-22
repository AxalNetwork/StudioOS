import { useEffect, useRef, useState } from 'react';
import { cyclesWrite } from '../../lib/api/cycles';
import BrandIcon from '../../ui/BrandIcon.jsx';
import { StateChip } from '../../ui/Honesty.jsx';
import { facebookView, syncFailure, syncSentence } from './growFromFacebook';

/**
 * D5862 (#5862, part 2 of #2399) — a Grow module's "From Facebook" part
 * (`id="from-facebook"`), from the module read's `parts.from_facebook` (D5859,
 * D5860), built to the Grow v2 From Facebook canvas (D5861, GR-21 to GR-26):
 *
 *   - Distribution: the Page, Sync, and its figures for the days the read
 *     carries (views, unique viewers on the newest day, post engagements), the
 *     daily rows with a Delete on each figure, and "Link your Facebook Page to a
 *     Distribution channel" with Accept and Dismiss;
 *   - Revenue and traction: "Audience, not revenue": followers now, with its
 *     change and a Delete, never inside MRR, the ledger or a KPI.
 *
 * It sits after From TikTok on both pages (`defs/grow.jsx`). Sync, Delete and
 * Accept/Dismiss are drawn only when the read allows them (`can_sync`,
 * `can_delete`, `proposal.can_decide`), so a reader sees the figures alone. A
 * missing figure reads Not recorded, a failed read Unreadable, a refused token
 * Reconnect with Facebook; none is ever 0. A failed part never stops the module.
 */
export default function GrowFromFacebook(props) {
  return <VentureFacebook key={props.projectId} {...props} />;
}

function VentureFacebook({ slug, part, projectId, loading = false, reload: onReload }) {
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const reload = (...args) => { if (alive.current) onReload?.(...args); };
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [syncNote, setSyncNote] = useState('');
  const [syncFailed, setSyncFailed] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [toast, setToast] = useState('');
  const view = facebookView(part, slug);
  if (view.empty) {
    if (!loading) return null;
    return (
      <section id="from-facebook" aria-busy="true" className={CARD} data-testid={`cycle-part-facebook-${slug}`}>
        <Heading slug={slug} />
        <p role="status" className={MUTED} data-testid="facebook-loading"><StateChip kind="provisional" label="Loading" /> Loading From Facebook…</p>
      </section>
    );
  }

  const act = async (key, fn, failed, after) => {
    setBusy(key); setError('');
    if (key === 'sync') { setSyncNote(''); setSyncFailed(null); }
    try {
      const result = await fn();
      if (!alive.current) return;
      if (key === 'sync') {
        setSyncNote(syncSentence(result?.counts));
        reload({ keepParts: true });
      } else { after?.(); reload(); }
    } catch (e) {
      if (!alive.current) return;
      if (key === 'sync') setSyncFailed(syncFailure(e)); else setError(e?.message || failed);
    } finally { if (alive.current) setBusy(null); }
  };
  const can = Boolean(projectId);
  const sync = () => act('sync', () => cyclesWrite.grow.syncFacebook(projectId), 'Facebook could not be read. Nothing changed.');
  const remove = (id) => act(`f${id}`, () => cyclesWrite.grow.deleteFacebookFact(projectId, id), 'That figure could not be deleted. It is kept.', () => setConfirm(null));
  const decide = (verb, id) => act(`p${id}`, () => (verb === 'accept'
    ? cyclesWrite.grow.acceptFacebookProposal(projectId, id)
    : cyclesWrite.grow.dismissFacebookProposal(projectId, id)), verb === 'accept' ? 'That proposal could not be accepted. It is kept.' : 'That proposal could not be dismissed. It is kept.',
  () => { if (verb === 'dismiss') setToast('Dismissed. It will not be proposed again.'); });

  const pending = view.proposal?.state === 'pending' && view.proposal.canDecide;
  const reader = view.state === 'ok' && !view.canSync && !view.canDelete && !pending;
  const source = [view.pageName ? `Page · ${view.pageName}` : null, view.servedBy ? `served by ${view.servedBy}` : null, view.state === 'ok' ? view.source : null].filter(Boolean).join(' · ');
  const askDelete = (f, period) => setConfirm({ id: f.id, label: f.label, period, value: f.text });

  return (
    <section id="from-facebook" className={CARD} data-testid={`cycle-part-facebook-${slug}`} aria-labelledby={`from-facebook-title-${slug}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2.5">
        <Heading slug={slug} />
        <span className="flex flex-wrap items-baseline gap-2">
          {source && <span className={FAINT} data-testid="facebook-source">{source}</span>}
          {view.canSync && can && (
            // One primary per screen (D5861 part 2, option A): Sync is violet unless a proposal waits on Accept.
            <button type="button" disabled={busy != null} data-testid="facebook-sync" onClick={sync}
              className={`${pending ? GHOST : PRIMARY} min-h-[44px] sm:min-h-0`}>{busy === 'sync' ? 'Syncing…' : syncFailed ? 'Try again' : 'Sync from Facebook'}</button>
          )}
        </span>
      </div>

      {busy === 'sync' && <p role="status" className={BANNER} data-testid="facebook-syncing"><StateChip kind="provisional" label="Syncing…" /> The figures below stay until it finishes.</p>}
      {syncFailed && (
        <div role="alert" className={`${BANNER} text-red-700 dark:text-red-300`} data-testid={`facebook-sync-${syncFailed.kind}`}>
          <span>{syncFailed.sentence}</span>
          {syncFailed.kind === 'reconnect' && <a href={view.connectHref || '/account/connectors/facebook'} className={LINK} data-testid="facebook-reconnect">Reconnect with Facebook</a>}
        </div>
      )}
      {view.partlySynced && !syncNote && busy !== 'sync' && (
        <p className={BANNER} data-testid="facebook-partly-synced"><StateChip kind="partial" label="Partly synced" /> Some months were not read yet. Sync again to finish.</p>
      )}
      {view.disconnected && (
        <p className={MUTED} data-testid="facebook-disconnected"><StateChip kind="not_recorded" label="Not connected" /> The Facebook that served this venture is no longer connected. The figures below are the last ones read.</p>
      )}

      {view.state === 'unreadable' && (
        <div className="flex flex-wrap items-center gap-2" data-testid="facebook-unreadable">
          <StateChip kind="unavailable" label="Unreadable" />
          <span className="text-[12.5px] text-axal-ink dark:text-gray-100">{view.reason}. Nothing was lost; the rest of this page still shows.</span>
          {onReload && <button type="button" onClick={() => reload()} className={`${LINK} min-h-[44px]`} data-testid="facebook-retry">Try again</button>}
        </div>
      )}
      {view.state === 'not_linked' && (
        <div className="flex flex-col gap-1.5" data-testid="facebook-not-linked">
          <p className={MUTED}><StateChip kind="not_recorded" label="Not connected" /> Connect Facebook and choose a Page to see its followers, views and engagement here.</p>
          <p className={FAINT}>{view.reason}</p>
          {view.canLink && <a href={view.connectHref} className={`${LINK} inline-flex min-h-[44px] items-center sm:min-h-0`} data-testid="facebook-connect">Connect Facebook</a>}
        </div>
      )}
      {view.state === 'not_recorded' && (
        <p className={MUTED} data-testid="facebook-not-recorded"><StateChip kind="not_recorded" /> {view.reason} Nothing has been read from Facebook yet.</p>
      )}

      {slug === 'distribution' && view.proposal && <Proposal p={view.proposal} busy={busy} can={can} onDecide={decide} />}

      {view.state === 'ok' && slug === 'distribution' && (
        <>
          <dl className="m-0 grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="facebook-figures">
            {view.figures.map((f) => (
              <div key={f.key} className="flex min-w-0 flex-col gap-0.5" data-testid={`facebook-figure-${f.key}`}>
                <dt className={FAINT}>{f.label}</dt>
                <dd className="m-0 flex flex-col gap-0.5">
                  {f.recorded
                    ? <span className="text-[20px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100">{f.text}</span>
                    : <span className="flex flex-col gap-0.5"><StateChip kind="not_recorded" /><span className={FAINT}>{f.reason}</span></span>}
                  {f.sub && <span className={FAINT}>{f.sub}</span>}
                </dd>
              </div>
            ))}
          </dl>
          {view.days.length > 0 && <Days days={view.days} canDelete={view.canDelete && can} busy={busy} onDelete={askDelete} />}
        </>
      )}

      {view.state === 'ok' && slug === 'revenue-and-traction' && (
        <div className="flex flex-col gap-2 rounded-lg border border-axal-hairline px-3 py-2.5 dark:border-gray-800" data-testid="facebook-audience">
          <h3 className={SUB}>Audience, not revenue</h3>
          <div className="flex flex-wrap items-baseline justify-between gap-2" data-testid="facebook-figure-followers">
            <span className="flex flex-col gap-0.5">
              <span className={FAINT}>Followers{view.followers.on ? ` · ${view.followers.on}` : ''}</span>
              {view.followers.recorded
                ? <span className="text-[20px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100">{view.followers.text}</span>
                : <span className="flex flex-col gap-0.5"><StateChip kind="not_recorded" /><span className={FAINT}>{view.followers.reason}</span></span>}
              {view.followers.change && <span className={FAINT} data-testid="facebook-followers-change">{view.followers.change}</span>}
            </span>
            {view.canDelete && can && view.followers.id != null && (
              <button type="button" disabled={busy != null} data-testid={`facebook-delete-${view.followers.id}`}
                onClick={() => askDelete({ id: view.followers.id, label: 'Followers', text: view.followers.text }, view.followers.on)}
                aria-label={`Delete the Facebook follower count of ${view.followers.on || 'this day'}`} className={`${DELETE} min-h-[44px] sm:min-h-0`}>Delete</button>
            )}
          </div>
          <p className={LINE} data-testid="facebook-not-revenue">Audience figures. They are never revenue, never a KPI and never added into a money figure.</p>
        </div>
      )}

      {view.state === 'ok' && view.note && <p className={FAINT}>{view.note}</p>}
      {reader && <p className={MUTED} data-testid="facebook-reader"><StateChip kind="refused" label="Reads only" /> No Sync, Delete, Accept or Dismiss for you here.</p>}
      {syncNote && <p role="status" className={MUTED} data-testid="facebook-sync-note">{syncNote}</p>}
      {toast && <p role="status" className={MUTED} data-testid="facebook-toast">{toast}</p>}
      {error && <p role="alert" className="m-0 text-[12px] text-red-700 dark:text-red-300" data-testid="facebook-error">{error}</p>}
      {confirm && <ConfirmDelete item={confirm} busy={busy === `f${confirm.id}`} onCancel={() => setConfirm(null)} onDelete={() => remove(confirm.id)} />}
    </section>
  );
}

function Heading({ slug }) {
  return (
    <h2 id={`from-facebook-title-${slug}`} className="m-0 inline-flex items-center gap-1.5 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100">
      From Facebook
      <span className="inline-flex" data-testid="facebook-mark"><BrandIcon provider="facebook" variant="bare" size={15} /></span>
    </h2>
  );
}

function Proposal({ p, busy, can, onDecide }) {
  if (p.state === 'accepted') {
    return (
      <p className={`${BANNER} text-emerald-800 dark:text-emerald-300`} data-testid={`facebook-proposal-${p.id}`}>
        Your Facebook Page is linked to a Distribution channel{p.channel ? ` (${p.channel.name}, source facebook)` : ''}. Contacts who arrive from Facebook will count toward this channel.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-violet-200 bg-axal-lavender px-3 py-2.5 dark:border-violet-500/40 dark:bg-violet-500/10" data-testid={`facebook-proposal-${p.id}`}>
      <span className="text-[10px] font-bold uppercase tracking-axal-label text-axal-violet-deep dark:text-violet-300">Proposed from your Facebook Page</span>
      <p className="m-0 text-[13px] font-bold text-axal-ink dark:text-gray-100">{p.sentence || 'Link your Facebook Page to a Distribution channel?'}</p>
      <p className={FAINT}>{p.canDecide ? 'Accept links your channel whose source is facebook, or creates it. Contacts who arrive from Facebook will count toward this channel. Dismiss is final.' : 'The member whose Facebook serves this venture decides. You read only.'}</p>
      {p.canDecide && can && (
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" disabled={busy != null} data-testid={`facebook-accept-${p.id}`} onClick={() => onDecide('accept', p.id)}
            className={`${PRIMARY} min-h-[44px] sm:min-h-0`}>{busy === `p${p.id}` ? 'Saving…' : 'Accept'}</button>
          <button type="button" disabled={busy != null} data-testid={`facebook-dismiss-${p.id}`} onClick={() => onDecide('dismiss', p.id)}
            className={`${GHOST} min-h-[44px] sm:min-h-0`}>Dismiss</button>
        </div>
      )}
    </div>
  );
}

const COLUMNS = [['views', 'Views'], ['viewers', 'Unique viewers'], ['engagements', 'Post engagements']];

function Cell({ f, label, day, canDelete, busy, onDelete }) {
  return (
    <span className="inline-flex items-center justify-end gap-2">
      {f.recorded
        ? <span className="text-axal-ink dark:text-gray-100">{f.text}</span>
        : <span title={f.reason} className="text-axal-muted dark:text-gray-400" data-testid="facebook-cell-not-recorded"><StateChip kind="not_recorded" /></span>}
      {canDelete && f.recorded && f.id != null && (
        <button type="button" disabled={busy != null} data-testid={`facebook-delete-${f.id}`} onClick={() => onDelete({ ...f, label }, day)}
          aria-label={`Delete ${label.toLowerCase()} of ${day}`} className={`${DELETE} min-h-[44px] sm:min-h-0`}>Delete</button>
      )}
    </span>
  );
}

function Days({ days, canDelete, busy, onDelete }) {
  const caption = `Daily figures · newest first · ${days.length} days`;
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-testid="facebook-days">
      {/* Desktop: a table with a caption and column headers. */}
      <table className="hidden w-full border-collapse text-left text-[12.5px] sm:table">
        <caption className={`${SUB} pb-1.5 text-left`}>{caption}</caption>
        <thead>
          <tr className="border-b border-axal-hairline dark:border-gray-800">
            <th scope="col" className={TH}>Day</th>
            {COLUMNS.map(([, label]) => <th key={label} scope="col" className={`${TH} text-right`}>{label}</th>)}
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.day} className="border-b border-axal-hairline align-top last:border-0 dark:border-gray-800" data-testid={`facebook-day-${d.day}`}>
              <th scope="row" className="whitespace-nowrap py-1.5 pr-3 text-left font-semibold text-axal-ink dark:text-gray-100">{d.label}</th>
              {COLUMNS.map(([k, label]) => <td key={k} className="py-1.5 pr-3 text-right tabular-nums"><Cell f={d[k]} label={label} day={d.label} canDelete={canDelete} busy={busy} onDelete={onDelete} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {/* Phone: one card per day, newest first. */}
      <h3 className={`${SUB} sm:hidden`}>{caption}</h3>
      <ul className="m-0 flex list-none flex-col gap-2 p-0 sm:hidden">
        {days.map((d) => (
          <li key={d.day} className="flex flex-col gap-1.5 rounded-lg border border-axal-hairline px-3 py-2.5 dark:border-gray-800" data-testid={`facebook-day-card-${d.day}`}>
            <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{d.label}</span>
            <dl className="m-0 flex flex-col gap-1">
              {COLUMNS.map(([k, label]) => (
                <div key={k} className="flex items-center justify-between gap-2"><dt className={FAINT}>{label}</dt><dd className="m-0 text-[13px] font-bold tabular-nums"><Cell f={d[k]} label={label} day={d.label} canDelete={canDelete} busy={busy} onDelete={onDelete} /></dd></div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** GR-21: Delete on a figure, a small dialog (a bottom sheet on a phone); focus starts on Cancel. */
function ConfirmDelete({ item, busy, onCancel, onDelete }) {
  const cancel = useRef(null);
  useEffect(() => { cancel.current?.focus?.(); }, []);
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="facebook-delete-title" data-testid="facebook-delete-dialog"
      onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
      className="flex flex-col gap-2 rounded-lg border border-axal-hairline bg-white px-3 py-3 shadow-lg dark:border-gray-700 dark:bg-gray-900 max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-50 max-sm:rounded-b-none">
      <h3 id="facebook-delete-title" className="m-0 text-[14px] font-bold text-axal-ink dark:text-gray-100">Delete this figure</h3>
      <p className={LINE}>{[item.label, item.period, item.value].filter(Boolean).join(' · ')}. It stays deleted after the next sync.</p>
      <div className="flex flex-wrap gap-2">
        <button ref={cancel} type="button" onClick={onCancel} className={`${GHOST} min-h-[44px] sm:min-h-0`} data-testid="facebook-delete-cancel">Cancel</button>
        <button type="button" disabled={busy} onClick={onDelete} data-testid="facebook-delete-confirm"
          className="min-h-[44px] rounded-md bg-red-700 px-3 py-1 text-[12px] font-bold text-white disabled:opacity-50 dark:bg-red-600 sm:min-h-0">{busy ? 'Deleting…' : 'Delete'}</button>
      </div>
    </div>
  );
}

const CARD = 'flex min-w-0 scroll-mt-4 flex-col gap-3 rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900';
const SUB = 'm-0 text-[11px] font-bold uppercase tracking-axal-label text-axal-muted dark:text-gray-400';
const TH = 'py-1 pr-3 text-[11px] font-bold uppercase tracking-axal-label text-axal-muted dark:text-gray-400';
const LINE = 'm-0 text-[12px] text-axal-ink/80 dark:text-gray-300';
const MUTED = 'm-0 text-[12.5px] text-axal-muted dark:text-gray-400';
const FAINT = 'text-[11px] text-axal-faint dark:text-gray-400';
const BANNER = 'm-0 flex flex-wrap items-center gap-2 rounded-lg border border-axal-hairline bg-axal-ground px-3 py-2 text-[12.5px] text-axal-ink dark:border-gray-800 dark:bg-gray-800/60 dark:text-gray-100';
const PRIMARY = 'rounded-md bg-axal-violet px-3 py-1 text-[12px] font-bold text-white transition-colors hover:bg-axal-violet-deep disabled:cursor-not-allowed disabled:opacity-50';
const GHOST = 'rounded-md border border-axal-hairline px-2.5 py-0.5 text-[11.5px] font-bold text-axal-ink disabled:opacity-50 dark:border-gray-700 dark:text-gray-200';
const LINK = 'text-[12px] font-bold text-axal-violet-deep underline-offset-2 hover:underline dark:text-violet-300';
const DELETE = 'text-[11px] font-semibold text-axal-muted underline-offset-2 hover:underline disabled:opacity-50 dark:text-gray-400';
