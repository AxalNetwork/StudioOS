import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../../lib/api';
import { approvalBoardsApi } from '../../../lib/api/approvalBoards';
import { safeExternalUrl } from '../../../lib/url';
import { AdminPageHeader, HeaderTab, Lightbox, Skeleton } from '../../../ui';
import { BandPill } from './AdminApprovals';
import { BOARDS, EXPERT_TABS, dayText, decisionCopy, doneLine, expertBoard, expertState, reasonReady, tabPath } from './approvalsModel';
import {
  BTN, BTN_PRIMARY, CARD, DecisionDialog, DialogField, DoneLine, EYE, Fact, Failed, Figure, H2, LINK, MONO, PAGE, PILL, Pager, SUB,
  TD, TH, Tile, WARN_PILL, nf, useLoad,
} from './boardParts';

/**
 * D1046 (#2894) — Wellbeing experts (APR8), on part 5's review read (D1043):
 * five tabs at sub-paths (Declined is part 5's state), the tiles, the
 * credentials column, the expert at `/admin/approvals/wellbeing-experts/<uid>`,
 * and the Verify (with "I checked their credentials"), Decline and Hide
 * dialogs, with Restore and Remove verification so nothing the roster's
 * toggles did is lost when /admin/wellbeing stops deciding.
 */

const CRUMB = { to: '/admin/approvals', label: 'Approvals', current: 'Wellbeing experts' };
const NEW_PILL = { label: 'New lane', tone: 'held' };
export const EXPERT_READ_PAGES = 5;

/** Every expert on the review read, two hundred a page, up to a thousand. */
export async function readAllExperts(client = approvalBoardsApi) {
  let items = [];
  let total = null;
  for (let page = 0; page < EXPERT_READ_PAGES; page += 1) {
    const reply = await client.experts({ state: 'all', limit: 200, offset: page * 200 });
    const got = Array.isArray(reply?.items) ? reply.items : [];
    items = items.concat(got);
    total = Number.isFinite(Number(reply?.total)) ? Number(reply.total) : null;
    if (total === null || items.length >= total || !got.length) break;
  }
  return { items, total };
}

const today = () => new Date().toISOString().slice(0, 10);
const expiredOn = (c) => (c?.expires_on && c.expires_on < today() ? c.expires_on : null);

function ExpertDialog({ kind, expert, onClose, onDone }) {
  const [checked, setChecked] = useState(false);
  const [reason, setReason] = useState('');
  const key = `expert_${kind}`;
  const name = expert.name || 'This expert';
  const copy = decisionCopy(key, { who: name, version: expert.review_version });
  const send = async () => {
    if (kind === 'verify') await approvalBoardsApi.verifyExpert(expert.uid, true, expert.review_version);
    else if (kind === 'unverify') await approvalBoardsApi.verifyExpert(expert.uid, false);
    else if (kind === 'decline') await approvalBoardsApi.declineExpert(expert.uid, reason.trim());
    else if (kind === 'hide') await approvalBoardsApi.hideExpert(expert.uid, true);
    else if (kind === 'restore') await approvalBoardsApi.hideExpert(expert.uid, false);
    onDone(doneLine(key, name));
  };
  const blocked = kind === 'verify' && expiredOn(expert.credentials) ? 'The recorded credential has expired. Ask the expert to update it.' : null;
  const ready = kind === 'verify' ? checked : kind === 'decline' ? reasonReady('expert_decline', reason) : true;
  return (
    <DecisionDialog copy={copy} testId={`expert-dialog-${kind}`} onClose={onClose} onSend={send} ready={ready} blocked={blocked} danger={kind === 'decline' || kind === 'hide' || kind === 'unverify'}>
      {kind === 'verify' ? (
        <label className="flex items-start gap-2 text-[13px] font-semibold text-axal-ink dark:text-gray-100">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(!!e.target.checked)} data-testid="expert-dialog-checked" />
          <span>I checked their credentials. <span className={SUB}>Required</span></span>
        </label>
      ) : null}
      {kind === 'decline' ? <DialogField label="Reason · required · at least 10 characters · they see this" value={reason} onChange={setReason} testId="expert-dialog-reason" placeholder="Write a reason…" /> : null}
    </DecisionDialog>
  );
}

