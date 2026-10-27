import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { approvalBoardsApi } from '../../../lib/api/approvalBoards';
import { safeExternalUrl } from '../../../lib/url';
import { AdminPageHeader, HeaderTab, Skeleton } from '../../../ui';
import { BandPill } from './AdminApprovals';
import {
  BOARDS, PITCH_TABS, assetWord, dayText, decisionCopy, doneLine, hoursSince, ageText, pitchRows, publishUrlOk, reasonReady, tabPath,
} from './approvalsModel';
import {
  BTN, BTN_PRIMARY, CARD, DecisionDialog, FOOT, PhoneBack, DialogField, DoneLine, EYE, Fact, Failed, Figure, H2, LINK, MONO, PAGE, PILL, Pager, SUB,
  TD, TH, Tile, nf, useLoad,
} from './boardParts';
import Sheet from '../../../ui/Sheet.jsx';

/**
 * D1046 (#2894) — Co-marketing pitches (APR6, APR7), on part 5's paged queue
 * (D1043) and the one-pitch read (D1132): five tabs at sub-paths, the tiles
 * over 30 days, the pitch at `/admin/approvals/co-marketing/<uid>`, and the
 * Approve, Decline and Publish dialogs on `requireAdmin`'s routes, each of
 * which tells the partner. Co-marketing's own Review queue tab is retired
 * into this board.
 */

const CRUMB = { to: '/admin/approvals', label: 'Approvals', current: 'Co-marketing pitches' };
const NEW_PILL = { label: 'New lane', tone: 'held' };

const partnerOf = (p) => p?.partner_company || p?.partner_name || 'The partner';

/** Each state's first page, read alone: its rows, its total and the queue's 30-day attribution. */
function useStates() {
  const read = (key) => () => approvalBoardsApi.pitches(key, { limit: PAGE, offset: 0 });
  const proposed = useLoad(read('proposed'), 'pitches-proposed', { what: 'approvals:comarketing:proposed' });
  const approved = useLoad(read('approved'), 'pitches-approved', { what: 'approvals:comarketing:approved' });
  const published = useLoad(read('published'), 'pitches-published', { what: 'approvals:comarketing:published' });
  const rejected = useLoad(read('rejected'), 'pitches-rejected', { what: 'approvals:comarketing:rejected' });
  const withdrawn = useLoad(read('withdrawn'), 'pitches-withdrawn', { what: 'approvals:comarketing:withdrawn' });
  return { proposed, approved, published, rejected, withdrawn };
}

/** The oldest approval still to publish, when every approved pitch is on the page; else null. */
export function oldestApproved(reply, now = Date.now()) {
  const items = Array.isArray(reply?.items) ? reply.items : [];
  if (!items.length || items.length < Number(reply?.total || 0)) return null;
  const hrs = Math.max(...items.map((p) => hoursSince(p.reviewed_at, now) ?? -1));
  return hrs >= 0 ? ageText(hrs) : null;
}

function PitchDialog({ kind, pitch, onClose, onDone }) {
  const [notes, setNotes] = useState('');
  const [url, setUrl] = useState('');
  const key = `pitch_${kind}`;
  const partner = partnerOf(pitch);
  const copy = decisionCopy(key, { partner });
  const titleOf = pitch.title || 'This pitch';
  const send = async () => {
    await approvalBoardsApi.decidePitch(pitch.uid, kind, { notes: notes.trim(), publishedUrl: url.trim() });
    onDone(doneLine(key, titleOf));
  };
  const ready = kind === 'reject' ? reasonReady('pitch_reject', notes) : kind === 'publish' ? publishUrlOk(url) : true;
  return (
    <DecisionDialog copy={copy} testId={`pitch-dialog-${kind}`} onClose={onClose} onSend={send} ready={ready} danger={kind === 'reject'}>
      {kind === 'publish' ? (
        <>
          <DialogField label="Published link · required · an https address" value={url} onChange={setUrl} testId="pitch-dialog-url" placeholder="https://…" rows={1} mono />
          {url.trim() && !publishUrlOk(url) ? <p className={`m-0 ${SUB}`} data-testid="pitch-dialog-url-bad">Use a complete https address, up to 500 characters.</p> : null}
        </>
      ) : null}
      <DialogField
        label={kind === 'reject' ? 'Reason · required · at least 10 characters · they see this' : kind === 'approve' ? 'Note to the partner · optional · they see it' : 'Note · optional · the partner sees it'}
        value={notes} onChange={setNotes} testId="pitch-dialog-notes" placeholder={kind === 'reject' ? 'Write a reason…' : 'Write a note…'} />
    </DecisionDialog>
  );
}

const STATE_WORD = { proposed: 'Proposed', approved: 'Approved, to publish', published: 'Published', rejected: 'Declined', withdrawn: 'Withdrawn' };

