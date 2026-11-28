/**
 * D1218 (#3215, part 5 of #2424) — the room complete, from the closings store
 * (D1215): the founder's room (CP1), the investor's (CP2, CP20) and the same
 * room as an Admin reads it under the deal. Each line carries its route, its
 * paper (D1216's staged envelopes, read one line at a time), its money and
 * who acts next. Each read fails on its own block (CP18).
 *
 * Who sees what is the Worker's (D1215 §2): the founder and an Admin read
 * every line; an investor reads their own lines and the round's total, and
 * nothing here is drawn from another investor's line.
 *
 * Every change opens an in-page dialog that says what it changes (CP11, the
 * investor's match). The platform never moves money: a line is Received only
 * on the receiving side's evidence.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { closingsApi } from '../../lib/api/closings';
import { companyReceivingAccountsApi } from '../../lib/api/companyReceivingAccounts';
import { reportingApi } from '../../lib/api/reporting';
import { Unreadable, Unrecorded, usePhoneWidth } from '../../ui';
import { BTN } from '../account/AccountCenter';
import { closingHrefFor } from './deskModel';
import PaperState from './PaperState';
import { AccountDialog, CaptableDialog, ReceiptDrawer, SignDrawer } from './RoomDialogs';
import { CaptableCard, Money, NoAccess, box, mutedText, pulse, useLoad, usePapers } from './roomShared';
import InvestorRoom from './InvestorRoom';
import {
  ACCOUNT_WORDS, accountView, savedNote, NO_ACCESS, ROOM_FAILED, STEPS, captableView, dutyRows,
  liveEnvelope, needsYou, roomLines, roomTiles, stepStrip,
} from './roomModel';

export { NoAccess };



function Head({ title, crumb, sub, instrument, action = null }) {
  return (
    <header className="flex flex-col gap-1" data-testid="closing-head">
      <p className="m-0 text-[12px] font-semibold text-gray-500 dark:text-gray-400">{crumb}</p>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="m-0 text-[19px] font-extrabold tracking-tight">{title}</h2>
        {instrument ? <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-bold text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">{instrument}</span> : null}
        {action ? <><span className="flex-1" />{action}</> : null}
      </div>
      {sub ? <p className={mutedText}>{sub}</p> : null}
    </header>
  );
}

const STEP_TONE = {
  done: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
  now: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  next: 'border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400',
  unread: 'border-dashed border-gray-300 bg-white text-gray-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-400',
};

/** The seven steps (CP1, CP2); on a phone, the step that is now, as one line (CP20). */
function Strip({ steps, phone }) {
  if (phone) {
    const i = Math.max(0, steps.findIndex((s) => s.state === 'now'));
    const s = steps[i] || { name: STEPS[0], text: '' };
    return <p className="m-0 text-[12.5px] font-semibold" data-testid="closing-steps">Step {i + 1} of {STEPS.length} · {s.name}{s.text ? ` · ${s.text}` : ''}</p>;
  }
  return (
    <ol className="m-0 grid list-none grid-cols-7 gap-1.5 p-0" aria-label="Closing steps" data-testid="closing-steps">
      {steps.map((s, i) => (
        <li key={s.name} className={`flex min-w-0 flex-col gap-0.5 rounded-lg border px-2 py-1.5 text-[11.5px] ${STEP_TONE[s.state] || STEP_TONE.next}`} data-testid={`closing-step-${i + 1}`} data-state={s.state}>
          <span className="font-bold">{i + 1}. {s.name}</span>
          <span className="truncate" title={s.text}>{s.text}</span>
        </li>
      ))}
    </ol>
  );
}

function Tile({ label, value, sub, testId }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900" data-testid={testId}>
      <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-[17px] font-bold tabular-nums">{value}</span>
      {sub ? <span className="text-[11.5px] text-gray-500 dark:text-gray-400">{sub}</span> : null}
    </div>
  );
}

const signedValue = (t) => (t.signed ?? (t.signedRead === 'reading' ? 'Reading…' : <Unrecorded reason="A line’s paper could not be read, so the executed count is not shown." />));