const ACTIONS = {
  verify: ['hide', 'decline', 'verify'],
  incomplete: ['hide', 'decline', 'verify'],
  verified: ['hide', 'unverify'],
  declined: ['hide'],
  hidden: ['restore'],
};
const ACTION_LABEL = { hide: 'Hide from the directory…', decline: 'Decline…', verify: 'Verify…', unverify: 'Remove verification…', restore: 'Restore to the directory…' };
const DECISION_WORD = { verified: 'Verified', unverified: 'Verification removed', declined: 'Declined', hidden: 'Hidden', restored: 'Restored' };
const STATE_EYEBROW = { verify: 'To verify', incomplete: 'Profile incomplete', verified: 'Verified', declined: 'Declined', hidden: 'Hidden' };

/** One expert at their own address (APR8d), over the board. */
function ExpertDrawer({ uid, onClose, onDecided }) {
  const read = useLoad(() => approvalBoardsApi.expert(uid), `expert-${uid}`, { what: 'approvals:expert' });
  const profile = useLoad(() => api.wellbeingExpertGet(uid), `expert-profile-${uid}`, { what: 'approvals:expert:profile' });
  const [dialog, setDialog] = useState(null);
  const e = read.reply?.expert;
  const ready = read.status === 'ready' && e;
  const state = ready ? expertState(e) : null;
  const pro = profile.status === 'ready' ? profile.reply : null;
  const done = (line) => { setDialog(null); read.reload(); onDecided(line); };
  const c = e?.credentials || {};
  const licence = c.licence_number
    ? `Licence number ${c.licence_number}${c.issuer ? ` · issued by ${c.issuer}` : ''}${c.expires_on ? ` · expires ${dayText(c.expires_on)}` : ''}`
    : null;
  return (
    <>
      <Lightbox label={ready ? `${e.name}, wellbeing expert` : 'Wellbeing expert'} eyebrow={ready ? `Wellbeing expert · ${STATE_EYEBROW[state] || 'Expert'}` : 'Wellbeing expert'}
        title={ready ? (e.name || 'Name not recorded') : 'Wellbeing expert'} sub={ready ? (e.headline || 'Esc to close') : null} onClose={onClose} testId="expert-drawer" width={600}
        footer={ready && ACTIONS[state] ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {ACTIONS[state].map((a) => (
              <button key={a} type="button" className={a === 'verify' || a === 'restore' ? BTN_PRIMARY : BTN} onClick={() => setDialog(a)} data-testid={`expert-action-${a}`}>{ACTION_LABEL[a]}</button>
            ))}
          </div>
        ) : null}>
        <div className="flex flex-col gap-4 px-5 py-4" data-testid="expert-drawer-content">
          {read.status === 'loading' ? <Skeleton.Text lines={5} /> : null}
          {read.status === 'error' ? (
            read.error?.status === 404
              ? <p className={`m-0 ${SUB}`} data-testid="expert-drawer-missing">That expert is not on this board.</p>
              : <Failed what="This expert" onRetry={read.reload} testId="expert-drawer-failed" />
          ) : null}
          {ready ? (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                {e.profile_completion_pct != null ? <span className={PILL}>{`${Math.round(e.profile_completion_pct)}% complete`}</span> : null}
                {(pro?.categories || []).map((cat) => <span key={cat} className={PILL}>{cat}</span>)}
              </div>
              <section className="flex flex-col gap-1"><h3 className={H2}>Bio</h3><p className="m-0 whitespace-pre-wrap text-[13px] text-axal-ink dark:text-gray-100">{e.bio || 'Not recorded'}</p></section>
              {profile.status === 'error' && profile.error?.status === 404 ? <p className={`m-0 ${SUB}`} data-testid="expert-profile-none">No active directory profile, so languages, pricing and links are not shown.</p>
                : profile.status === 'error' ? <Failed what="Their directory profile" onRetry={profile.reload} testId="expert-profile-failed" />
                : profile.status === 'loading' ? <Skeleton.Text lines={2} /> : (
                  <dl className="m-0 grid grid-cols-2 gap-3" data-testid="expert-profile">
                    <Fact k="Languages" v={(pro?.languages || []).join(', ')} />
                    <Fact k="Time zones" v={(pro?.timezones || []).join(', ')} />
                    <Fact k="Pricing" v={pro?.first_session_free ? 'Free first session' : Number(pro?.hourly_rate_usd) > 0 ? `$${nf(Number(pro.hourly_rate_usd))} an hour` : null} />
                    <Fact k="Booking link" v={pro?.booking_url || pro?.calendly_url ? <a className={LINK} href={safeExternalUrl(pro.booking_url || pro.calendly_url)} target="_blank" rel="noreferrer">Open</a> : null} />
                    <Fact k="Website" v={pro?.website_url ? <a className={LINK} href={safeExternalUrl(pro.website_url)} target="_blank" rel="noreferrer">{pro.website_url}</a> : null} />
                  </dl>
                )}
              <section className="flex flex-col gap-1.5" data-testid="expert-credentials">
                <h3 className={H2}>Credentials</h3>
                {licence ? <p className={`m-0 text-[12.5px] text-axal-ink dark:text-gray-100 ${MONO}`}>{licence}</p> : <p className={`m-0 ${SUB}`}>No licence recorded.</p>}
                {expiredOn(c) ? <p className="m-0 text-[12.5px] font-semibold text-axal-destructive dark:text-red-300" data-testid="expert-expired">{`This credential expired on ${dayText(c.expires_on)}.`}</p> : null}
                {(c.files || []).length ? c.files.map((f) => (
                  <p key={f.uid} className="m-0 flex items-center gap-2 text-[13px] text-axal-ink dark:text-gray-100"><span aria-hidden="true">▤</span>{f.file_name || 'A file'}
                    <a className={LINK} href={f.url} target="_blank" rel="noreferrer" data-testid={`expert-file-${f.uid}`}>Open</a></p>
                )) : <p className={`m-0 ${SUB}`}>No credential file given.</p>}
              </section>
              {e.decline_reason ? <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100" data-testid="expert-decline-reason"><span className={EYE}>What they were told · </span>{e.decline_reason}</p> : null}
              <section className="flex flex-col gap-1.5" data-testid="expert-history">
                <h3 className={H2}>History</h3>
                <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100">{`Joined · ${dayText(e.created_at) || 'date not recorded'}`}</p>
                {(read.reply.history || []).map((hx, i) => (
                  <p key={`${hx.review_version}-${i}`} className="m-0 text-[13px] text-axal-ink dark:text-gray-100">
                    {`${DECISION_WORD[hx.decision] || 'Decided'} · ${dayText(hx.decided_at) || 'date not recorded'}${hx.credentials_checked ? ' · credentials checked' : ''}`}
                    {hx.reason ? <span className={`block ${SUB}`}>{hx.reason}</span> : null}
                  </p>
                ))}
                {!(read.reply.history || []).length && e.verified && !e.decided_at ? <p className={`m-0 ${SUB}`}>Verified before decisions were recorded.</p> : null}
              </section>
            </>
          ) : null}
        </div>
      </Lightbox>
      {dialog && ready ? <ExpertDialog kind={dialog} expert={e} onClose={() => setDialog(null)} onDone={done} /> : null}
    </>
  );
}

