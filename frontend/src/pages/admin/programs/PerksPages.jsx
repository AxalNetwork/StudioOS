import React, { useEffect, useState } from 'react';
import { TIER_PLANS } from '../../../components/PaywallModal';
import { Lightbox, actionPrimary, usePhoneWidth } from '../../../ui';
import { api } from '../../../lib/api';
import { reportError } from '../../../lib/log';
import { AdjustForm } from '../../hq/MemberCreditsPage';
import {
  BlockFailed, CARD, Card, ChartCard, DIALOG_BODY, DIALOG_LINES, DialogButtons, FIELD_LABEL, Field, INPUT, Pill, SUB, Skeleton,
  TD, TH, Tile,
} from './parts';
import { useRead } from './useProgramReads';
import {
  ACTION_WORD, CREDITS_DONE, CREDITS_FOOT, CREDITS_HELD_WAITS, LISTING_DONE, LISTING_STATUSES, PAGE_SIZE, PERK_WEEKS_LINE,
  countLine, listingActions, listingBody, listingDialog, listingWord, perkClaimsFrom, refusalSentence, shortDay, totalOf,
} from './programPagesModel';
import {
  HQ_READS_MONEY, NOTHING_WAITING, NOT_READ_YET, NOT_RECORDED, OVERDUE_HOURS, PERKS_EMPTY, ageText, hoursSince, isReady,
  livePerksFrom, perkPrice,
} from './programsModel';

/**
 * D953 (#2371), completed by D962 (#2795) on part 4's reads (D957) —
 * Perks (PG10, PG10s): Overview's tiles, Top perks by claims and Claims per
 * week by price type, each with its window; Grant or deduct credits for a
 * Super Admin; and the Queue on the listings in every state, paged with its
 * total, where Approve, Reject, Pause and the feature switch each open a
 * dialog. A listing waits from its last edit. Say "Reject", never "Send
 * back", until OD7.
 */

const tierName = (t) => TIER_PLANS[t]?.label || (t === 'free' ? 'Free' : '');
const nf = (n) => Number(n).toLocaleString('en-US');
const STATUS_TONE = { in_review: 'amber', draft: 'muted', live: 'green', paused: 'muted', rejected: 'red' };

