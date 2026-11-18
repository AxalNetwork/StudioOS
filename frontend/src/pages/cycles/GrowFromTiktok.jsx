import { useEffect, useRef, useState } from 'react';
import { cyclesWrite } from '../../lib/api/cycles';
import BrandIcon from '../../ui/BrandIcon.jsx';
import { StateChip } from '../../ui/Honesty.jsx';
import { TOP_VIDEOS, syncSentence, tiktokView } from './growFromTiktok';

/**
 * D5866 (#5866, part 2 of #2401) — a Grow module's "From TikTok" part
 * (`id="from-tiktok"`), from the module read's `parts.from_tiktok` (D5863,
 * D5864), built to the Grow v2 From TikTok canvas (D5865, GR-21 to GR-27):
 *
 *   - Distribution: reach this month (views of the videos posted in the month
 *     of the latest sync, and how many), those videos, top three by views with
 *     "Show all" expanding in place, and the "Add TikTok as a channel" proposal;
 *   - Revenue and traction: "Audience on TikTok" (followers, total likes,
 *     videos), the latest snapshot, beside revenue and never inside MRR, the
 *     ledger or a KPI.
 *
 * It sits after From Mercury on both pages (`defs/grow.jsx`). Sync, Delete and
 * Accept/Dismiss are drawn only when the read allows them (`can_sync`,
 * `can_delete`, `proposal.can_decide`), so a reader sees the figures alone. A
 * scope the member did not grant reads Not recorded, a failed read Unreadable;
 * neither is ever 0.
 */
export default function GrowFromTiktok(props) {
  return <VentureTiktok key={props.projectId} {...props} />;
}

