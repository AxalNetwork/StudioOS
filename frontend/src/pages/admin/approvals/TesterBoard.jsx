import React, { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { approvalBoardsApi } from '../../../lib/api/approvalBoards';
import { AdminPageHeader, HeaderTab, Lightbox, Skeleton } from '../../../ui';
import { BandPill } from './AdminApprovals';
import {
  BOARDS, INTAKE_PAUSED, INTAKE_PAUSED_LINE, PROFILES, TESTER_TABS,
  answerPairs, dayText, decisionCopy, doneLine, profileChart, profileWord, reasonReady, tabPath, testerActions, testerHistory, testerRows,
} from './approvalsModel';
import {
  BTN, BTN_PRIMARY, CARD, DecisionDialog, FOOT, PhoneBack, DialogField, DoneLine, EYE, Fact, Failed, Figure, H2, LINK, MONO, PAGE, PILL, Pager, SELECT, SUB,
  TD, TH, Tile, WARN_PILL, nf, useLoad,
} from './boardParts';

/**
 * D1046 (#2894) — Product testers (APR4, APR5), on D1042's store: five tabs at
 * sub-paths, the facts, three tiles and the chart by profile, the toolbar and
 * table, the tester at `/admin/approvals/product-testers/<id>`, and dialogs A
 * (approve), B (decline) and C (pause or remove), with Resume for a paused
 * tester. Every decision tells the member; the Worker refuses one whose email
 * is not verified, and dialog A says so before anything is sent.
 */

const CRUMB = { to: '/admin/approvals', label: 'Approvals', current: 'Product testers' };
const NEW_PILL = { label: 'New lane', tone: 'held' };
export const TESTER_READ_PAGES = 10;
const FACTS = 'Who can apply: Founders, Investors, Advisors, Operating Partners, Explorers · Who decides: any Admin or Super Admin · Admins cannot apply';

/** Every tester, a hundred a page, up to a thousand: what the tiles, chart, counts and table read. */
export async function readAllTesters(client = approvalBoardsApi) {
  let rows = [];
  let reply = null;
  for (let page = 1; page <= TESTER_READ_PAGES; page += 1) {
    reply = await client.testers({ page, pageSize: 100 });
    rows = rows.concat(Array.isArray(reply?.rows) ? reply.rows : []);
    if (rows.length >= Number(reply?.matching || 0) || !(reply?.rows || []).length) break;
  }
  const matching = Number(reply?.matching || 0);
  return { rows, totals: reply?.totals || null, matching, complete: rows.length >= matching };
}

const SORTS = { waiting: 'Waiting longest', newest: 'Newest first', name: 'Name' };

function useTesterFilters() {
  const [q, setQ] = useState('');
  const [profile, setProfile] = useState('');
  const [verified, setVerified] = useState('');
  const [consent, setConsent] = useState('');
  const [sort, setSort] = useState('waiting');
  return { q, setQ, profile, setProfile, verified, setVerified, consent, setConsent, sort, setSort };
}

/** The toolbar's filters over the tab's rows, in memory. */
export function filterTesters(rows, f) {
  const needle = String(f.q || '').trim().toLowerCase();
  const out = rows.filter((r) => {
    if (needle.length >= 2 && !`${r.name} ${r.email || ''}`.toLowerCase().includes(needle)) return false;
    if (f.profile && profileWord(f.profile) !== r.profile) return false;
    if (f.verified === 'yes' && !r.emailVerified) return false;
    if (f.verified === 'no' && r.emailVerified) return false;
    if (f.consent === 'yes' && !r.consent) return false;
    if (f.consent === 'no' && r.consent) return false;
    return true;
  });
  if (f.sort === 'newest') return [...out].sort((a, b) => (a.ageHours ?? Infinity) - (b.ageHours ?? Infinity));
  if (f.sort === 'name') return [...out].sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function ProfileChart({ chart }) {
  const [table, setTable] = useState(false);
  return (
    <section className={`${CARD} flex flex-col gap-2.5 px-4 py-3.5`} data-testid="testers-chart">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={H2}>Applications by profile, last 12 weeks</h2>
        {!chart.partial ? <button type="button" className={LINK} onClick={() => setTable((t) => !t)} data-testid="testers-chart-toggle">{table ? 'View as chart' : 'View as table'}</button> : null}
      </div>
      <p className={`m-0 ${SUB}`}>Any profile can apply.</p>
      {chart.partial ? <p className={`m-0 ${SUB}`} data-testid="testers-chart-partial">{chart.sentence}</p>
        : table ? (
          <table className="w-full" data-testid="testers-chart-table">
            <thead><tr><th className={TH}>Profile</th><th className={TH}>Applications</th></tr></thead>
            <tbody>{chart.bars.map((b) => <tr key={b.role}><td className={TD}>{b.label}</td><td className={`${TD} ${MONO}`}>{nf(b.n)}</td></tr>)}</tbody>
          </table>
        ) : (
          <div role="img" aria-label={chart.sentence} className="grid gap-2" data-testid="testers-chart-bars">
            {chart.bars.map((b) => (
              <div key={b.role} className="grid grid-cols-[128px_minmax(0,1fr)_34px] items-center gap-2.5 text-[12.5px]" aria-hidden="true">
                <span className="text-axal-ink dark:text-gray-100">{b.label}</span>
                <span className="h-2 rounded-full bg-gray-100 dark:bg-gray-800"><span className="block h-2 rounded-full bg-axal-violet" style={{ width: `${(b.n / chart.max) * 100}%` }} /></span>
                <span className={`${MONO} text-right text-axal-ink dark:text-gray-100`}>{nf(b.n)}</span>
              </div>
            ))}
          </div>
        )}
    </section>
  );
}

function TesterTable({ tab, rows, from }) {
  const open = (r) => <Link className={LINK} to={`/admin/approvals/product-testers/${r.id}`} state={{ from }} data-testid={`tester-open-${r.id}`}>Open</Link>;
  if (tab === 'waiting') {
    return (
      <table className="w-full min-w-[1040px]">
        <thead><tr className="border-b border-axal-hairline dark:border-gray-700">
          <th className={TH}>Waiting</th><th className={TH}>Applicant</th><th className={TH}>Profile</th><th className={TH}>Applied</th>
          <th className={TH}>Availability</th><th className={TH}>Email consent</th><th className={TH}>Identity</th><th className={TH}>Email</th><th className={TH}><span className="sr-only">Open</span></th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-axal-hairline last:border-0 dark:border-gray-700" data-testid={`tester-${r.id}`}>
              <td className={TD}><span className={MONO}>{r.age || 'Not recorded'}</span><BandPill band={r.band} /></td>
              <td className={TD}>{r.name}{r.email ? <div className={SUB}>{r.email}</div> : null}</td>
              <td className={TD}><span className={PILL}>{r.profile}</span></td>
              <td className={`${TD} ${MONO}`}>{r.applied}</td>
              <td className={TD}>{r.availability || <span className={SUB}>Not given</span>}</td>
              <td className={TD}>{r.consent ? <span className={MONO}>{r.consent}</span> : <span className={WARN_PILL}>! Not given</span>}</td>
              <td className={TD}>{r.identity}</td>
              <td className={TD}>{r.emailVerified ? 'Verified' : <span className={WARN_PILL}>! Not verified</span>}</td>
              <td className={TD}>{open(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (tab === 'active' || tab === 'paused') {
    return (
      <table className="w-full min-w-[820px]">
        <thead><tr className="border-b border-axal-hairline dark:border-gray-700">
          <th className={TH}>Tester</th><th className={TH}>Profile</th><th className={TH}>{tab === 'active' ? 'Tester since' : 'Paused on'}</th>
          <th className={TH}>{tab === 'active' ? 'Approved by' : 'Paused by'}</th><th className={TH}>Programs</th><th className={TH}><span className="sr-only">Open</span></th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-axal-hairline last:border-0 dark:border-gray-700" data-testid={`tester-${r.id}`}>
              <td className={TD}>{r.name}{r.email ? <div className={SUB}>{r.email}</div> : null}</td>
              <td className={TD}><span className={PILL}>{r.profile}</span></td>
              <td className={`${TD} ${MONO}`}>{r.decidedOn || 'Not recorded'}</td>
              <td className={TD}>{r.decidedBy || <span className={SUB}>Not recorded</span>}</td>
              <td className={TD}>{r.programmes && (r.programmes.applied || r.programmes.picked)
                ? <span className={MONO}>{`${nf(r.programmes.picked)} picked · ${nf(r.programmes.applied)} applied`}</span>
                : <span className={SUB}>None yet</span>}</td>
              <td className={TD}>{open(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return (
    <table className="w-full min-w-[820px]">
      <thead><tr className="border-b border-axal-hairline dark:border-gray-700">
        <th className={TH}>Member</th><th className={TH}>Profile</th><th className={TH}>Decided</th><th className={TH}>By</th><th className={TH}>Reason they were told</th><th className={TH}><span className="sr-only">Open</span></th>
      </tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-b border-axal-hairline last:border-0 dark:border-gray-700" data-testid={`tester-${r.id}`}>
            <td className={TD}>{r.name}{r.email ? <div className={SUB}>{r.email}</div> : null}</td>
            <td className={TD}><span className={PILL}>{r.profile}</span></td>
            <td className={`${TD} ${MONO}`}>{r.decidedOn || 'Not recorded'}</td>
            <td className={TD}>{r.decidedBy || <span className={SUB}>Not recorded</span>}</td>
            <td className={TD}>{r.reason || <span className={SUB}>Not recorded</span>}</td>
            <td className={TD}>{open(r)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Dialogs A, B and C, and Resume. `kind` is approve, decline, pause-remove, remove or resume.
 * D1204: also the dialogs Product testing's Tester pool opens from its ⋯ menu.
 */
export function TesterDialog({ kind, tester, onClose, onDone }) {
  const name = tester.member?.name || 'This member';
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [choice, setChoice] = useState(kind === 'remove' ? 'remove' : 'pause');
  const action = kind === 'pause-remove' || kind === 'remove' ? choice : kind;
  const key = `tester_${action}`;
  const copy = decisionCopy(key, { who: name, profile: profileWord(tester.member?.role) });
  const title = kind === 'pause-remove' ? decisionCopy('tester_pause', { who: name }).title : copy.title;
  const needsReason = action !== 'approve' && action !== 'resume';
  const blocked = !tester.member?.email_verified ? `${name}’s email is not verified, so they cannot be told. Ask them to verify it first.` : null;
  const send = async () => {
    const r = await approvalBoardsApi.decideTester(tester.id, action, { note: note.trim(), reason: needsReason ? reason.trim() : '' });
    onDone(doneLine(key, name, r || {}));
  };
  return (
    <DecisionDialog copy={{ ...copy, title, changes: kind === 'pause-remove' ? 'From the Active tab. They are told.' : copy.changes }} testId={`tester-dialog-${kind}`} onClose={onClose} onSend={send}
      ready={!needsReason || reasonReady(key, reason)} blocked={blocked} danger={action === 'decline' || action === 'remove'}>
      {kind === 'pause-remove' ? (
        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0" data-testid="tester-dialog-choice">
          <legend className="sr-only">Pause or remove</legend>
          <label className="flex items-start gap-2 text-[13px] text-axal-ink dark:text-gray-100"><input type="radio" name="tester-choice" checked={choice === 'pause'} onChange={() => setChoice('pause')} data-testid="tester-choice-pause" /> Pause: no new programs; current ones carry on</label>
          <label className="flex items-start gap-2 text-[13px] text-axal-ink dark:text-gray-100"><input type="radio" name="tester-choice" checked={choice === 'remove'} onChange={() => setChoice('remove')} data-testid="tester-choice-remove" /> Remove: they leave the pool; their open program places end</label>
        </fieldset>
      ) : null}
      {needsReason ? (
        <DialogField label={action === 'decline' ? 'Reason · required · at least 10 characters · they see this' : 'Reason · required · they see this'}
          value={reason} onChange={setReason} testId="tester-dialog-reason" placeholder="Write a reason…" />
      ) : null}
      <DialogField label="Note · optional · they do not see it" value={note} onChange={setNote} testId="tester-dialog-note" placeholder="Write a note…" rows={2} />
    </DecisionDialog>
  );
}

const ACTION_LABEL = { approve: 'Approve…', decline: 'Decline…', 'pause-remove': 'Pause or remove…', remove: 'Remove…', resume: 'Resume…' };
const EYEBROW = { applied: 'Product tester application', active: 'Product tester · active', paused: 'Product tester · paused', declined: 'Product tester · declined', removed: 'Product tester · removed' };

/** One tester at their own address (APR5), over the board. */
function TesterDrawer({ id, onClose, onDecided }) {
  const read = useLoad(() => approvalBoardsApi.tester(id), `tester-${id}`, { what: 'approvals:tester' });
  const [dialog, setDialog] = useState(null);
  const t = read.reply?.tester;
  const ready = read.status === 'ready' && t;
  const done = (line) => { setDialog(null); read.reload(); onDecided(line); };
  return (
    <>
      <Lightbox label={ready ? `${t.member?.name || 'Member'}, product tester` : 'Product tester'} eyebrow={ready ? EYEBROW[t.status] : 'Product tester'}
        title={ready ? (t.member?.name || 'Name not recorded') : 'Product tester'} sub={ready ? 'Esc to close' : null} onClose={onClose} testId="tester-drawer" width={600}
        footer={ready ? (
          <div className={`${FOOT} flex-wrap items-center`}>
            {t.status === 'applied' ? <Link className={BTN} to={`/admin/approvals/items/product_testers-${t.id}`} data-testid="tester-assign">Assign…</Link> : null}
            {testerActions(t.status).map((a) => (
              <button key={a} type="button" className={a === 'approve' || a === 'resume' ? BTN_PRIMARY : BTN} onClick={() => setDialog(a)} data-testid={`tester-action-${a}`}>{ACTION_LABEL[a]}</button>
            ))}
          </div>
        ) : null}>
        <div className="flex flex-col gap-4 px-5 py-4" data-testid="tester-drawer-content">
          <PhoneBack label="Product testers" onClose={onClose} testId="tester-drawer-back" />
          {read.status === 'loading' ? <Skeleton.Text lines={5} /> : null}
          {read.status === 'error' ? (
            read.error?.status === 404
              ? <p className={`m-0 ${SUB}`} data-testid="tester-drawer-missing">No product tester has that number.</p>
              : <Failed what="This tester" onRetry={read.reload} testId="tester-drawer-failed" />
          ) : null}
          {ready ? (
            <>
              <div className="flex flex-wrap gap-1.5"><span className={PILL}>{profileWord(t.member?.role)}</span></div>
              <dl className="m-0 grid grid-cols-2 gap-3">
                <Fact k="Applied" v={dayText(t.applied_at)} />
                <Fact k="Email" v={t.member?.email_verified ? 'Verified' : 'Not verified'} sub={t.member?.email} testId="tester-fact-email" />
                <Fact k="Identity check" v={t.member?.kyc_status ? String(t.member.kyc_status).replace(/^./, (c) => c.toUpperCase()) : 'Not started'} />
                {t.decided_at ? <Fact k="Decided" v={`${dayText(t.decided_at)}${t.decided_by_name ? ` by ${t.decided_by_name}` : ''}`} /> : null}
                {t.reapply_after ? <Fact k="Can apply again" v={dayText(t.reapply_after)} /> : null}
              </dl>
              {t.reason ? <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100" data-testid="tester-reason"><span className={EYE}>What they were told · </span>{t.reason}</p> : null}
              {t.note ? <p className={`m-0 ${SUB}`} data-testid="tester-note">{`Admin note, which they do not see: ${t.note}`}</p> : null}
              <section className="flex flex-col gap-2" data-testid="tester-answers">
                <h3 className={H2}>Their answers</h3>
                {answerPairs(t.answers).length ? answerPairs(t.answers).map((a, i) => (
                  <div key={i}><div className={EYE}>{a.q}</div><p className="m-0 text-[13px] text-axal-ink dark:text-gray-100">{a.a}</p></div>
                )) : <p className={`m-0 ${SUB}`}>No answers recorded.</p>}
              </section>
              <section className="flex flex-col gap-1">
                <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100">{`Availability: ${t.availability && String(t.availability).trim() ? t.availability : 'not given'}`}</p>
                <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100" data-testid="tester-consent">{t.consent_email_at
                  ? `Email consent: given on ${dayText(t.consent_email_at)}, version ${t.consent_version || 'not recorded'}.`
                  : 'Email consent: not given.'}</p>
                <p className={`m-0 ${SUB}`}>Testing programs email testers only with this consent.</p>
              </section>
              <section className="flex flex-col gap-1.5" data-testid="tester-programs">
                <h3 className={H2}>Testing programs</h3>
                {(read.reply.programs || []).length ? read.reply.programs.map((p) => (
                  <p key={p.application_uid} className="m-0 text-[13px] text-axal-ink dark:text-gray-100">{`${p.product_name || 'A program'} · ${p.application_status} · ${dayText(p.applied_at) || 'date not recorded'}`}</p>
                )) : <p className={`m-0 ${SUB}`}>None yet.</p>}
              </section>
              <section className="flex flex-col gap-1.5" data-testid="tester-history">
                <h3 className={H2}>History</h3>
                {testerHistory(read.reply.events).length ? testerHistory(read.reply.events).map((e) => (
                  <p key={e.key} className="m-0 text-[13px] text-axal-ink dark:text-gray-100">{`${e.line} · ${e.on}`}{e.reason ? <span className={`block ${SUB}`}>{e.reason}</span> : null}</p>
                )) : <p className={`m-0 ${SUB}`}>No decision recorded yet.</p>}
              </section>
            </>
          ) : null}
        </div>
      </Lightbox>
      {dialog && ready ? <TesterDialog kind={dialog} tester={t} onClose={() => setDialog(null)} onDone={done} /> : null}
    </>
  );
}

export default function TesterBoard({ at }) {
  const b = BOARDS['product-testers'];
  const loc = useLocation();
  const navigate = useNavigate();
  const all = useLoad(() => readAllTesters(), 'testers', { what: 'approvals:testers' });
  const inProgram = useLoad(() => approvalBoardsApi.testers({ status: 'active', inProgramme: 'yes', pageSize: 1 }), 'testers-in-program', { what: 'approvals:testers:in-program' });
  const f = useTesterFilters();
  const [page, setPage] = useState(0);
  const [done, setDone] = useState(null);
  const tab = TESTER_TABS.find((t) => t.key === at.tab) || TESTER_TABS[0];
  const ready = all.status === 'ready';
  const totals = ready ? all.reply.totals : null;
  const tabRows = useMemo(() => (ready ? testerRows(all.reply.rows.filter((r) => r.status === tab.status)) : []), [ready, all.reply, tab.status]);
  const shown = filterTesters(tabRows, f);
  // The Worker reads oldest application first, so the first waiting row read is the oldest.
  const oldest = ready ? testerRows(all.reply.rows.filter((r) => r.status === 'applied'))[0] : null;
  const chart = ready ? profileChart(all.reply.rows, { complete: all.reply.complete }) : null;
  const from = at.item ? (loc.state?.from || tabPath('product-testers', 'waiting')) : loc.pathname;
  const count = (status) => (all.status === 'loading' ? { kind: 'load' } : !totals ? { kind: 'dash', tip: 'The testers could not be read.' } : { kind: 'num', value: nf(totals[status] || 0) });
  // Literal paths, so the reachability walk finds every tab.
  const tabs = (
    <>
      <HeaderTab to="/admin/approvals/product-testers" count={count('applied')} data-testid="testers-tab-waiting">Waiting</HeaderTab>
      <HeaderTab to="/admin/approvals/product-testers/active" count={count('active')} data-testid="testers-tab-active">Active</HeaderTab>
      <HeaderTab to="/admin/approvals/product-testers/paused" count={count('paused')} data-testid="testers-tab-paused">Paused</HeaderTab>
      <HeaderTab to="/admin/approvals/product-testers/declined" count={count('declined')} data-testid="testers-tab-declined">Declined</HeaderTab>
      <HeaderTab to="/admin/approvals/product-testers/removed" count={count('removed')} data-testid="testers-tab-removed">Removed</HeaderTab>
    </>
  );
  const decided = (line) => { setDone(line); all.reload(); inProgram.reload(); };
  return (
    <div className="flex flex-col gap-5" data-testid="approvals-board-product-testers">
      <AdminPageHeader crumb={CRUMB} title={b.title} pills={[NEW_PILL]} line={b.line} scope tabs={tabs} data-testid="approvals-board-header" />
      <p className="m-0 text-[12.5px] font-semibold text-axal-ink dark:text-gray-100" data-testid="testers-facts">{FACTS}</p>
      {INTAKE_PAUSED ? <p role="note" className={`${CARD} m-0 px-4 py-3 text-[13px] font-semibold text-amber-800 dark:text-amber-200`} data-testid="testers-intake-paused">{INTAKE_PAUSED_LINE}</p> : null}
      <p className={`m-0 ${SUB}`} data-testid="testers-info">Approved testers form the tester pool. Testing programs recruit from it on Platform › Product testing, at HQ. This board decides applications and the pool only.</p>
      <DoneLine text={done} onDismiss={() => setDone(null)} />
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <Tile label="Waiting" testId="testers-tile-waiting" sub={oldest?.age ? `oldest ${oldest.age}` : null}><Figure status={all.status} value={totals?.applied} /></Tile>
        <Tile label="Active testers" testId="testers-tile-active"><Figure status={all.status} value={totals?.active} /></Tile>
        <Tile label="In a testing program now" testId="testers-tile-in-program"><Figure status={inProgram.status} value={inProgram.reply?.matching} /></Tile>
      </div>
      {chart ? <ProfileChart chart={chart} /> : null}
      {all.status === 'error' ? <Failed what="The product testers" onRetry={all.reload} testId="testers-failed" />
        : all.status === 'loading' ? <Skeleton.Text lines={4} />
          : (
            <section className={`${CARD} flex flex-col`} data-testid="testers-table">
              <div className="flex flex-wrap items-center gap-2 border-b border-axal-hairline px-3 py-2.5 dark:border-gray-700" data-testid="testers-toolbar">
                <input type="search" className={`${SELECT} w-56`} placeholder="Search name or email" aria-label="Search name or email" value={f.q} onChange={(e) => { f.setQ(e.target.value); setPage(0); }} data-testid="testers-search" />
                <select className={SELECT} aria-label="Profile" value={f.profile} onChange={(e) => { f.setProfile(e.target.value); setPage(0); }} data-testid="testers-profile">
                  <option value="">Profile: all</option>
                  {PROFILES.map((p) => <option key={p.role} value={p.role}>{p.one}</option>)}
                </select>
                <select className={SELECT} aria-label="Email verified" value={f.verified} onChange={(e) => { f.setVerified(e.target.value); setPage(0); }} data-testid="testers-verified">
                  <option value="">Email verified: any</option><option value="yes">Verified</option><option value="no">Not verified</option>
                </select>
                <select className={SELECT} aria-label="Email consent" value={f.consent} onChange={(e) => { f.setConsent(e.target.value); setPage(0); }} data-testid="testers-consent">
                  <option value="">Email consent: any</option><option value="yes">Given</option><option value="no">Not given</option>
                </select>
                <select className={SELECT} aria-label="Sort" value={f.sort} onChange={(e) => f.setSort(e.target.value)} data-testid="testers-sort">
                  {Object.entries(SORTS).map(([k, label]) => <option key={k} value={k}>{`Sort: ${label}`}</option>)}
                </select>
              </div>
              {!all.reply.complete ? <p className={`m-0 px-3 py-2 ${SUB}`} data-testid="testers-partial">{`This list is the first ${nf(all.reply.rows.length)} of ${nf(all.reply.matching)} testers. Search and filters cover those only.`}</p> : null}
              {shown.length ? (
                <>
                  <div className="overflow-x-auto"><TesterTable tab={tab.key} rows={shown.slice(page * PAGE, page * PAGE + PAGE)} from={from} /></div>
                  <Pager page={page} total={shown.length} onPage={setPage} testId="testers-pager" />
                </>
              ) : tabRows.length ? <p className={`m-0 px-3 py-4 ${SUB}`} data-testid="testers-none-match">No tester matches these filters.</p>
                : tab.key === 'waiting' && INTAKE_PAUSED ? (
                  <div className="flex flex-col items-start gap-1 px-4 py-5" data-testid="testers-empty">
                    <h2 className={H2}>No product tester is waiting.</h2>
                    <p className={`m-0 ${SUB}`}>Intake is paused, so no application arrives here. Active, Paused, Declined and Removed still list.</p>
                  </div>
                ) : <p className={`m-0 px-3 py-4 ${SUB}`} data-testid="testers-empty">{`No tester is ${tab.label.toLowerCase()}.`}</p>}
            </section>
          )}
      {at.item ? <TesterDrawer id={at.item} onClose={() => navigate(from)} onDecided={decided} /> : null}
    </div>
  );
}