/** One pitch at its own address (APR6d), over the board. */
function PitchDrawer({ uid, onClose, onDecided }) {
  const read = useLoad(() => approvalBoardsApi.pitch(uid), `pitch-${uid}`, { what: 'approvals:pitch' });
  const [dialog, setDialog] = useState(null);
  const p = read.reply;
  const ready = read.status === 'ready' && p;
  const done = (line) => { setDialog(null); read.reload(); onDecided(line); };
  const decidedWord = p?.decided ? `${p.decided.status === 'rejected' ? 'Declined' : STATE_WORD[p.decided.status] || 'Decided'} by ${p.decided.by?.name || 'an admin'}` : null;
  return (
    <>
      <Sheet label={ready ? `${p.title}, co-marketing pitch` : 'Co-marketing pitch'} eyebrow={ready ? `Co-marketing pitch · ${STATE_WORD[p.status] || p.status}` : 'Co-marketing pitch'}
        title={ready ? (p.title || 'Untitled pitch') : 'Co-marketing pitch'} sub={ready ? 'Esc to close' : null} onClose={onClose} testId="pitch-drawer" width={600}
        footer={ready && (p.status === 'proposed' || p.status === 'approved') ? (
          <div className={`${FOOT} flex-wrap items-center`}>
            {p.status === 'proposed' ? (
              <>
                <button type="button" className={BTN} onClick={() => setDialog('reject')} data-testid="pitch-action-reject">Decline…</button>
                <button type="button" className={BTN_PRIMARY} onClick={() => setDialog('approve')} data-testid="pitch-action-approve">Approve…</button>
              </>
            ) : <button type="button" className={BTN_PRIMARY} onClick={() => setDialog('publish')} data-testid="pitch-action-publish">Publish…</button>}
          </div>
        ) : null}>
        <div className="flex flex-col gap-4 px-5 py-4" data-testid="pitch-drawer-content">
          <PhoneBack label="Co-marketing" onClose={onClose} testId="pitch-drawer-back" />
          {read.status === 'loading' ? <Skeleton.Text lines={5} /> : null}
          {read.status === 'error' ? (
            read.error?.status === 404
              ? <p className={`m-0 ${SUB}`} data-testid="pitch-drawer-missing">That pitch does not exist.</p>
              : <Failed what="This pitch" onRetry={read.reload} testId="pitch-drawer-failed" />
          ) : null}
          {ready ? (
            <>
              <div className="flex flex-wrap items-center gap-1.5"><span className={PILL}>{assetWord(p.asset_type)}</span><span className={`${SUB} ${MONO}`}>{partnerOf(p)}</span></div>
              <section className="flex flex-col gap-1"><h3 className={H2}>Summary</h3><p className="m-0 whitespace-pre-wrap text-[13px] text-axal-ink dark:text-gray-100">{p.summary || 'Not recorded'}</p></section>
              <dl className="m-0 grid grid-cols-2 gap-3">
                <Fact k="Angle" v={p.angle} testId="pitch-fact-angle" />
                <Fact k="What they bring" v={p.what_you_bring} testId="pitch-fact-bring" />
                <Fact k="Channels" v={p.distribution_channels} />
                <Fact k="Proposed date" v={dayText(p.proposed_date) || 'No date'} />
                <Fact k="Audience" v={p.target_audience} />
                <Fact k="Co-branding notes" v={p.co_branding_notes} />
              </dl>
              <section className="flex flex-col gap-1">
                <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100">Asset link{p.asset_url
                  ? <> · <a className={LINK} href={safeExternalUrl(p.asset_url)} target="_blank" rel="noreferrer" data-testid="pitch-asset">Open</a></>
                  : <span className={SUB}> · not given</span>}</p>
                <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100" data-testid="pitch-code">{p.attribution_code ? <>Attribution code <span className={MONO}>{p.attribution_code}</span></> : 'Attribution code: issued on approval.'}</p>
                {p.published_url ? <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100">Published at <a className={LINK} href={safeExternalUrl(p.published_url)} target="_blank" rel="noreferrer">{p.published_url}</a></p> : null}
                {p.attribution ? <p className={`m-0 ${SUB} ${MONO}`}>{`All time: ${nf(p.attribution.visit || 0)} visits · ${nf(p.attribution.signup || 0)} sign-ups · ${nf(p.attribution.lead || 0)} leads · ${nf(p.attribution.conversion || 0)} conversions`}</p> : null}
              </section>
              {p.review_notes ? <p className="m-0 whitespace-pre-wrap text-[13px] text-axal-ink dark:text-gray-100" data-testid="pitch-review-notes"><span className={EYE}>What the partner was told · </span>{p.review_notes}</p> : null}
              <section className="flex flex-col gap-1.5" data-testid="pitch-history">
                <h3 className={H2}>History</h3>
                <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100">{`Proposed by ${partnerOf(p)} · ${dayText(p.created_at) || 'date not recorded'}`}</p>
                {decidedWord ? <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100" data-testid="pitch-decided">{`${decidedWord} · ${dayText(p.decided.at) || 'date not recorded'}`}</p> : null}
              </section>
            </>
          ) : null}
        </div>
      </Sheet>
      {dialog && ready ? <PitchDialog kind={dialog} pitch={p} onClose={() => setDialog(null)} onDone={done} /> : null}
    </>
  );
}

function PitchTable({ tab, items, from, onPublish }) {
  const rows = pitchRows(items);
  const byUid = Object.fromEntries((items || []).map((p) => [p.uid, p]));
  const open = (r) => <Link className={LINK} to={`/admin/approvals/co-marketing/${encodeURIComponent(r.key)}`} state={{ from }} data-testid={`pitch-open-${r.key}`}>Open</Link>;
  const head = (cols) => <thead><tr className="border-b border-axal-hairline dark:border-gray-700">{cols.map((c) => <th key={c} className={TH}>{c}</th>)}<th className={TH}><span className="sr-only">Open</span></th></tr></thead>;
  const r30 = (r, k) => <span className={MONO}>{nf(byUid[r.key]?.attribution_30d?.[k] || 0)}</span>;
  if (tab === 'approved') {
    return (
      <table className="w-full min-w-[820px]">
        {head(['Pitch', 'Partner', 'Attribution code', 'Visits, 30 days', 'Approved'])}
        <tbody>{rows.map((r) => (
          <tr key={r.key} className="border-b border-axal-hairline last:border-0 dark:border-gray-700" data-testid={`pitch-${r.key}`}>
            <td className={TD}><b>{r.title}</b><span className={PILL}>{r.type}</span></td>
            <td className={TD}>{r.partner}</td>
            <td className={`${TD} ${MONO}`}>{r.code || 'Not recorded'}</td>
            <td className={TD}>{r30(r, 'visit')}</td>
            <td className={`${TD} ${MONO}`}>{dayText(byUid[r.key]?.reviewed_at) || 'Not recorded'}</td>
            <td className={TD}><span className="flex gap-3">{open(r)}<button type="button" className={LINK} onClick={() => onPublish(byUid[r.key])} data-testid={`pitch-publish-${r.key}`}>Publish…</button></span></td>
          </tr>
        ))}</tbody>
      </table>
    );
  }
  if (tab === 'published') {
    return (
      <table className="w-full min-w-[820px]">
        {head(['Pitch', 'Partner', 'Visits', 'Sign-ups', 'Leads', 'Conversions'])}
        <tbody>{rows.map((r) => (
          <tr key={r.key} className="border-b border-axal-hairline last:border-0 dark:border-gray-700" data-testid={`pitch-${r.key}`}>
            <td className={TD}><b>{r.title}</b><span className={PILL}>{r.type}</span></td>
            <td className={TD}>{r.partner}</td>
            <td className={TD}>{r30(r, 'visit')}</td><td className={TD}>{r30(r, 'signup')}</td><td className={TD}>{r30(r, 'lead')}</td><td className={TD}>{r30(r, 'conversion')}</td>
            <td className={TD}>{open(r)}</td>
          </tr>
        ))}</tbody>
      </table>
    );
  }
  if (tab === 'proposed') {
    return (
      <table className="w-full min-w-[820px]">
        {head(['Waiting', 'Pitch', 'Partner', 'Proposed date', 'Audience'])}
        <tbody>{rows.map((r) => (
          <tr key={r.key} className="border-b border-axal-hairline last:border-0 dark:border-gray-700" data-testid={`pitch-${r.key}`}>
            <td className={TD}><span className={MONO}>{r.age || 'Age not recorded'}</span><BandPill band={r.band} /></td>
            <td className={TD}><b>{r.title}</b><span className={PILL}>{r.type}</span></td>
            <td className={TD}>{r.partner}{r.submitter ? <div className={SUB}>{r.submitter}</div> : null}</td>
            <td className={`${TD} ${MONO}`}>{r.date}</td>
            <td className={TD}>{r.audience}</td>
            <td className={TD}>{open(r)}</td>
          </tr>
        ))}</tbody>
      </table>
    );
  }
  return (
    <table className="w-full min-w-[720px]">
      {head(['Pitch', 'Partner', tab === 'rejected' ? 'Declined' : 'Updated', tab === 'rejected' ? 'Reason they were told' : 'Audience'])}
      <tbody>{rows.map((r) => (
        <tr key={r.key} className="border-b border-axal-hairline last:border-0 dark:border-gray-700" data-testid={`pitch-${r.key}`}>
          <td className={TD}><b>{r.title}</b><span className={PILL}>{r.type}</span></td>
          <td className={TD}>{r.partner}</td>
          <td className={`${TD} ${MONO}`}>{dayText(tab === 'rejected' ? byUid[r.key]?.reviewed_at : byUid[r.key]?.updated_at) || 'Not recorded'}</td>
          <td className={TD}>{tab === 'rejected' ? (byUid[r.key]?.review_notes || <span className={SUB}>Not recorded</span>) : r.audience}</td>
          <td className={TD}>{open(r)}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

export default function PitchBoard({ at }) {
  const b = BOARDS['co-marketing'];
  const loc = useLocation();
  const navigate = useNavigate();
  const states = useStates();
  const [page, setPage] = useState(0);
  const [done, setDone] = useState(null);
  const [publish, setPublish] = useState(null);
  const tab = PITCH_TABS.find((t) => t.key === at.tab) || PITCH_TABS[0];
  const paged = useLoad(() => approvalBoardsApi.pitches(tab.key, { limit: PAGE, offset: page * PAGE }), `pitches-${tab.key}-${page}`, { enabled: page > 0, what: 'approvals:comarketing:page' });
  const read = page > 0 ? paged : states[tab.key];
  const from = at.item ? (loc.state?.from || tabPath('co-marketing', 'proposed')) : loc.pathname;
  const count = (k) => {
    const r = states[k];
    return r.status === 'loading' ? { kind: 'load' } : r.status === 'error' ? { kind: 'dash', tip: 'This list could not be read.' } : { kind: 'num', value: nf(r.reply?.total ?? 0) };
  };
  // Literal paths, so the reachability walk finds every tab.
  const tabs = (
    <>
      <HeaderTab to="/admin/approvals/co-marketing" count={count('proposed')} data-testid="pitches-tab-proposed">Proposed</HeaderTab>
      <HeaderTab to="/admin/approvals/co-marketing/approved" count={count('approved')} data-testid="pitches-tab-approved">Approved, to publish</HeaderTab>
      <HeaderTab to="/admin/approvals/co-marketing/published" count={count('published')} data-testid="pitches-tab-published">Published</HeaderTab>
      <HeaderTab to="/admin/approvals/co-marketing/declined" count={count('rejected')} data-testid="pitches-tab-rejected">Declined</HeaderTab>
      <HeaderTab to="/admin/approvals/co-marketing/withdrawn" count={count('withdrawn')} data-testid="pitches-tab-withdrawn">Withdrawn</HeaderTab>
    </>
  );
  const pub = states.published;
  const recent = pub.status === 'ready' ? pub.reply?.attribution_30d : null;
  const reload = () => { for (const t of PITCH_TABS) states[t.key].reload(); if (page > 0) paged.reload(); };
  const decided = (line) => { setDone(line); setPublish(null); reload(); };
  return (
    <div className="flex flex-col gap-5" data-testid="approvals-board-co-marketing">
      <AdminPageHeader crumb={CRUMB} title={b.title} pills={[NEW_PILL]} line={b.line} scope tabs={tabs} data-testid="approvals-board-header" />
      <DoneLine text={done} onDismiss={() => setDone(null)} />
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <Tile label="Waiting" testId="pitches-tile-waiting"><Figure status={states.proposed.status} value={states.proposed.reply?.total} /></Tile>
        <Tile label="Approved, not yet published" testId="pitches-tile-approved" sub={oldestApproved(states.approved.reply) ? `oldest ${oldestApproved(states.approved.reply)}` : null}>
          <Figure status={states.approved.status} value={states.approved.reply?.total} />
        </Tile>
        <Tile label="Visits from published pitches, 30 days" testId="pitches-tile-visits"><Figure status={pub.status} value={recent ? recent.visit || 0 : null} /></Tile>
        <Tile label="Sign-ups" sub="from published pitches, 30 days" testId="pitches-tile-signups"><Figure status={pub.status} value={recent ? recent.signup || 0 : null} /></Tile>
      </div>
      {read.status === 'error' ? <Failed what="These pitches" onRetry={read.reload} testId="pitches-failed" />
        : read.status === 'loading' ? <Skeleton.Text lines={4} />
          : (read.reply?.items || []).length ? (
            <section className={`${CARD} flex flex-col`} data-testid="pitches-table">
              <div className="overflow-x-auto"><PitchTable tab={tab.key} items={read.reply.items} from={from} onPublish={setPublish} /></div>
              <Pager page={page} total={Number(read.reply.total || 0)} onPage={setPage} testId="pitches-pager" />
            </section>
          ) : <p className={`m-0 ${SUB}`} data-testid="pitches-empty">No pitch is in this state.</p>}
      {publish ? <PitchDialog kind="publish" pitch={publish} onClose={() => setPublish(null)} onDone={decided} /> : null}
      {at.item ? <PitchDrawer uid={at.item} onClose={() => navigate(from)} onDecided={decided} /> : null}
    </div>
  );
}