function VentureTiktok({ slug, part, projectId, reload: onReload }) {
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const reload = (...args) => { if (alive.current) onReload?.(...args); };
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [syncNote, setSyncNote] = useState('');
  const [syncFailed, setSyncFailed] = useState('');
  const [all, setAll] = useState(false);
  const view = tiktokView(part, slug);
  if (view.empty) return null;

  const act = async (key, fn, failed) => {
    setBusy(key); setError('');
    if (key === 'sync') { setSyncNote(''); setSyncFailed(''); }
    try {
      const result = await fn();
      if (!alive.current) return;
      if (key === 'sync') {
        setSyncNote(syncSentence(result?.counts));
        reload({ keepParts: true });
      } else reload();
    } catch (e) {
      if (!alive.current) return;
      const message = e?.message || failed;
      if (key === 'sync') setSyncFailed(message); else setError(message);
    } finally { if (alive.current) setBusy(null); }
  };
  const can = Boolean(projectId);
  const sync = () => act('sync', () => cyclesWrite.grow.syncTiktok(projectId), 'TikTok could not be read. Nothing changed; try again.');
  const remove = (kind, id) => act(`${kind}${id}`, () => cyclesWrite.grow.deleteTiktokFact(projectId, id, kind), 'That figure could not be deleted. It is kept.');
  const decide = (verb, id) => act(`p${id}`, () => (verb === 'accept'
    ? cyclesWrite.grow.acceptTiktokProposal(projectId, id)
    : cyclesWrite.grow.dismissTiktokProposal(projectId, id)), verb === 'accept' ? 'That proposal could not be accepted. It is kept.' : 'That proposal could not be dismissed. It is kept.');

  const reader = view.state === 'ok' && !view.canSync && !view.canDelete && !(view.proposal?.canDecide);
  const sourceLine = view.state === 'ok'
    ? [view.servedBy ? `Read-only, from the public TikTok of ${view.servedBy}` : 'Read-only, from the venture’s public TikTok', view.source].filter(Boolean).join(' · ')
    : view.servedBy ? `Read-only, from the public TikTok of ${view.servedBy}` : 'Read-only, from the venture’s public TikTok';

  return (
    <section id="from-tiktok" className="flex min-w-0 scroll-mt-4 flex-col gap-3 rounded-xl border border-axal-hairline bg-white px-[18px] py-4 dark:border-gray-800 dark:bg-gray-900" data-testid={`cycle-part-tiktok-${slug}`} aria-labelledby={`from-tiktok-title-${slug}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2.5">
        <h2 id={`from-tiktok-title-${slug}`} className="m-0 inline-flex items-center gap-1.5 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100">
          From TikTok
          <span className="inline-flex text-axal-ink dark:text-white" data-testid="tiktok-mark"><BrandIcon provider="tiktok" variant="bare" tone="current" size={15} /></span>
        </h2>
        <span className="flex flex-wrap items-baseline gap-2">
          <span className={FAINT} data-testid="tiktok-source">{sourceLine}</span>
          {view.canSync && can && (
            <button type="button" disabled={busy != null} data-testid="tiktok-sync" onClick={sync}
              className={`${GHOST} min-h-[44px] sm:min-h-0`}>{busy === 'sync' ? 'Syncing…' : 'Sync from TikTok'}</button>
          )}
        </span>
      </div>

      {busy === 'sync' && (
        <p role="status" className={BANNER} data-testid="tiktok-syncing"><StateChip kind="provisional" label="Syncing…" /> The figures below stay until it finishes.</p>
      )}
      {syncFailed && <p role="alert" className={`${BANNER} text-red-700 dark:text-red-300`} data-testid="tiktok-sync-failed">{syncFailed}</p>}
      {view.partlySynced && !syncNote && busy !== 'sync' && (
        <p className={BANNER} data-testid="tiktok-partly-synced"><StateChip kind="partial" label="Partly synced" /> TikTok stopped before the end of the video list. Sync again to finish.</p>
      )}
      {view.disconnected && (
        <p className={MUTED} data-testid="tiktok-disconnected"><StateChip kind="not_recorded" label="Not connected" /> The TikTok that served this venture is no longer connected. The figures below are the last ones read.</p>
      )}

      {view.state === 'unreadable' && (
        <div className="flex flex-wrap items-center gap-2" data-testid="tiktok-unreadable">
          <StateChip kind="unavailable" label="Unreadable" />
          <span className="text-[12.5px] text-axal-ink dark:text-gray-100">{view.reason}. Nothing was lost; the rest of this page still shows.</span>
          {onReload && <button type="button" onClick={() => reload()} className={`${LINK} min-h-[44px]`} data-testid="tiktok-retry">Try again</button>}
        </div>
      )}
      {view.state === 'not_linked' && (
        <div className="flex flex-col gap-1.5" data-testid="tiktok-not-linked">
          <p className={MUTED}><StateChip kind="not_recorded" label="Not connected" /> {view.reason}</p>
          <a href={view.connectHref} className={`${LINK} inline-flex min-h-[44px] items-center sm:min-h-0`} data-testid="tiktok-connect">Connect TikTok</a>
        </div>
      )}
      {view.state === 'not_recorded' && (
        <div className="flex flex-col gap-1.5" data-testid="tiktok-not-recorded">
          <p className={MUTED}><StateChip kind="not_recorded" /> {view.reason}</p>
          {view.reconnect && <a href="/account/connectors/tiktok" className={`${LINK} inline-flex min-h-[44px] items-center sm:min-h-0`} data-testid="tiktok-reconnect">Reconnect to share them</a>}
        </div>
      )}

      {slug === 'distribution' && view.proposal && (
        <Proposal p={view.proposal} busy={busy} can={can} onDecide={decide} />
      )}

      {view.state === 'ok' && slug === 'distribution' && (
        <>
          {view.reach ? (
            <div className="flex flex-col gap-0.5" data-testid="tiktok-reach">
              <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100">
                <b className="text-[20px] font-extrabold tracking-[-.02em]">{view.reach.views}</b> views · <b className="text-[20px] font-extrabold tracking-[-.02em]">{view.reach.posts}</b> {view.reach.posts === 1 ? 'post' : 'posts'}
              </p>
              <p className={LINE}>Reach this month · views of videos posted in {view.month} · {view.source}</p>
              <p className={FAINT}>The sum of the videos below; deleting a video takes it out.{view.reach.missing ? ` ${view.reach.missing} ${view.reach.missing === 1 ? 'video gave' : 'videos gave'} no view count and ${view.reach.missing === 1 ? 'is' : 'are'} not in it.` : ''}</p>
            </div>
          ) : (
            <p className={MUTED} data-testid="tiktok-none-this-month"><StateChip kind="not_applicable" label="None this month" /> No videos posted in {view.month || 'the month of the last sync'}.</p>
          )}
          {view.videos.length > 0 && (
            <Videos videos={all ? view.videos : view.videos.slice(0, TOP_VIDEOS)} total={view.videos.length} month={view.month}
              canDelete={view.canDelete && can} busy={busy} onDelete={(id) => remove('video', id)} />
          )}
          {view.videos.length > TOP_VIDEOS && (
            <button type="button" className={`${LINK} self-start min-h-[44px] sm:min-h-0`} aria-expanded={all} data-testid="tiktok-show-all" onClick={() => setAll((x) => !x)}>
              {all ? `Show the top ${TOP_VIDEOS}` : `Show all ${view.videos.length} videos`}
            </button>
          )}
        </>
      )}

      {view.state === 'ok' && slug === 'revenue-and-traction' && (
        <div className="flex flex-col gap-2 rounded-lg border border-axal-hairline px-3 py-2.5 dark:border-gray-800" data-testid="tiktok-audience">
          <h3 className={SUB}>Audience on TikTok</h3>
          <dl className="m-0 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {view.figures.map((f) => (
              <div key={f.key} className="flex min-w-0 flex-col gap-0.5" data-testid={`tiktok-figure-${f.key}`}>
                <dt className={FAINT}>{f.label ? f.label[0].toUpperCase() + f.label.slice(1) : ''}</dt>
                <dd className="m-0">
                  {f.recorded
                    ? <span className="text-[18px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100">{f.text}</span>
                    : <span className="flex flex-col gap-0.5"><StateChip kind="not_recorded" /><span className={FAINT}>{f.reason}</span></span>}
                </dd>
              </div>
            ))}
          </dl>
          {view.figures.some((f) => f.reconnect) && <a href="/account/connectors/tiktok" className={`${LINK} self-start min-h-[44px] sm:min-h-0`} data-testid="tiktok-reconnect">Reconnect to share them</a>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={FAINT}>Snapshot of {view.snapshotDate} · From TikTok</span>
            {view.canDelete && can && view.snapshotId != null && (
              <button type="button" disabled={busy != null} data-testid={`tiktok-delete-account-${view.snapshotId}`} onClick={() => remove('account', view.snapshotId)}
                aria-label={`Delete the TikTok audience snapshot of ${view.snapshotDate}`} className={`${DELETE} min-h-[44px] sm:min-h-0`}>{busy === `account${view.snapshotId}` ? 'Deleting…' : 'Delete snapshot'}</button>
            )}
          </div>
          <p className={LINE} data-testid="tiktok-not-revenue">Audience, not revenue. These figures never count toward MRR or a KPI.</p>
        </div>
      )}

      {view.state === 'ok' && view.note && slug === 'distribution' && <p className={FAINT}>{view.note}</p>}
      {reader && <p className={MUTED} data-testid="tiktok-reader"><StateChip kind="refused" label="Reads only" /> No Sync, Delete, Accept or Dismiss for you here.</p>}
      {syncNote && <p role="status" className={MUTED} data-testid="tiktok-sync-note">{syncNote}</p>}
      {error && <p role="alert" className="m-0 text-[12px] text-red-700 dark:text-red-300" data-testid="tiktok-error">{error}</p>}
    </section>
  );
}

function Proposal({ p, busy, can, onDecide }) {
  if (p.state === 'accepted') {
    return (
      <p className={`${BANNER} text-emerald-800 dark:text-emerald-300`} data-testid={`tiktok-proposal-${p.id}`}>
        TikTok is now a Distribution channel{p.channel ? ` (${p.channel.name}, source tiktok)` : ''}.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-violet-200 bg-axal-lavender px-3 py-2.5 dark:border-violet-500/40 dark:bg-violet-500/10" data-testid={`tiktok-proposal-${p.id}`}>
      <span className="text-[10px] font-bold uppercase tracking-axal-label text-axal-violet-deep dark:text-violet-300">Proposal · from TikTok</span>
      <p className="m-0 text-[13px] font-bold text-axal-ink dark:text-gray-100">Add TikTok as a channel.</p>
      {p.sentence && <p className={LINE}>{p.sentence}</p>}
      <p className={FAINT}>{p.canDecide ? 'Accept adds a TikTok channel (source tiktok) to your channels. Dismiss is final.' : 'The founder decides. You read only.'}</p>
      {p.canDecide && can && (
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" disabled={busy != null} data-testid={`tiktok-accept-${p.id}`} onClick={() => onDecide('accept', p.id)}
            className="min-h-[44px] rounded-md bg-axal-violet px-3 py-1 text-[12px] font-bold text-white transition-colors hover:bg-axal-violet-deep disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-0">{busy === `p${p.id}` ? 'Saving…' : 'Accept'}</button>
          <button type="button" disabled={busy != null} data-testid={`tiktok-dismiss-${p.id}`} onClick={() => onDecide('dismiss', p.id)}
            className={`${GHOST} min-h-[44px] sm:min-h-0`}>Dismiss</button>
        </div>
      )}
    </div>
  );
}

const FIGURES = [['views', 'Views'], ['likes', 'Likes'], ['comments', 'Comments'], ['shares', 'Shares']];

function Cell({ f }) {
  return f.n != null
    ? <span className="text-axal-ink dark:text-gray-100">{f.text}</span>
    : <span title={f.reason} className="text-axal-muted dark:text-gray-400" data-testid="tiktok-cell-not-recorded"><StateChip kind="not_recorded" /></span>;
}

function Videos({ videos, total, month, canDelete, busy, onDelete }) {
  const ranked = videos.length < total ? ` · top ${videos.length} of ${total} by views` : ' · by views';
  const caption = `Videos posted in ${month}${ranked} · public videos only`;
  const del = (v) => (canDelete ? (
    <button type="button" disabled={busy != null} data-testid={`tiktok-delete-video-${v.id}`} onClick={() => onDelete(v.id)}
      aria-label={`Delete the figures of ${v.title}`} className={`${DELETE} min-h-[44px] sm:min-h-0`}>{busy === `video${v.id}` ? 'Deleting…' : 'Delete'}</button>
  ) : null);
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-testid="tiktok-videos">
      {/* Desktop: a table with a caption and column headers. */}
      <table className="hidden w-full border-collapse text-left text-[12.5px] sm:table">
        <caption className={`${SUB} pb-1.5 text-left`}>{caption}</caption>
        <thead>
          <tr className="border-b border-axal-hairline dark:border-gray-800">
            <th scope="col" className={TH}>Posted</th>
            <th scope="col" className={TH}>Title · first 150 characters</th>
            {FIGURES.map(([, label]) => <th key={label} scope="col" className={`${TH} text-right`}>{label}</th>)}
            {canDelete && <th scope="col" className={TH}><span className="sr-only">Actions</span></th>}
          </tr>
        </thead>
        <tbody>
          {videos.map((v) => (
            <tr key={v.id} className="border-b border-axal-hairline align-top last:border-0 dark:border-gray-800" data-testid={`tiktok-video-${v.id}`}>
              <td className="whitespace-nowrap py-1.5 pr-3 text-axal-ink dark:text-gray-100">{v.posted}</td>
              <td className="py-1.5 pr-3">
                <span className="block font-semibold text-axal-ink dark:text-gray-100">{v.title}</span>
                {v.source && <span className={FAINT}>{v.source}</span>}
              </td>
              {FIGURES.map(([k]) => <td key={k} className="py-1.5 pr-3 text-right tabular-nums"><Cell f={v[k]} /></td>)}
              {canDelete && <td className="py-1.5 text-right">{del(v)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {/* Phone: one card per video, the four counts in a 2 × 2 grid. */}
      <h3 className={`${SUB} sm:hidden`}>{caption}</h3>
      <ul className="m-0 flex list-none flex-col gap-2 p-0 sm:hidden">
        {videos.map((v) => (
          <li key={v.id} className="flex flex-col gap-1.5 rounded-lg border border-axal-hairline px-3 py-2.5 dark:border-gray-800" data-testid={`tiktok-video-card-${v.id}`}>
            <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{v.title}</span>
            <span className={FAINT}>Posted {v.posted}</span>
            <dl className="m-0 grid grid-cols-2 gap-1.5">
              {FIGURES.map(([k, label]) => (
                <div key={k} className="flex flex-col"><dt className={FAINT}>{label}</dt><dd className="m-0 text-[13px] font-bold tabular-nums"><Cell f={v[k]} /></dd></div>
              ))}
            </dl>
            <span className="flex flex-wrap items-center justify-between gap-2">
              {v.source && <span className={FAINT}>{v.source}</span>}
              {del(v)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const SUB = 'm-0 text-[11px] font-bold uppercase tracking-axal-label text-axal-muted dark:text-gray-400';
const TH = 'py-1 pr-3 text-[11px] font-bold uppercase tracking-axal-label text-axal-muted dark:text-gray-400';
const LINE = 'm-0 text-[12px] text-axal-ink/80 dark:text-gray-300';
const MUTED = 'm-0 text-[12.5px] text-axal-muted dark:text-gray-400';
const FAINT = 'text-[11px] text-axal-faint dark:text-gray-500';
const BANNER = 'm-0 flex flex-wrap items-center gap-2 rounded-lg border border-axal-hairline bg-axal-ground px-3 py-2 text-[12.5px] text-axal-ink dark:border-gray-800 dark:bg-gray-800/60 dark:text-gray-100';
const GHOST = 'rounded-md border border-axal-hairline px-2.5 py-0.5 text-[11.5px] font-bold text-axal-ink disabled:opacity-50 dark:border-gray-700 dark:text-gray-200';
const LINK = 'text-[12px] font-bold text-axal-violet-deep underline-offset-2 hover:underline dark:text-violet-300';
const DELETE = 'text-[11px] font-semibold text-axal-muted underline-offset-2 hover:underline disabled:opacity-50 dark:text-gray-400';
