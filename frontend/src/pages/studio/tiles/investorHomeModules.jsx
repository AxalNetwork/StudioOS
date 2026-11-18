/**
 * D6129 (#6129, canvas D6126 SM17 to SM25) — the bodies of Investor Studio
 * home v2's five modules: Needs you, Funds, Returns, Thesis fit on live deals
 * and Arrivals. Their rules are `pages/investor/investorHomeModel.js`; these
 * only draw them, inside the module frame (`StudioModuleTile`), which owns
 * loading, Unreadable, Not recorded, empty and the administrator's Withheld.
 *
 * Every state is a glyph and a word, never colour alone (D5129's vocabulary,
 * with "Unreadable" for a failed read until #5129's component is on main).
 * Styles are `investorHomeModules.css`, on the Studio's `--sm-*` tokens, so the
 * dark boards (SM27) follow the same tokens as the frame.
 */
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Banknote, Bell, BookOpen, Briefcase, Check, CircleAlert, CircleDashed, CircleMinus, FileChartColumn, FileText,
  Link2, MessageSquare, PenLine, ShieldCheck, TriangleAlert, X,
} from 'lucide-react';
import { PhoneSheet } from '../../../ui/phone/PhoneSheet.jsx';
import { THESIS_HREF } from '../../investor/InvestorThesisBand';
import { COMMITMENT } from '../../investor/investorHomeModel';
import './investorHomeModules.css';

const GLYPH = { call: Banknote, notice: FileText, trust: ShieldCheck, booklet: BookOpen, lpa: PenLine, inbox: Bell, link: Link2, update: MessageSquare, report: FileChartColumn, deals: Briefcase };
const Glyph = ({ kind }) => { const I = GLYPH[kind] || FileText; return <span className="ihs-gl" aria-hidden="true"><I size={15} /></span>; };

/** A failed read inside a module, alone, with Try again; never a zero or an empty list. */
export function SourceUnreadable({ text, onRetry, testId }) {
  return (
    <p className="ihs-unr" role="alert" data-testid={testId}>
      <CircleAlert size={14} aria-hidden="true" />
      <span>{text}</span>
      {onRetry && <button type="button" className="sm-btn sm-btn-s sm-btn-sm" onClick={onRetry}>Try again</button>}
    </p>
  );
}

/* --------------------------------------------------------------- Needs you */

function PayAction({ row }) {
  const [open, setOpen] = useState(false);
  const opener = useRef(null);
  return (
    <>
      {/* ⚑ D6126 "one primary per screen" is the owner's open question: Pay stays outlined and Customise keeps the header's primary until it is answered. */}
      <Link to={row.action.to} className="sm-btn sm-btn-s sm-btn-sm ihs-wide-only" data-testid={`link-needs-${row.key}`}>Pay</Link>
      <button ref={opener} type="button" className="sm-btn sm-btn-s ihs-narrow-only ihs-t44" onClick={() => setOpen(true)} data-testid={`button-needs-pay-${row.key}`}>Pay</button>
      {open && (
        <PhoneSheet title={row.pay.title} onClose={() => setOpen(false)} opener={opener}>
          <div className="ihs-sheet" data-testid={`sheet-needs-pay-${row.key}`}>
            {row.pay.lines.map(([k, v]) => <div className="ihs-kv" key={k}><span>{k}</span><span>{v}</span></div>)}
            <p className="ihs-sub">Axal does not move money from here. Pay from your bank, then the fund records it as received.</p>
            <Link to={COMMITMENT} className="sm-btn sm-btn-p ihs-t44 ihs-block">Open my commitment</Link>
          </div>
        </PhoneSheet>
      )}
    </>
  );
}

function DateCell({ date }) {
  if (!date) return <span />;
  if (date.overdue) return <span className="ihs-od"><TriangleAlert size={13} aria-hidden="true" />{date.text}</span>;
  if (date.missing) return <span className="ihs-nrec">{date.text}</span>;
  return <span className="ihs-nd">{date.text}{date.sub && <><br /><span className="ihs-mu">{date.sub}</span></>}</span>;
}