/** PG10s: the member is found by name or email, then D608's adjustment form records it. */
function CreditsDialog({ onClose }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState({ status: 'idle', items: [] });
  const [member, setMember] = useState(null);
  const [done, setDone] = useState('');
  useEffect(() => {
    const needle = q.trim();
    if (needle.length < 2) { setFound({ status: 'idle', items: [] }); return undefined; }
    let live = true;
    setFound((f) => ({ ...f, status: 'loading' }));
    const t = setTimeout(() => {
      api.adminListUsers({ q: needle, limit: 8 }).then(
        (rows) => { if (live) setFound({ status: 'ready', items: Array.isArray(rows) ? rows : Array.isArray(rows?.items) ? rows.items : [] }); },
        (e) => { reportError('admin-programs:credits-search', e); if (live) setFound({ status: 'error', items: [] }); },
      );
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q]);
  return (
    <Lightbox label="Grant or deduct credits" title="Grant or deduct credits" eyebrow="Super Admin" onClose={onClose} testId="programs-credits-dialog"
      footer={done ? <DialogButtons onClose={onClose} done={done} testId="programs-credits" /> : null}>
      <div className={DIALOG_BODY}>
        {!member ? (
          <div className="flex flex-col gap-1.5">
            <span className={FIELD_LABEL}>Member</span>
            <input className={`${INPUT} w-full`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or email" aria-label="Search members" data-testid="programs-credits-search" />
            {found.status === 'loading' ? <span className={SUB}>Searching…</span> : null}
            {found.status === 'error' ? <p role="alert" className="m-0 text-[12.5px] font-semibold text-red-700 dark:text-red-300">The members could not be searched. Try again.</p> : null}
            {found.status === 'ready' && !found.items.length ? <span className={SUB}>No member matches.</span> : null}
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {found.items.map((u) => (
                <li key={u.id}>
                  <button type="button" onClick={() => setMember(u)} className="flex min-h-[44px] w-full flex-col items-start rounded-[9px] px-2.5 py-1.5 text-left hover:bg-axal-ground dark:hover:bg-gray-800" data-testid={`programs-credits-member-${u.id}`}>
                    <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{u.name || 'Name not recorded'}</span>
                    <span className={SUB}>{u.email || NOT_RECORDED}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <>
            <p className="m-0 flex flex-wrap items-center gap-2 text-[13px] font-semibold text-axal-ink dark:text-gray-100" data-testid="programs-credits-chosen">
              {member.name || member.email || NOT_RECORDED}
              {done ? null : <button type="button" className="text-[12px] font-bold text-axal-violet underline dark:text-violet-300" onClick={() => setMember(null)}>Change</button>}
            </p>
            {done ? null : <AdjustForm userId={member.id} onDone={() => setDone(CREDITS_DONE)} onCancel={onClose} />}
          </>
        )}
        <p className={`m-0 ${SUB}`} data-testid="programs-credits-foot">{CREDITS_FOOT}</p>
      </div>
    </Lightbox>
  );
}

export function PerksOverview({ reads, superAdmin }) {
  const now = Date.now();
  const [credits, setCredits] = useState(false);
  const live = livePerksFrom(reads.perks);
  const waiting = totalOf(reads.inReview);
  const oldest = isReady(reads.inReview) ? reads.inReview.data.items[0] : null;
  const oldestH = oldest ? hoursSince(oldest.updated_at || oldest.created_at, now) : null;
  const claims = perkClaimsFrom(reads.claims);
  const liveTile = live.state === 'ready'
    ? { key: 'live', label: 'Live perks', state: 'ready', value: live.text, cover: live.capped ? 'The catalogue read stops at 200 listings.' : null }
    : { key: 'live', label: 'Live perks', state: live.state, reason: 'The live perks could not be read. That is not the same as none.' };
  const waitTile = waiting !== null
    ? {
      key: 'waiting', label: 'Waiting for review', state: 'ready', value: nf(waiting),
      sub: waiting && oldestH !== null ? `oldest ${ageText(oldestH)} since last edit` : waiting ? null : NOTHING_WAITING,
      overdue: waiting > 0 && oldestH !== null && oldestH >= OVERDUE_HOURS,
    }
    : { key: 'waiting', label: 'Waiting for review', state: reads.inReview.status === 'loading' ? 'loading' : 'unreadable', reason: 'The review queue could not be read. That is not the same as none.' };
  const claimsTile = claims.state === 'ready'
    ? { key: 'claims', label: 'Claims', state: 'ready', value: claims.text, sub: PERK_WEEKS_LINE }
    : { key: 'claims', label: 'Claims', state: claims.state, reason: 'The claims could not be read. That is not the same as none.' };
  return (
    <div className="flex flex-col gap-4" data-testid="programs-perks-overview">
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <Tile t={liveTile} onRetry={reads.reload} />
        <Tile t={waitTile} onRetry={reads.reload} />
        <Tile t={claimsTile} onRetry={reads.reload} />
        <Tile t={{ key: 'credits', label: 'Credits held by members', state: 'placeholder', word: NOT_READ_YET, reason: superAdmin ? CREDITS_HELD_WAITS : HQ_READS_MONEY }} />
      </div>
      <div className="grid gap-3.5 lg:grid-cols-2">
        <ChartCard title="Top perks by claims" testId="programs-perks-top" onRetry={reads.reload}
          b={claims.state === 'ready' ? { state: 'ready', chart: claims.top.empty ? null : claims.top.chart, alt: claims.top.alt, window: PERK_WEEKS_LINE } : { state: claims.state, what: 'The claims' }}>
          {claims.state === 'ready' && claims.top.empty ? <p className={`m-0 ${SUB}`}>No perk was claimed in this window.</p> : null}
        </ChartCard>
        <ChartCard title="Claims per week by price type" testId="programs-perks-weekly" onRetry={reads.reload}
          b={claims.state === 'ready' ? { state: 'ready', chart: claims.weekly.chart, alt: claims.weekly.alt, legend: claims.legend, window: PERK_WEEKS_LINE } : { state: claims.state, what: 'The claims' }} />
      </div>
      {superAdmin ? (
        <Card title="Grant or deduct credits" meta="Super Admin" testId="programs-perks-credits">
          <p className={`m-0 ${SUB}`}>A manual grant or deduction, with a reason kept in the audit log.</p>
          <button type="button" className={`${actionPrimary} self-start`} onClick={() => setCredits(true)} data-testid="programs-perks-credits-open">Grant or deduct credits</button>
          {credits ? <CreditsDialog onClose={() => setCredits(false)} /> : null}
        </Card>
      ) : (
        <Card title="Credits" testId="programs-perks-credits-locked">
          <p className={`m-0 ${SUB}`}>A Super Admin grants credits.</p>
        </Card>
      )}
    </div>
  );
}

/** Item 16: one action on one listing, said before it is done. */
function ListingDialog({ action, row, onClose, onDone }) {
  const d = listingDialog(action, row);
  const [note, setNote] = useState('');
  const [editorial, setEditorial] = useState(row.editorial_note || '');
  const [featured, setFeatured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState('');
  const [done, setDone] = useState('');
  const needsNote = d.note === 'required' && !note.trim();
  const go = async () => {
    setBusy(true);
    setRefusal('');
    try {
      await api.perkReview(row.uid, listingBody(action, row, { note, editorial, featured }));
      setDone(LISTING_DONE[action]);
      onDone?.();
    } catch (e) {
      setRefusal(refusalSentence(e, 'That review did not save. Nothing changed.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Lightbox label={d.title} title={d.title} sub={`${row.partner_name || 'Partner not recorded'} · ${perkPrice(row, tierName)}`} onClose={onClose} testId="programs-listing-dialog"
      footer={<DialogButtons onClose={onClose} action={d.button} tone={d.danger ? 'danger' : 'primary'} busy={busy} disabled={needsNote} onAction={go} refusal={refusal} done={done} testId="programs-listing-go" />}>
      <div className={DIALOG_BODY}>
        <ul className={DIALOG_LINES} data-testid="programs-listing-lines">{d.lines.map((l) => <li key={l}>{l}</li>)}</ul>
        {row.review_note && action === 'approve' ? <p className={`m-0 ${SUB}`} data-testid="programs-listing-stored">{`Stored note, kept unless you write one: ${row.review_note}`}</p> : null}
        {d.note ? (
          <Field label={d.note === 'required' ? 'Reason · the partner sees it · required' : 'Note · optional'} value={note} onChange={setNote} max={1000} rows={3} testId="programs-listing-note" />
        ) : null}
        {d.feature ? (
          <label className="flex items-center gap-2 text-[12.5px] text-axal-ink dark:text-gray-100">
            <input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} data-testid="programs-listing-feature" />
            Also feature it in “Featured this month”
          </label>
        ) : null}
        {d.editorial || (d.feature && featured) ? (
          <Field label="Editorial line, shown while featured" value={editorial} onChange={setEditorial} max={500} testId="programs-listing-editorial" />
        ) : null}
      </div>
    </Lightbox>
  );
}

function paged(reply) {
  if (!Array.isArray(reply?.items) || !Number.isFinite(Number(reply?.total))) throw new Error('The listings did not come back with a total.');
  return reply;
}

/** The Queue (item 16): every state, paged with its total; each row's actions are dialogs. */
export function PerksQueue({ reads }) {
  const phone = usePhoneWidth();
  const [status, setStatus] = useState('in_review');
  const [sort, setSort] = useState('oldest');
  const [page, setPage] = useState(0);
  const [tick, setTick] = useState(0);
  const [dialog, setDialog] = useState(null);
  const params = { status, sort, limit: PAGE_SIZE, offset: page * PAGE_SIZE };
  const list = useRead('perks:queue', JSON.stringify(params), tick, true, () => api.adminPerkListings(params).then(paged));
  const reload = () => { setTick((t) => t + 1); reads.reload(); };
  const rows = isReady(list) ? list.data.items : [];
  const total = isReady(list) ? Number(list.data.total) : null;
  const pages = total === null ? 1 : Math.max(1, Math.ceil(total / PAGE_SIZE));
  const buttons = (row) => listingActions(row).map((a) => (
    <button key={a} type="button" onClick={() => setDialog({ action: a, row })} data-testid={`programs-perks-row-${row.uid}-${a}`}
      className="min-h-[36px] rounded-[9px] border border-axal-hairline px-2.5 text-[12px] font-bold text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800">
      {ACTION_WORD[a]}
    </button>
  ));
  return (
    <Card title="Review queue" meta={total !== null ? `${nf(total)} ${listingWord(status).toLowerCase()}` : null} testId="programs-perks-queue">
      <div className="flex flex-wrap items-center gap-2">
        <select className={INPUT} value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} aria-label="Status" data-testid="programs-perks-status">
          {LISTING_STATUSES.map((x) => <option key={x} value={x}>{`Status: ${listingWord(x)}`}</option>)}
        </select>
        <select className={INPUT} value={sort} onChange={(e) => { setSort(e.target.value); setPage(0); }} aria-label="Sort" data-testid="programs-perks-sort">
          <option value="oldest">Sort: Waiting longest</option>
          <option value="newest">Sort: Newest</option>
        </select>
      </div>
      {list.status === 'loading' ? <Skeleton lines={3} /> : null}
      {list.status === 'error' ? <BlockFailed what="The listings" onRetry={reload} testId="programs-perks-queue-unreadable" /> : null}
      {isReady(list) ? <p className="m-0 font-mono text-[12px] font-semibold text-axal-muted dark:text-gray-400" data-testid="programs-perks-count">{countLine(page * PAGE_SIZE, rows.length, total)}</p> : null}
      {isReady(list) && !rows.length ? (
        <div className="flex flex-col gap-1" data-testid="programs-perks-queue-empty">
          <span className="text-[14px] font-bold text-axal-ink dark:text-gray-100">{status === 'in_review' ? NOTHING_WAITING : 'No listing is in this state.'}</span>
          {status === 'in_review' ? <span className={SUB}>{PERKS_EMPTY}</span> : null}
        </div>
      ) : null}
      {rows.length && phone ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {rows.map((row) => (
            <li key={row.uid} className={`${CARD} flex flex-col gap-1.5 px-4 py-3`} data-testid={`programs-perks-row-${row.uid}`}>
              <span className="text-[13.5px] font-bold text-axal-ink dark:text-gray-100">{row.offer}</span>
              <span className={SUB}>{`${row.partner_name || 'Partner not recorded'} · ${perkPrice(row, tierName)}`}</span>
              <span className="flex flex-wrap items-center gap-1.5"><Pill tone={STATUS_TONE[row.status] || 'muted'}>{listingWord(row.status)}</Pill>{buttons(row)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {rows.length && !phone ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-[12.5px] text-axal-ink dark:text-gray-100">
            <thead>
              <tr className="border-b border-axal-hairline dark:border-gray-700">
                {['Perk', 'Partner', 'Price', 'Sent', 'Status', ''].map((h) => <th key={h || 'actions'} className={TH}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.uid} className="border-b border-axal-hairline last:border-0 dark:border-gray-800" data-testid={`programs-perks-row-${row.uid}`}>
                  <td className={`${TD} font-bold`}>{row.offer}{Number(row.featured) ? <span className={`block ${SUB}`}>Featured</span> : null}</td>
                  <td className={TD}>{row.partner_name || 'Partner not recorded'}</td>
                  <td className={TD} data-testid={`programs-perks-row-${row.uid}-price`}>{perkPrice(row, tierName)}</td>
                  <td className={`${TD} font-mono`} data-testid={`programs-perks-row-${row.uid}-age`}>{shortDay(row.updated_at || row.created_at) || NOT_RECORDED}</td>
                  <td className={TD}><Pill tone={STATUS_TONE[row.status] || 'muted'}>{listingWord(row.status)}</Pill></td>
                  <td className={`${TD} text-right`}><span className="inline-flex flex-wrap justify-end gap-1.5">{buttons(row)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {pages > 1 ? (
        <div className="flex items-center justify-end gap-2 text-[12px]">
          <button type="button" className="rounded-[9px] border border-axal-hairline px-2.5 py-1 font-semibold disabled:opacity-50 dark:border-gray-700" disabled={page <= 0} onClick={() => setPage(page - 1)}>Previous</button>
          <span className={SUB}>{`Page ${page + 1} of ${pages}`}</span>
          <button type="button" className="rounded-[9px] border border-axal-hairline px-2.5 py-1 font-semibold disabled:opacity-50 dark:border-gray-700" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} data-testid="programs-perks-next">Next</button>
        </div>
      ) : null}
      <p className={`m-0 ${SUB}`}>A rejection is final. A featured perk carries one editorial line. A listing waits from its last edit.</p>
      {dialog ? <ListingDialog action={dialog.action} row={dialog.row} onClose={() => setDialog(null)} onDone={reload} /> : null}
    </Card>
  );
}