export default function ExpertBoard({ at }) {
  const b = BOARDS['wellbeing-experts'];
  const loc = useLocation();
  const navigate = useNavigate();
  const read = useLoad(() => readAllExperts(), 'experts', { what: 'approvals:wellbeing' });
  const [page, setPage] = useState(0);
  const [done, setDone] = useState(null);
  const tab = EXPERT_TABS.find((t) => t.key === at.tab) || EXPERT_TABS[0];
  const board = read.status === 'ready' ? expertBoard(read.reply, tab.key) : null;
  const verifyBoard = read.status === 'ready' ? expertBoard(read.reply, 'verify') : null;
  const from = at.item ? (loc.state?.from || tabPath('wellbeing-experts', 'verify')) : loc.pathname;
  const count = (k) => (read.status === 'loading' ? { kind: 'load' } : !board ? { kind: 'dash', tip: 'The experts could not be read.' }
    : board.partial ? { kind: 'dash', tip: `Counted over the first ${board.read} of ${board.total ?? 'an unknown number of'} experts.` } : { kind: 'num', value: nf(board.counts[k]) });
  // Literal paths, so the reachability walk finds every tab.
  const tabs = (
    <>
      <HeaderTab to="/admin/approvals/wellbeing-experts" count={count('verify')} data-testid="experts-tab-verify">To verify</HeaderTab>
      <HeaderTab to="/admin/approvals/wellbeing-experts/incomplete" count={count('incomplete')} data-testid="experts-tab-incomplete">Profile incomplete</HeaderTab>
      <HeaderTab to="/admin/approvals/wellbeing-experts/verified" count={count('verified')} data-testid="experts-tab-verified">Verified</HeaderTab>
      <HeaderTab to="/admin/approvals/wellbeing-experts/declined" count={count('declined')} data-testid="experts-tab-declined">Declined</HeaderTab>
      <HeaderTab to="/admin/approvals/wellbeing-experts/hidden" count={count('hidden')} data-testid="experts-tab-hidden">Hidden</HeaderTab>
    </>
  );
  const tileValue = (k) => (board && !board.partial ? board.counts[k] : null);
  const decided = (line) => { setDone(line); read.reload(); };
  const rows = board ? board.rows.slice(page * PAGE, page * PAGE + PAGE) : [];
  const decidedTab = tab.key === 'verified' || tab.key === 'declined';
  return (
    <div className="flex flex-col gap-5" data-testid="approvals-board-wellbeing-experts">
      <AdminPageHeader crumb={CRUMB} title={b.title} pills={[NEW_PILL]} line={b.line} scope tabs={tabs} data-testid="approvals-board-header" />
      <DoneLine text={done} onDismiss={() => setDone(null)} />
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <Tile label="To verify" testId="experts-tile-verify" sub={verifyBoard?.oldest ? `oldest ${verifyBoard.oldest}` : null}><Figure status={read.status} value={tileValue('verify')} /></Tile>
        <Tile label="Verified" testId="experts-tile-verified"><Figure status={read.status} value={tileValue('verified')} /></Tile>
        <Tile label="Declined" testId="experts-tile-declined"><Figure status={read.status} value={tileValue('declined')} /></Tile>
      </div>
      {read.status === 'error' ? <Failed what="The experts" onRetry={read.reload} testId="experts-failed" />
        : read.status === 'loading' ? <Skeleton.Text lines={4} />
          : (
            <>
              {board.partial ? <p className={`m-0 ${SUB}`} data-testid="experts-partial">{`This list is the first ${board.read} of ${board.total ?? 'an unknown number of'} experts, so the counts are not drawn.`}</p> : null}
              {board.rows.length ? (
                <section className={`${CARD} flex flex-col`} data-testid="experts-table">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px]">
                      <thead><tr className="border-b border-axal-hairline dark:border-gray-700">
                        <th className={TH}>Waiting</th><th className={TH}>Expert</th><th className={TH}>Profile complete</th><th className={TH}>Credentials</th>
                        {decidedTab ? <th className={TH}>Decided</th> : null}<th className={TH}><span className="sr-only">Open</span></th>
                      </tr></thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.key} className="border-b border-axal-hairline last:border-0 dark:border-gray-700" data-testid={`expert-${r.key}`}>
                            <td className={TD}><span className={MONO}>{r.age || 'Not recorded'}</span>{tab.key === 'verify' ? <BandPill band={r.band} /> : null}</td>
                            <td className={TD}>{r.name}{r.headline ? <div className={SUB}>{r.headline}</div> : null}</td>
                            <td className={TD}>{r.pct == null ? <span className={SUB}>Not recorded</span> : <><span className={MONO}>{`${r.pct}%`}</span>{r.pct < 70 ? <div className={SUB}>Too incomplete to list</div> : null}</>}</td>
                            <td className={TD}>{r.credentials ? <span className={MONO}>{r.credentials}</span> : <span className={WARN_PILL}>! None given</span>}</td>
                            {decidedTab ? <td className={`${TD} ${MONO}`}>{r.decidedOn || 'Not recorded'}</td> : null}
                            <td className={TD}><Link className={LINK} to={`/admin/approvals/wellbeing-experts/${encodeURIComponent(r.key)}`} state={{ from }} data-testid={`expert-open-${r.key}`}>Open</Link></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Pager page={page} total={board.rows.length} onPage={setPage} testId="experts-pager" />
                </section>
              ) : <p className={`m-0 ${SUB}`} data-testid="experts-empty">{`No expert is in ${tab.label}.`}</p>}
            </>
          )}
      {at.item ? <ExpertDrawer uid={at.item} onClose={() => navigate(from)} onDecided={decided} /> : null}
    </div>
  );
}