export function NeedsYouBody({ model, onRetry }) {
  const { rows, sources, callsUnreadable } = model;
  const label = { fund: 'Your fund records could not be read.', notices: 'Your fund notices could not be read.', booklet: 'Your subscription booklet could not be read.', trust: 'Your Trust requirements could not be read.', inbox: 'Unread count could not be read. It is never shown as 0.' };
  return (
    <div className="ihs-needs" data-testid="investor-needs-you">
      {rows.length > 0 && (
        <ol className="ihs-rows">
          {rows.map((row) => (
            <li key={row.key} className="ihs-nr" data-kind={row.kind} data-testid={`row-needs-${row.key}`}>
              <Glyph kind={row.kind} />
              <div className="ihs-ns"><b>{row.title}</b>{row.detail && <span>{row.detail}</span>}</div>
              <DateCell date={row.date} />
              <span className="ihs-act">{row.pay ? <PayAction row={row} /> : <Link to={row.action.to} className="sm-btn sm-btn-s sm-btn-sm ihs-t44m" data-testid={`link-needs-${row.key}`}>{row.action.label}</Link>}</span>
            </li>
          ))}
        </ol>
      )}
      {Object.entries(sources).map(([key, s]) => s.unreadable
        ? <SourceUnreadable key={key} text={label[key]} onRetry={() => onRetry(key)} testId={`status-needs-${key}-unreadable`} />
        : s.loading ? <p key={key} className="ihs-sub" role="status">Reading {key === 'inbox' ? 'your unread count' : key === 'trust' ? 'your Trust requirements' : key === 'booklet' ? 'your booklet' : `your fund ${key === 'fund' ? 'records' : 'notices'}`}…</p> : null)}
      {callsUnreadable && <SourceUnreadable text="Your capital calls could not be read." onRetry={() => onRetry('fund')} testId="status-needs-calls-unreadable" />}
      <p className="ihs-sub">Inbox counts every kind of notification; fund notices are listed one by one.</p>
    </div>
  );
}

/* ------------------------------------------------------------------- Funds */

const UNR = <span className="ihs-st ihs-un"><span aria-hidden="true" className="ihs-sq-x" />Unreadable</span>;
const cell = (known, value) => (known ? value : UNR);

function Bar({ row }) {
  if (!row.bar) return <span className="ihs-nrec">{row.callsKnown ? 'Not recorded' : 'Unreadable'}</span>;
  return <span className="ihs-bar" role="img" aria-label={row.barLabel}><i style={{ width: `${row.bar.called}%` }} /><b style={{ width: `${row.bar.received}%` }} /></span>;
}

function Lpa({ lpa }) {
  if (!lpa.signed) return <span className="ihs-od"><X size={12} aria-hidden="true" />Not signed</span>;
  return lpa.on ? <span>{lpa.on}</span> : <span className="ihs-nrec">Signed · date not recorded</span>;
}

const NO_PAID_IN = <span className="ihs-nrec">No paid-in capital yet</span>;
const ratio = (row, v) => (row.noPaidIn ? NO_PAID_IN : v ?? <span className="ihs-nrec">Not recorded</span>);

export function FundsBody({ funds, asAt, onRetry }) {
  const { rows, total, callsKnown, unlinked } = funds;
  return (
    <div className="ihs-funds" data-testid="investor-funds">
      {unlinked && <p className="ihs-sub"><Link to="/spinout-lab/investor-workspace">Open the LP workspace to link the rest of your commitments.</Link></p>}
      {!callsKnown && <SourceUnreadable text="Your capital calls could not be read. Committed and TVPI still show." onRetry={onRetry} testId="status-funds-calls-unreadable" />}
      <div className="ihs-funds-table">
        <table className="ihs-tb">
          <thead><tr><th scope="col">Fund</th><th scope="col">Committed</th><th scope="col">Called</th><th scope="col">Received</th><th scope="col">Due now</th><th scope="col">Uncalled</th><th scope="col" className="ihs-l">Called of committed</th><th scope="col">TVPI</th><th scope="col">DPI</th><th scope="col">LPA signed</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} data-testid={`row-fund-${r.key}`}>
                <th scope="row">{r.name}</th>
                <td>{r.committed ?? <span className="ihs-nrec">Not recorded</span>}</td>
                <td>{cell(r.callsKnown, r.called)}</td>
                <td>{cell(r.callsKnown, r.received)}</td>
                <td>{cell(r.callsKnown, r.dueCents > 0 ? <b>{r.due}</b> : r.due)}</td>
                <td>{cell(r.callsKnown, r.uncalled)}</td>
                <td className="ihs-l"><Bar row={r} /></td>
                {r.noPaidIn ? <td colSpan={2} className="ihs-c">{NO_PAID_IN}</td> : <><td>{ratio(r, r.tvpi)}</td><td>{ratio(r, r.dpi)}</td></>}
                <td><Lpa lpa={r.lpa} /></td>
              </tr>
            ))}
          </tbody>
          {total && (
            <tfoot><tr data-testid="row-fund-total">
              <th scope="row">All funds</th><td>{total.committed ?? <span className="ihs-nrec">Not recorded</span>}</td>
              <td>{cell(callsKnown, total.called)}</td><td>{cell(callsKnown, total.received)}</td><td>{cell(callsKnown, total.due)}</td><td>{cell(callsKnown, total.uncalled)}</td>
              <td /><td colSpan={2} className="ihs-mu">Per fund only</td><td />
            </tr></tfoot>
          )}
        </table>
      </div>
      <div className="ihs-funds-cards">
        {rows.map((r) => (
          <section key={r.key} className="ihs-fcard" aria-label={r.name}>
            <div className="ihs-fcard-h"><b>{r.name}</b>{r.lpa.signed ? <span className="ihs-mu">LPA signed {r.lpa.on ?? '· date not recorded'}</span> : <Lpa lpa={r.lpa} />}</div>
            <Bar row={r} />
            {[['Committed', r.committed ?? 'Not recorded', true], ['Called', r.called, r.callsKnown], ['Received', r.received, r.callsKnown], ['Due now', r.due, r.callsKnown], ['Uncalled', r.uncalled, r.callsKnown]].map(([k, v, known]) => <div className="ihs-kv" key={k}><span>{k}</span><span>{cell(known, v)}</span></div>)}
            <p className="ihs-fratio">{r.noPaidIn ? <span className="ihs-nrec">TVPI and DPI: No paid-in capital yet</span> : <><span>TVPI <b>{ratio(r, r.tvpi)}</b></span><span>DPI <b>{ratio(r, r.dpi)}</b></span></>}</p>
          </section>
        ))}
      </div>
      <div className="ihs-legend" aria-hidden="true"><span><i className="ihs-lg-r" />Received</span><span><i className="ihs-lg-c" />Called, not yet received</span><span><i className="ihs-lg-u" />Uncalled</span></div>
      <p className="ihs-sub">Gross. In dollars.{asAt ? ` As at ${asAt}.` : ''} Called and due are from your capital calls.</p>
    </div>
  );
}

