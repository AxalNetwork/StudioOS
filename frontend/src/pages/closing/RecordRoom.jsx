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
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { closingsApi, stagedSigningApi } from '../../lib/api/closings';
import { mercuryInvestorApi } from '../../lib/api/mercuryInvestor';
import { reportingApi } from '../../lib/api/reporting';
import { Unreadable, Unrecorded, usePhoneWidth } from '../../ui';
import { BTN } from '../account/AccountCenter';
import { closingHrefFor, moneyCents } from './deskModel';
import { SyndicatePanel } from './RoutePanels';
import { CaptableDialog, MatchDialog, PaymentDrawer, ReceiptDrawer, SignDrawer } from './RoomDialogs';
import {
  NO_ACCESS, ROOM_FAILED, ROOM_WAITS, STEPS, captableView, dutyRows, liveEnvelope, matchesFor, needsYou, roomLines, roomTiles, stepStrip,
} from './roomModel';

const box = 'flex min-w-0 flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900';
const mutedText = 'm-0 text-[12.5px] text-gray-600 dark:text-gray-400';
const pulse = 'animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800';
const NOT_YET_PILL = 'w-fit rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[11px] font-bold text-gray-500 dark:border-gray-600 dark:text-gray-400';

function useLoad(run, deps, enabled = true) {
  const [state, setState] = useState({ status: enabled ? 'loading' : 'off', data: null, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) { setState({ status: 'off', data: null, error: null }); return undefined; }
    let live = true;
    setState({ status: 'loading', data: null, error: null });
    run().then((data) => { if (live) setState({ status: 'ok', data, error: null }); }, (error) => { if (live) setState({ status: 'error', data: null, error }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled, tick]);
  return { ...state, retry: () => setTick((n) => n + 1) };
}

/** Each commitment line's staged envelopes, one read per line: an array, null when that read failed, absent while it is read. */
function usePapers(lines) {
  const ids = (Array.isArray(lines) ? lines : []).filter((l) => l.commitment_id != null).map((l) => [l.uid, l.commitment_id]);
  const key = ids.map((x) => x.join(':')).join(',');
  const [papers, setPapers] = useState({});
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setPapers({});
    for (const [uid, id] of ids) {
      stagedSigningApi.line(id).then(
        (r) => { if (live) setPapers((p) => ({ ...p, [uid]: Array.isArray(r?.envelopes) ? r.envelopes : [] })); },
        () => { if (live) setPapers((p) => ({ ...p, [uid]: null })); },
      );
    }
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);
  return { papers, retry: () => setTick((n) => n + 1) };
}

const Money = ({ text, reason }) => (text ? <span className="tabular-nums">{text}</span> : <Unrecorded reason={reason} />);

export function NoAccess({ text, back }) {
  return (
    <section className={`${box} max-w-[420px]`} data-testid="closing-no-access">
      <span aria-hidden="true" className="inline-grid h-8 w-8 place-items-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">🔒</span>
      <h2 className="m-0 text-[15px] font-bold">{text}</h2>
      {back}
    </section>
  );
}

function Head({ title, crumb, sub, instrument }) {
  return (
    <header className="flex flex-col gap-1" data-testid="closing-head">
      <p className="m-0 text-[12px] font-semibold text-gray-500 dark:text-gray-400">{crumb}</p>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="m-0 text-[19px] font-extrabold tracking-tight">{title}</h2>
        {instrument ? <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-bold text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">{instrument}</span> : null}
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

const signedValue = (t) => (t.signed ?? (t.signedRead === 'reading' ? 'Reading…' : <Unrecorded reason="A line’s paper could not be read, so the signed count is not shown." />));

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
            <p className={mutedText}>{r.route || 'No route set'} · {r.paper} · {r.status}</p>
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
              <td>{r.commitmentId != null ? <button type="button" className={BTN.link} onClick={() => onSign(r)} data-testid={`closing-line-paper-${r.uid}`}>{r.paper}</button> : r.paper}</td>
              <td><button type="button" className={BTN.link} onClick={() => onReceipt(r)} data-testid={`closing-line-money-${r.uid}`}>{r.status}</button></td>
              <td><NextWords next={r.next} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function AccountCard() {
  return (
    <section className={box} data-testid="closing-account">
      <h3 className="m-0 text-[15px] font-bold">Your company’s receiving account</h3>
      <span className={NOT_YET_PILL}>Not read here yet</span>
      <p className={mutedText}>{ROOM_WAITS.account}</p>
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

function CaptableCard({ view, onOpen }) {
  return (
    <section className={box} data-testid="closing-captable">
      <h3 className="m-0 text-[15px] font-bold">Cap table change</h3>
      <p className={mutedText}>{view.text}</p>
      {view.canDecide ? <button type="button" className={`${BTN.primary} w-fit`} onClick={onOpen} data-testid="closing-captable-open">Review the change</button> : null}
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

/** CP2's "From Mercury": the investor's own proposals that fit their lines. Accepting records Sent, not yet confirmed. */
function MercuryCard({ lines, currency, company, phone, onAccepted }) {
  const read = useLoad(() => mercuryInvestorApi.proposals('closing'), []);
  const [open, setOpen] = useState(null);
  const matches = read.status === 'ok' ? matchesFor(read.data?.proposals, lines) : [];
  return (
    <section className={box} data-testid="closing-mercury">
      <div className="flex items-center gap-2"><h3 className="m-0 text-[15px] font-bold">From Mercury</h3><span className="flex-1" /><span className="text-[11.5px] font-semibold text-violet-700 dark:text-violet-300">Connector</span></div>
      {read.status === 'loading' ? <div className={`h-12 ${pulse}`} />
        : read.status === 'error' ? <Unreadable what="Your Mercury" claim="The rest of the closing room still shows. A block that could not be read is never shown as zero." onRetry={read.retry} />
          : matches.length === 0 ? <p className={mutedText} data-testid="closing-mercury-none">No payment from your Mercury fits this line yet. A match appears here after your Mercury is read.</p>
            : matches.map((m) => (
              <div key={m.uid} className="flex flex-col gap-2 border-t border-gray-100 pt-2 dark:border-gray-800" data-testid={`closing-match-${m.uid}`}>
                <p className="m-0 text-[13px]">A payment of <Money text={moneyCents(m.cents, currency)} reason="Mercury gave no amount." /> on {m.postedOn || 'a day not recorded'}{m.lastFour ? ` from ••••${m.lastFour}` : ''} fits this commitment.</p>
                <button type="button" className={`${BTN.ghost} ${phone ? 'min-h-[44px] w-full' : 'w-fit'}`} onClick={() => setOpen(m)} data-testid={`closing-match-open-${m.uid}`}>Review the match</button>
              </div>
            ))}
      <p className={mutedText}>Accepting records it as Sent, not yet confirmed, from your Mercury. {company}’s bank confirms receipt.</p>
      {open ? <MatchDialog match={open} currency={currency} company={company} onClose={() => setOpen(null)} onDone={() => { setOpen(null); read.retry(); onAccepted?.(); }} /> : null}
    </section>
  );
}

/** CP2, CP20: the investor's own line, the round's total, and what they can do. */
function InvestorLine({ closing, rows, tiles, phone, onSign, onPay, onReceipt }) {
  const mine = rows.filter((r) => !r.withdrawn);
  const first = mine[0];
  const full = phone ? 'min-h-[48px] w-full' : 'w-fit';
  return (
    <section className={`${box} gap-4`} data-testid="closing-your-line">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="m-0 text-[17px] font-extrabold">Your line{first?.route ? ` · ${first.route}` : ''}</h3>
          {mine.length > 1 ? <p className={mutedText}>{mine.length} lines of yours in this round.</p> : null}
        </div>
        <span className="font-mono text-[22px] font-bold tabular-nums" data-testid="closing-your-amount"><Money text={tiles.mine} reason="No amount is recorded on your line." /></span>
      </div>
      {mine.length === 0 ? <p className={mutedText}>Your line in this round was withdrawn.</p> : (
        <div className={`grid gap-2 ${phone ? 'grid-cols-1' : 'grid-cols-3'}`}>
          {[['Paper', first.paper], ['Money', first.status], ['Route', first.route || 'No route set']].map(([k, v]) => (
            <div key={k} className="flex flex-col gap-1 rounded-lg border border-gray-200 p-3 dark:border-gray-800" data-testid={`closing-your-${k.toLowerCase()}`}>
              <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400">{k}</span>
              <span className="text-[13px] font-semibold">{v}</span>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-1" data-testid="closing-round">
        <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400">Round</span>
        <span className="text-[13px]">Round: <Money text={tiles.committed} reason="The round’s total was not returned." /> committed</span>
        <p className={mutedText}>Other investors in the round are not shown to you.</p>
      </div>
      {first ? (
        <div className="flex flex-col gap-3" data-testid="closing-you-can">
          <span className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400">What you can do</span>
          <div className="flex flex-col gap-1.5 border-t border-gray-100 pt-2 dark:border-gray-800">
            <span className="text-[13px] font-semibold">Review and sign</span>
            <p className={mutedText}>{first.next.text === 'Your turn: sign' ? 'Your turn. Open the signing order, then sign on the e-sign page.' : first.paper}</p>
            {first.commitmentId != null ? <button type="button" className={`${first.next.text === 'Your turn: sign' ? BTN.primary : BTN.ghost} ${full}`} onClick={() => onSign(first)} data-testid="closing-review-sign">Review and sign</button> : null}
          </div>
          <div className="flex flex-col gap-1.5 border-t border-gray-100 pt-2 dark:border-gray-800">
            <span className="text-[13px] font-semibold">See payment instructions</span>
            <p className={mutedText}>The account {closing.companyName} set, with the payment warning first.</p>
            <button type="button" className={`${BTN.ghost} ${full}`} onClick={onPay} data-testid="closing-see-instructions">See payment instructions</button>
          </div>
          <div className="flex flex-col gap-1.5 border-t border-gray-100 pt-2 dark:border-gray-800">
            <span className="text-[13px] font-semibold">I have sent it</span>
            <p className={mutedText} data-testid="closing-sent-word">{ROOM_WAITS.sentWord} The line is Received when {closing.companyName}’s bank confirms it.</p>
            <button type="button" className={`${BTN.link} w-fit`} onClick={() => onReceipt(first)}>See the evidence on your line</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/**
 * The room from the closings store. `entry` is the deal's closing from
 * `GET /api/closings`; `viewer` is founder, investor or admin.
 */
export default function RecordRoom({ entry, viewer, deal }) {
  const phone = usePhoneWidth();
  const read = useLoad(() => closingsApi.read(entry.uid), [entry.uid]);
  const closing = read.status === 'ok' ? read.data : null;
  const { papers, retry: retryPapers } = usePapers(closing?.lines);
  const [drawer, setDrawer] = useState(null);
  const companyName = entry.project_name || deal?.project_name || 'The company';
  const title = `Closing · ${companyName}${entry.round_label ? ` ${entry.round_label}` : ''}`;
  const crumb = viewer === 'founder' ? 'Raise › Capital relationships › Closing' : viewer === 'admin' ? 'Deals › Closing · as the studio team reads it' : `Deals › ${companyName} › Closing`;
  const sub = viewer === 'investor' ? 'Your line in this round: the paper, the payment and the cap table.' : 'One place for the paper, the money and the cap table of this round.';
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
  const ctx = { ...closing, companyName };
  const openLine = (kind) => (r) => setDrawer({ kind, row: r, line: (closing.lines || []).find((l) => l.uid === r.uid) });
  const twoCol = phone ? 'flex flex-col gap-4' : 'grid grid-cols-[minmax(0,1fr)_320px] items-start gap-4';
  const papersFailed = rows.some((r) => r.paper === 'Could not be read');

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="closing-room">
      <Head title={title} crumb={crumb} sub={sub} instrument={instrument} />
      <Strip steps={steps} phone={phone} />
      {papersFailed ? (
        <section className={box} data-testid="closing-papers-failed">
          <Unreadable what="A line’s paper" claim="Its paper and signed count show as not read, never as none." onRetry={retryPapers} />
        </section>
      ) : null}
      {viewer === 'investor' ? (
        <div className={twoCol}>
          <div className="flex min-w-0 flex-col gap-4">
            <InvestorLine closing={ctx} rows={rows} tiles={tiles} phone={phone} onSign={openLine('sign')} onPay={() => setDrawer({ kind: 'pay' })} onReceipt={openLine('receipt')} />
            {(closing.lines || []).filter((l) => l.route === 'syndicate' && l.vehicle_ref).map((l) => <SyndicatePanel key={l.uid} line={l} currency={currency} />)}
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <MercuryCard lines={closing.lines} currency={currency} company={companyName} phone={phone} onAccepted={read.retry} />
            <CaptableCard view={view} onOpen={() => setDrawer({ kind: 'captable' })} />
            {closing.status === 'closed' ? (
              <section className={box} data-testid="closing-reporting">
                <h3 className="m-0 text-[15px] font-bold">Reporting</h3>
                <span className={NOT_YET_PILL}>Not read here yet</span>
                <p className={mutedText}>{ROOM_WAITS.investorReporting}</p>
              </section>
            ) : null}
          </div>
        </div>
      ) : (
        <div className={twoCol}>
          <div className="flex min-w-0 flex-col gap-4">
            <div className={`grid gap-3 ${phone ? 'grid-cols-2' : 'grid-cols-4'}`} data-testid="closing-tiles">
              <Tile label="Committed" value={<Money text={tiles.committed} reason="The round’s total was not returned." />} sub={`${tiles.lineCount} ${tiles.lineCount === 1 ? 'line' : 'lines'}`} testId="closing-tile-committed" />
              <Tile label="Signed" value={signedValue(tiles)} sub="lines" testId="closing-tile-signed" />
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
            ) : <AccountCard />}
            {viewer === 'founder' ? <NeedsYou items={needs} onOpen={(it) => (it.line ? setDrawer({ kind: 'sign', row: it.line, line: (closing.lines || []).find((l) => l.uid === it.line.uid) }) : setDrawer({ kind: 'captable' }))} /> : null}
            <CaptableCard view={view} onOpen={() => setDrawer({ kind: 'captable' })} />
            <ReportingCard closing={closing} />
          </div>
        </div>
      )}
      {drawer?.kind === 'sign' ? (
        <SignDrawer row={drawer.row} envelope={liveEnvelope(papers[drawer.row.uid])} failed={papers[drawer.row.uid] === null} viewer={viewer} company={companyName} onClose={() => setDrawer(null)} />
      ) : null}
      {drawer?.kind === 'receipt' ? <ReceiptDrawer row={drawer.row} viewer={viewer} dealId={closing.deal_id} onClose={() => setDrawer(null)} /> : null}
      {drawer?.kind === 'pay' ? <PaymentDrawer company={companyName} amount={tiles.mine} onClose={() => setDrawer(null)} /> : null}
      {drawer?.kind === 'captable' ? (
        <CaptableDialog closing={closing} view={view} rows={rows} instrument={instrument} onClose={() => setDrawer(null)} onDone={() => { setDrawer(null); read.retry(); }} />
      ) : null}
    </div>
  );
}