function NextWords({ next }) {
  return <span className={next.you ? 'font-semibold text-amber-800 dark:text-amber-300' : 'text-gray-600 dark:text-gray-400'}>{next.text}</span>;
}

/** CP1's lines, as a table; on a phone, one card per line (CP20). */
function LinesBlock({ rows, phone, onReceipt, onSign }) {
  if (!rows.length) {
    return (
      <section className={box} data-testid="closing-lines">
        <h3 className="m-0 text-[15px] font-bold">No commitment on this deal yet.</h3>
        <p className={mutedText} data-testid="closing-lines-empty">Lines appear here when an investor commits in the deal room.</p>
      </section>
    );
  }
  if (phone) {
    return (
      <section className="flex flex-col gap-2" data-testid="closing-lines">
        {rows.map((r) => (
          <article key={r.uid} className={box} data-testid={`closing-line-card-${r.uid}`}>
            <div className="flex items-baseline justify-between gap-2"><span className="font-bold">{r.investor}</span><Money text={r.amount} reason="No amount is recorded on this line." /></div>
            <p className={mutedText}>{r.route || 'No route set'} · <PaperState state={r.paperState} text={r.paper} /> · {r.status}</p>
            <NextWords next={r.next} />
            <div className="flex flex-col gap-2">
              {r.commitmentId != null ? <button type="button" className={`${BTN.ghost} min-h-[44px] w-full`} onClick={() => onSign(r)}>Signing order</button> : null}
              <button type="button" className={`${BTN.ghost} min-h-[44px] w-full`} onClick={() => onReceipt(r)}>Evidence</button>
            </div>
          </article>
        ))}
      </section>
    );
  }
  return (
    <section className={`${box} overflow-x-auto`} data-testid="closing-lines">
      <div className="flex items-baseline gap-2"><h3 className="m-0 text-[15px] font-bold">Lines</h3><span className="font-mono text-[12px] text-gray-500 dark:text-gray-400">{rows.filter((r) => !r.withdrawn).length}</span></div>
      <table className="w-full min-w-[640px] text-left text-[13px]">
        <thead><tr className="text-[11px] uppercase text-gray-500 dark:text-gray-400"><th className="py-1">Investor or vehicle</th><th>Route</th><th>Amount</th><th>Paper</th><th>Money</th><th>Next</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.uid} data-testid={`closing-line-${r.uid}`} className="border-t border-gray-100 align-top dark:border-gray-800">
              <td className="py-2 font-semibold">{r.investor}</td>
              <td>{r.route || <span className="text-gray-500 dark:text-gray-400">No route set</span>}</td>
              <td><Money text={r.amount} reason="No amount is recorded on this line." /></td>
              <td>{r.commitmentId != null ? <button type="button" className={BTN.link} onClick={() => onSign(r)} data-testid={`closing-line-paper-${r.uid}`}><PaperState state={r.paperState} text={r.paper} /></button> : r.paper}</td>
              <td><button type="button" className={BTN.link} onClick={() => onReceipt(r)} data-testid={`closing-line-money-${r.uid}`}>{r.status}</button></td>
              <td><NextWords next={r.next} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * CP1's receiving account card (#6190): the masked account or No account set,
 * with Set or Change for the founder the Worker lets read it (see
 * `roomModel.js` `accountView`). A failed read is never drawn as no account.
 */
function AccountCard({ view, note, phone, onOpen, onRetry }) {
  const full = phone ? 'min-h-[44px] w-full' : 'min-h-[44px] w-fit';
  return (
    <section className={box} data-testid="closing-account" data-state={view.state}>
      <h3 className="m-0 text-[15px] font-bold">{ACCOUNT_WORDS.title}</h3>
      {view.state === 'reading' ? <div className={`h-10 ${pulse}`} />
        : view.state === 'unreadable' ? <Unreadable what="Your company’s receiving account" claim="This is not a claim that none is set." onRetry={onRetry} />
          : view.state === 'refused' ? (
            <>
              {view.text ? <p className={mutedText} data-testid="closing-account-refused">{view.text}</p> : null}
              <p className={mutedText}>{ACCOUNT_WORDS.readOnly}</p>
            </>
          ) : view.state === 'none' ? (
            <>
              <span className="w-fit rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900 dark:bg-amber-900/40 dark:text-amber-200" data-testid="closing-account-none">{ACCOUNT_WORDS.none}</span>
              <p className={mutedText}>{ACCOUNT_WORDS.noneText}</p>
              <button type="button" className={`${BTN.ghost} ${full}`} onClick={onOpen} data-testid="closing-account-set">{ACCOUNT_WORDS.set}</button>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[15px] font-semibold" data-testid="closing-account-number">{view.number}</span>
                {view.bank ? <span className="text-[13px] text-gray-600 dark:text-gray-400">{view.bank}</span> : null}
                <span className="flex-1" />
                <button type="button" className={`${BTN.ghost} ${full}`} onClick={onOpen} data-testid="closing-account-change">{ACCOUNT_WORDS.change}</button>
              </div>
              <p className={mutedText}>{view.setOn ? `Set ${view.setOn}. ` : ''}Investors see it with the payment warning. Changing it tells every investor with an unpaid line.</p>
            </>
          )}
      {note ? <p role="status" className="m-0 text-[12.5px] font-semibold text-emerald-800 dark:text-emerald-300" data-testid="closing-account-saved">{note}</p> : null}
    </section>
  );
}

function NeedsYou({ items, onOpen }) {
  return (
    <section className={box} data-testid="closing-needs-you">
      <div className="flex items-center gap-2"><h3 className="m-0 text-[15px] font-bold">Needs you</h3><span className="rounded-full bg-amber-100 px-2 text-[11px] font-bold text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">{items.length}</span></div>
      {items.length === 0 ? <p className={mutedText}>Nothing waits on you in this closing now.</p> : items.map((it) => (
        <div key={it.key} className="flex flex-col gap-1.5 border-t border-gray-100 pt-2 dark:border-gray-800" data-testid={`closing-needs-${it.key}`}>
          <span className="text-[13px] font-semibold">{it.line ? `${it.line.investor}: ${it.text}` : it.text}</span>
          <button type="button" className={`${BTN.ghost} w-fit`} onClick={() => onOpen(it)}>{it.line ? 'Review' : 'Review the change'}</button>
        </div>
      ))}
    </section>
  );
}


/** CP12: the duties the signed paper names for this closing's lines, after Closed (D1058's desk). */
function ReportingCard({ closing }) {
  const closed = closing.status === 'closed';
  const read = useLoad(() => reportingApi.desk(closing.project_id), [closing.project_id], closed);
  const rows = read.status === 'ok' ? dutyRows(read.data, (closing.lines || []).map((l) => l.uid)) : [];
  return (
    <section className={box} data-testid="closing-reporting">
      <div className="flex items-center gap-2"><h3 className="m-0 text-[15px] font-bold">Reporting to the investors who signed</h3>{closed ? <span className="rounded-full bg-emerald-50 px-2 text-[11px] font-bold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">Closed</span> : null}</div>
      {!closed ? <p className={mutedText}>Reporting duties start when the closing is marked Closed. Each comes from the signed paper.</p>
        : read.status === 'loading' ? <div className={`h-12 ${pulse}`} />
          : read.status === 'error' ? <Unreadable what="The reporting duties" claim="This is not a claim that there are none." onRetry={read.retry} />
            : (
              <>
                <p className={mutedText}>Each duty comes from the signed paper. A term the paper left blank uses the default until you and the investor both confirm it.</p>
                {rows.length === 0 ? <p className={mutedText} data-testid="closing-reporting-empty">No duty is recorded for these lines: the signed paper names none, or the daily step has not created them yet.</p> : rows.map((d) => (
                  <div key={d.uid} className="grid grid-cols-1 gap-1 border-t border-gray-100 pt-2 text-[12.5px] sm:grid-cols-3 dark:border-gray-800" data-testid={`closing-duty-${d.uid}`}>
                    <span className="font-semibold">{d.holder}</span>
                    <span>{d.title}</span>
                    <span className="flex flex-col gap-1">
                      {d.defaulted ? <span className="w-fit rounded-full bg-amber-100 px-2 text-[11px] font-bold text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">Default, not in the paper</span> : null}
                      <span className="text-gray-600 dark:text-gray-400">{d.from}</span>
                    </span>
                  </div>
                ))}
                <p className={mutedText}>Duties started when the closing was marked Closed. Updates are written in <Link className={BTN.link} to="/grow/reporting/duties">Grow</Link>.</p>
              </>
            )}
    </section>
  );
}

/**
 * The room from the closings store. `entry` is the deal's closing from
 * `GET /api/closings`; `viewer` is founder, investor or admin. D8926: the
 * investor's room is its own page, built to the #6188 v2 canvas.
 */
export default function RecordRoom({ entry, viewer, deal }) {
  return viewer === 'investor' ? <InvestorRoom entry={entry} deal={deal} /> : <StaffRoom entry={entry} viewer={viewer} deal={deal} />;
}

/** The founder's room (CP1) and the same room as an Admin reads it under the deal (D1218). */
function StaffRoom({ entry, viewer, deal }) {
  const phone = usePhoneWidth();
  const read = useLoad(() => closingsApi.read(entry.uid), [entry.uid]);
  const closing = read.status === 'ok' ? read.data : null;
  const { papers, retry: retryPapers } = usePapers(closing?.lines);
  const [drawer, setDrawer] = useState(null);
  const projectId = closing?.project_id ?? entry.project_id ?? null;
  const accountRead = useLoad(() => companyReceivingAccountsApi.read(projectId), [projectId], viewer === 'founder' && projectId != null);
  const account = accountView(accountRead);
  const [accountNote, setAccountNote] = useState('');
  const companyName = entry.project_name || deal?.project_name || 'The company';
  const title = `Closing · ${companyName}${entry.round_label ? ` ${entry.round_label}` : ''}`;
  const crumb = viewer === 'founder' ? 'Raise › Capital relationships › Closing' : 'Deals › Closing · as the studio team reads it';
  const sub = 'One place for the paper, the money and the cap table of this round.';
  const instrument = entry.instrument || closing?.instrument || deal?.instrument || null;
  const names = { company: companyName };
  const rows = useMemo(() => (closing ? roomLines(closing, papers, viewer, names) : []), [closing, papers, viewer, companyName]); // eslint-disable-line react-hooks/exhaustive-deps
  const steps = useMemo(() => (closing ? stepStrip(closing, papers) : STEPS.map((name) => ({ name, state: 'unread', text: 'Reading…' }))), [closing, papers]);

  if (read.status === 'error') {
    if (Number(read.error?.status) === 404) return <NoAccess text={NO_ACCESS.line} back={<Link className={`${BTN.ghost} w-fit`} to="/deals">Back to your deals</Link>} />;
    return (
      <div className="flex min-w-0 flex-col gap-4" data-testid="closing-room">
        <Head title={title} crumb={crumb} instrument={instrument} />
        <section className={box} data-testid="closing-room-failed">
          <h3 className="m-0 text-[15px] font-bold">{ROOM_FAILED.title}</h3>
          <p className={mutedText}>{ROOM_FAILED.claim}</p>
          <button type="button" className={`${BTN.primary} w-fit`} onClick={read.retry}>Try again</button>
        </section>
      </div>
    );
  }

  // CP17: the header and the stepper draw at once; everything else reads.
  if (!closing) {
    return (
      <div className="flex min-w-0 flex-col gap-4" data-testid="closing-room">
        <Head title={title} crumb={crumb} sub={sub} instrument={instrument} />
        <Strip steps={steps} phone={phone} />
        <div className="grid gap-3 sm:grid-cols-4" data-testid="closing-room-loading">{[0, 1, 2, 3].map((i) => <div key={i} className={`h-16 ${pulse}`} />)}</div>
        <div className={`h-40 ${pulse}`} />
      </div>
    );
  }

  const tiles = roomTiles(closing, papers);
  const view = captableView(closing, viewer);
  const needs = needsYou(rows, closing, viewer);
  const currency = closing.currency || 'USD';
  const openLine = (kind) => (r) => setDrawer({ kind, row: r, line: (closing.lines || []).find((l) => l.uid === r.uid) });
  const twoCol = phone ? 'flex flex-col gap-4' : 'grid grid-cols-[minmax(0,1fr)_320px] items-start gap-4';
  const papersFailed = rows.some((r) => r.paper === 'Could not be read');
  const openAccount = () => { setAccountNote(''); setDrawer({ kind: 'account' }); };
  // CP1's header strip: before the account is set, its door is in the header too.
  const headAction = viewer === 'founder' && account.state === 'none'
    ? <button type="button" className={`${BTN.primary} min-h-[44px]`} onClick={openAccount} data-testid="closing-head-account-set">{ACCOUNT_WORDS.set}</button> : null;

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="closing-room">
      <Head title={title} crumb={crumb} sub={sub} instrument={instrument} action={headAction} />
      <Strip steps={steps} phone={phone} />
      {papersFailed ? (
        <section className={box} data-testid="closing-papers-failed">
          <Unreadable what="A line’s paper" claim="Its paper and signed count show as not read, never as none." onRetry={retryPapers} />
        </section>
      ) : null}
      <div className={twoCol}>
          <div className="flex min-w-0 flex-col gap-4">
            <div className={`grid gap-3 ${phone ? 'grid-cols-2' : 'grid-cols-4'}`} data-testid="closing-tiles">
              <Tile label="Committed" value={<Money text={tiles.committed} reason="The round’s total was not returned." />} sub={`${tiles.lineCount} ${tiles.lineCount === 1 ? 'line' : 'lines'}`} testId="closing-tile-committed" />
              <Tile label="Executed" value={signedValue(tiles)} sub="lines" testId="closing-tile-signed" />
              <Tile label="Received" value={<Money text={tiles.received} />} sub={tiles.receivedOf} testId="closing-tile-received" />
              <Tile label="Closing deadline" value={tiles.deadline || <Unrecorded reason="No deadline is recorded on this closing." />} sub={tiles.left} testId="closing-tile-deadline" />
            </div>
            <LinesBlock rows={rows} phone={phone} onReceipt={openLine('receipt')} onSign={openLine('sign')} />
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            {viewer === 'admin' ? (
              <section className={box} data-testid="closing-admin-door">
                <h3 className="m-0 text-[15px] font-bold">The studio team’s acts</h3>
                <p className={mutedText}>Routes, paper, evidence, Axal’s acts and Mark Closed are on Contracts › Closings.</p>
                <Link className={`${BTN.primary} w-fit`} to={closingHrefFor(closing.deal_id)}>Open in Contracts › Closings</Link>
              </section>
            ) : viewer === 'founder' ? <AccountCard view={account} note={accountNote} phone={phone} onOpen={openAccount} onRetry={accountRead.retry} /> : null}
            {viewer === 'founder' ? <NeedsYou items={needs} onOpen={(it) => (it.line ? setDrawer({ kind: 'sign', row: it.line, line: (closing.lines || []).find((l) => l.uid === it.line.uid) }) : setDrawer({ kind: 'captable' }))} /> : null}
            <CaptableCard view={view} onOpen={() => setDrawer({ kind: 'captable' })} />
            <ReportingCard closing={closing} />
          </div>
        </div>
      {drawer?.kind === 'sign' ? (
        <SignDrawer row={drawer.row} envelope={liveEnvelope(papers[drawer.row.uid])} failed={papers[drawer.row.uid] === null} viewer={viewer} company={companyName} onClose={() => setDrawer(null)} />
      ) : null}
      {drawer?.kind === 'receipt' ? <ReceiptDrawer row={drawer.row} viewer={viewer} dealId={closing.deal_id} onClose={() => setDrawer(null)} /> : null}
      {drawer?.kind === 'account' && (account.state === 'none' || account.state === 'set') ? (
        <AccountDialog projectId={projectId} view={account} currency={currency} onClose={() => setDrawer(null)}
          onSaved={(result, had) => { setDrawer(null); setAccountNote(savedNote(result, had)); accountRead.retry(); }}
          onReload={() => { setDrawer(null); accountRead.retry(); }} />
      ) : null}
      {drawer?.kind === 'captable' ? (
        <CaptableDialog closing={closing} view={view} rows={rows} instrument={instrument} onClose={() => setDrawer(null)} onDone={() => { setDrawer(null); read.retry(); }} />
      ) : null}
    </div>
  );
}