/* ----------------------------------------------------------------- Returns */

function Figure({ label, fig }) {
  return (
    <div className="ihs-fig" data-testid={`figure-returns-${label.toLowerCase()}`}>
      <span className="ihs-l">{label}</span>
      {fig.state === 'value' && <span className="ihs-v">{fig.value}</span>}
      {fig.state === 'total_loss' && <><span className="ihs-v">{fig.value}</span><span className="ihs-st ihs-out"><ArrowDown />Total loss</span></>}
      {(fig.state === 'not_computed' || fig.state === 'not_recorded') && <>
        <span className="ihs-r ihs-nc"><CircleMinus size={12} aria-hidden="true" />{fig.state === 'not_computed' ? 'Not computed' : 'Not recorded'}</span>
        <span className="ihs-r">{fig.reason}</span>
      </>}
    </div>
  );
}
const ArrowDown = () => <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 4v13M6.5 11.5L12 17l5.5-5.5M5 21h14" /></svg>;

export function ReturnsBody({ returns }) {
  return (
    <div className="ihs-returns" data-testid="investor-returns">
      <p className="ihs-sub ihs-strong">{returns.heading}</p>
      <div className="ihs-figs">{returns.figures.map(([label, fig]) => <Figure key={label} label={label} fig={fig} />)}</div>
      <div>{returns.flows.map(([k, v]) => <div className="ihs-kv" key={k}><span>{k}</span><span>{v ?? <span className="ihs-nrec">Not recorded</span>}</span></div>)}</div>
      {returns.coverage && <p className="ihs-body">{returns.coverage}</p>}
      <p className="ihs-sub">Gross of fees and carry.</p>
    </div>
  );
}

/* -------------------------------------------------------------- Thesis fit */

const CHIP_GLYPH = { match: Check, outside: X, not_set: CircleDashed, not_recorded: CircleMinus };

function Chip({ chip, open, onToggle }) {
  const I = CHIP_GLYPH[chip.state];
  return (
    <button type="button" className={`ihs-st ihs-${chip.state}`} title={chip.reason} aria-expanded={open ? 'true' : 'false'}
      aria-label={`${chip.label} · ${chip.word}: ${chip.reason}`} onClick={onToggle} data-testid={`chip-fit-${chip.key}`}>
      <I size={12} aria-hidden="true" />{chip.label} · {chip.word}
    </button>
  );
}

function FitRow({ row, onRetry }) {
  const [open, setOpen] = useState(null);
  const name = row.to ? <Link to={row.to}>{row.name}</Link> : row.name;
  if (row.state === 'unavailable') return <li className="ihs-fr" data-testid={`row-fit-${row.key}`}><div className="ihs-co"><b>{row.name}</b></div><span className="ihs-st ihs-un" title="You can no longer read this deal"><span aria-hidden="true" className="ihs-sq-x" />Deal unavailable</span></li>;
  if (row.state === 'unreadable') return <li className="ihs-fr" data-testid={`row-fit-${row.key}`}><div className="ihs-co"><b>{name}</b><span className="ihs-sub">Its inputs could not be read</span></div><span className="ihs-fa"><span className="ihs-st ihs-un"><span aria-hidden="true" className="ihs-sq-x" />Unreadable</span><button type="button" className="sm-btn sm-btn-t sm-btn-sm" onClick={onRetry}>Try again</button></span></li>;
  const reason = open ? row.chips.find((c) => c.key === open) : null;
  return (
    <li className="ihs-fr" data-testid={`row-fit-${row.key}`}>
      <div className="ihs-co"><b>{name}</b><span className="ihs-sub">{row.meta}</span></div>
      <span className="ihs-ask">{row.ask}</span>
      <div className="ihs-fchips">{row.chips.map((c) => <Chip key={c.key} chip={c} open={open === c.key} onToggle={() => setOpen(open === c.key ? null : c.key)} />)}</div>
      {reason && <p className="ihs-sub ihs-reason" role="status">{reason.label} · {reason.word}: {reason.reason}</p>}
    </li>
  );
}

export function FitBody({ fit, onRetry }) {
  if (fit.notSet) {
    return (
      <div className="ihs-fit" data-testid="investor-fit-unset">
        <p className="ihs-strong">Set a thesis to see fit on live deals</p>
        <p className="ihs-sub">Until then every criterion would read Not set:</p>
        <div className="ihs-fchips">{['Sector', 'Stage', 'Region', 'Ticket'].map((l) => <span key={l} className="ihs-st ihs-not_set"><CircleDashed size={12} aria-hidden="true" />{l} · Not set</span>)}</div>
        <Link to={THESIS_HREF} className="sm-link">Set it in Settings ›</Link>
      </div>
    );
  }
  return (
    <div className="ihs-fit" data-testid="investor-fit">
      <ol className="ihs-rows">{fit.rows.map((row) => <FitRow key={row.key} row={row} onRetry={onRetry} />)}</ol>
      {/* Voice rule: the canvas's "Not a recommendation." is said without the word. */}
      <p className="ihs-sub">Fit against your thesis in Settings. No score and no ranking.</p>
    </div>
  );
}

/* ---------------------------------------------------------------- Arrivals */

export function ArrivalsBody({ arrivals, deals, onRetry }) {
  return (
    <div className="ihs-arrivals" data-testid="investor-arrivals">
      {arrivals.items.length > 0 && (
        <ol className="ihs-rows">
          {arrivals.items.map((a) => (
            <li key={a.key} className="ihs-ar" data-testid={`row-arrival-${a.key}`}>
              <Glyph kind={a.kind} />
              <div className="ihs-ns"><b>{a.title}</b><span className="ihs-mono">{a.date}</span></div>
              <Link to={a.action.to} className="sm-link ihs-t44m">{a.action.label} ›</Link>
            </li>
          ))}
        </ol>
      )}
      {arrivals.items.length === 0 && arrivals.unreadable.length === 0 && (
        <div data-testid="investor-arrivals-empty">
          <p className="ihs-strong">Nothing has arrived yet.</p>
          <p className="ihs-sub">Founder updates and fund reports appear here when they are sent. A failed read of issued reports looks the same as none issued.</p>
        </div>
      )}
      {arrivals.unreadable.map((what) => <SourceUnreadable key={what} text={`${what} could not be read. This is not a claim that none arrived.`} onRetry={onRetry} testId={`status-arrivals-${what.toLowerCase().replace(/\W+/g, '-')}-unreadable`} />)}
      {deals && (
        <div className="ihs-ar" data-testid="row-arrival-deals">
          <Glyph kind="deals" />
          <div className="ihs-ns">{deals.state === 'unreadable' ? <b>Deals offered to you could not be read</b> : <b>{deals.count === null ? 'Deals offered to you: Not recorded' : `${deals.count}${deals.lowerBound ? '+' : ''} ${deals.count === 1 ? 'deal' : 'deals'} offered to you`}</b>}<span className="ihs-sub">A count, not dated</span></div>
          <Link to="/deals" className="sm-link ihs-t44m">Open Deals ›</Link>
        </div>
      )}
      <p className="ihs-sub">No “new” badge: your last visit is not recorded.</p>
    </div>
  );
}
