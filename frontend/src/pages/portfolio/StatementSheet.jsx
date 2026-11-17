/**
 * D6867 (#6867, canvas D6217 PF-13a, PF-13f to PF-13i): the Statement sheet
 * on Overview and Performance — choose a completed quarter-end, check the
 * preview, download one gross PDF. No route of its own.
 *
 * The chooser lists every completed quarter-end from the first cheque's year
 * to the reporting read's last completed quarter, newest first. The body for
 * a date is keyed by it, so changing the date reads that date afresh: its
 * analytics (cut at the date) and positions (marks cut at the date). A date
 * that answers with no book reads "No book · before the first cheque" and
 * cannot be downloaded. A failed read names itself, keeps the date and
 * retries that read only; nothing is downloaded.
 *
 * Download PDF is the one primary action. It reads the quarter-ends page 3
 * needs, then draws the file in the browser. Axal does not send it or keep a
 * copy, and the sheet says so. A cover note goes into the PDF only when
 * "Include as a cover note" is ticked, and it is printed as the investor's
 * own words.
 *
 * D6888 (#6888): Eadwyn's covering-note proposal for the chosen date sits in
 * the sheet's rail (PF-13a: Portfolio's rail slot, beside the sheet; PF-13h: a
 * collapsible card in the sheet at 390). Nothing runs until the investor
 * presses Propose. Edit ticks "Include as a cover note" and puts the proposal
 * in that box for the investor to edit; the PDF still takes the note only from
 * the box. Discard forgets it; nothing is sent and nothing is kept.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Check, ChevronDown, ChevronRight, Lock, X } from 'lucide-react';
import { api } from '../../lib/api';
import { usePortfolioReads } from './usePortfolioReads';
import StatementCoverNote from './StatementCoverNote.jsx';
import { SHAPES, day, quarterEndsBetween, quarterShape, readOf } from './portfolioModel';
import {
  ALL_POSITIONS, NO_POSITIONS, NO_QUARTER_YET, OWN_FILE, STATEMENT_BASIS, STATEMENT_PAGES, STATEMENT_QUARTERS,
  downloadedOf, previewOf, statementDatesOf,
} from './statementModel';
import './statement.css';

/** Draws and downloads the PDF; swapped out by tests. */
async function defaultExport(input) {
  const { exportPortfolioStatementPdf } = await import('../../lib/portfolioStatementPdf.js');
  return exportPortfolioStatementPdf(input);
}

function Preview({ date, preview, onRetry }) {
  if (preview.state === 'loading') {
    return <p className="pst-wait" role="status" data-testid="statement-preview-loading">Reading the book as of {day(date)}…</p>;
  }
  if (preview.state === 'unreadable') return null;
  if (preview.state === 'no_book') {
    return (
      <p className="pst-note" data-testid="statement-no-book">
        <b>No book · before the first cheque.</b> {preview.reason} Choose a later quarter-end.
      </p>
    );
  }
  return (
    <section className="pst-preview" aria-label={`Preview as of ${day(date)}`} data-testid="statement-preview">
      <p className="pst-eyebrow">Preview · as of {day(date)}</p>
      <dl className="pst-cards">
        {preview.cards.map((c) => (
          <div key={c.key} data-testid={`statement-card-${c.key}`}>
            <dt>{c.label}</dt>
            <dd>{c.value}</dd>
            {c.note ? <small>{c.note}</small> : null}
          </div>
        ))}
      </dl>
      <p className="pst-basis" data-testid="statement-basis">{STATEMENT_BASIS} · USD · Net returns: Not recorded</p>
      {preview.positionsState === 'unreadable' ? (
        <p className="pst-fail" data-testid="statement-positions-unreadable">
          <AlertTriangle size={14} aria-hidden="true" /> Positions as of {day(date)} could not be read, so the statement cannot be made.
          {' '}<button type="button" className="pf-link-button" onClick={() => onRetry('positions')} data-testid="button-statement-retry-positions">Try again</button>
        </p>
      ) : null}
      {preview.mismatch ? (
        <p className="pst-mismatch" data-testid="statement-mismatch">
          <b aria-hidden="true">!</b> {preview.mismatch.headline} {preview.mismatch.short}
          {preview.mismatch.after.length ? ` ${preview.mismatch.after.map((r) => r.name).join(', ')} ${preview.mismatch.after.length === 1 ? 'is' : 'are'} marked “Funded after ${day(date)}” on page 2.` : ''}
        </p>
      ) : null}
    </section>
  );
}

/**
 * Eadwyn's rail for the sheet (D6888): beside the sheet on a desktop, a
 * collapsible card inside it at 390 (statement.css). One mount, so the
 * proposal is the same at either width.
 */
function CoverNoteRail({ asOf, onEdit }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <aside className={`pst-rail${open ? ' is-open' : ''}`} aria-label="Eadwyn" data-testid="statement-eadwyn">
      <div className="pst-rail-head">
        <i aria-hidden="true">E</i><b>Eadwyn</b><small>Portfolio</small>
      </div>
      <button
        type="button"
        className="pst-rail-toggle"
        aria-expanded={open ? 'true' : 'false'}
        aria-controls={bodyId}
        onClick={() => setOpen((o) => !o)}
        data-testid="button-statement-eadwyn-toggle"
      >
        {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
        Eadwyn · covering note proposal
      </button>
      <div className="pst-rail-body" id={bodyId}>
        <StatementCoverNote asOf={asOf} onEdit={onEdit} />
      </div>
    </aside>
  );
}

/** One date's reads, the preview and the Download action. Keyed by the date. */
function DateBody({
  date, firstYear, investor, coverNote, preview: adminPreview, compliance, exporter, onDownloaded, onClose, children,
}) {
  const sources = useMemo(() => ({
    analytics: { call: () => api.positionsAnalytics(date), shape: quarterShape(date) },
    positions: { call: () => api.positionsList(date), shape: SHAPES.positions },
  }), [date]);
  const { reads, retry } = usePortfolioReads(sources);
  const preview = useMemo(() => previewOf(date, reads.analytics, reads.positions), [date, reads.analytics, reads.positions]);
  const [phase, setPhase] = useState('ready');
  const [failure, setFailure] = useState(null);
  const ready = preview.state === 'ok' && reads.positions.state === 'ok';

  const download = async () => {
    if (!ready || phase === 'producing') return;
    setPhase('producing');
    setFailure(null);
    // Page 3: one read per quarter-end, the chosen date's own read reused.
    const dates = quarterEndsBetween(firstYear, date).slice(-STATEMENT_QUARTERS).filter((d) => d !== date);
    const settled = await Promise.allSettled(dates.map((d) => api.positionsAnalytics(d)));
    const quarters = { [date]: reads.analytics };
    dates.forEach((d, i) => { quarters[d] = readOf(settled[i], quarterShape(d)); });
    try {
      const out = await exporter({
        date, analytics: reads.analytics, positions: reads.positions, quarters, compliance, investor, coverNote, preview: adminPreview, firstYear,
      });
      setPhase('ready');
      onDownloaded(out.pages);
    } catch (e) {
      setPhase('ready');
      setFailure(e && e.message && /could not be made from these reads/.test(e.message)
        ? 'Too many quarter-ends could not be read for page 3. Nothing was downloaded.'
        : 'The PDF could not be made. Nothing was downloaded.');
    }
  };

  const failed = [];
  if (reads.analytics.state === 'unreadable') failed.push(['analytics', `Performance as of ${day(date)}`]);
  return (
    <>
      {failed.length ? (
        <section className="pst-fail-box" role="alert" data-testid="statement-unreadable">
          <p><AlertTriangle size={14} aria-hidden="true" /> <b>{failed.map((f) => f[1]).join(', ')} could not be read.</b></p>
          <p>No statement was produced and nothing was downloaded: a statement with a missing section would mislead once it is passed on. As of {day(date)} is kept.</p>
          {failed.map(([key, name]) => (
            <button key={key} type="button" className="pf-btn" onClick={() => retry(key)} data-testid={`button-statement-retry-${key}`}>Try again · {name}</button>
          ))}
        </section>
      ) : <Preview date={date} preview={preview} onRetry={retry} />}
      {phase === 'producing' ? <p className="pst-wait" role="status" data-testid="statement-producing">Preparing your statement… Drawn in your browser; nothing is sent.</p> : null}
      {failure ? <p className="pst-fail" role="alert" data-testid="statement-production-failed"><X size={14} aria-hidden="true" /> {failure} As of {day(date)} is kept.</p> : null}
      {children}
      <footer className="pst-foot">
        <button type="button" className="pf-btn" onClick={onClose} data-testid="button-statement-cancel">Cancel</button>
        <button
          type="button"
          className="pf-btn is-primary"
          aria-disabled={!ready || phase === 'producing' ? 'true' : undefined}
          onClick={download}
          data-testid="button-statement-download"
        >
          Download PDF
        </button>
        {!ready && preview.state === 'loading' ? <span className="pf-foot" data-testid="statement-held">Download is held until the book as of {day(date)} is read.</span> : null}
      </footer>
    </>
  );
}

export default function StatementSheet({
  positions, compliance, investor, from = 'Overview', onClose, onRetry, exporter = defaultExport,
}) {
  const titleId = useId();
  const groupId = useId();
  const closeRef = useRef(null);
  const choices = useMemo(() => statementDatesOf(positions, compliance), [positions, compliance]);
  const [date, setDate] = useState(null);
  const [include, setInclude] = useState(false);
  const [noteText, setNoteText] = useState('');
  const noteRef = useRef(null);
  const [noteFocus, setNoteFocus] = useState(0);
  const [done, setDone] = useState(null);
  const chosen = date || (choices.state === 'ok' ? choices.dates[0].date : null);
  const adminPreview = positions.state === 'ok' && positions.value.scope?.rule === 'all_positions';
  const scope = positions.state === 'ok' ? [positions.value.scope?.text, positions.value.fund_scope?.text].filter(Boolean) : [];

  useEffect(() => { closeRef.current?.focus?.(); }, []);
  // Edit on Eadwyn's proposal: the box is ticked and holds the proposal, and the investor edits it there.
  useEffect(() => { if (noteFocus) noteRef.current?.focus?.(); }, [noteFocus]);
  const editProposal = (text) => {
    setInclude(true);
    setNoteText(text);
    setNoteFocus((n) => n + 1);
  };
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('keydown', onKey);
    return () => { if (typeof document !== 'undefined' && document.removeEventListener) document.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const empty = positions.state === 'ok' && positions.value.items.length === 0;
  let body;
  let railed = false;
  if (done) {
    const d = downloadedOf(done.date, done.pages);
    body = (
      <div className="pst-ok" role="status" data-testid="statement-downloaded">
        <p><Check size={15} aria-hidden="true" /> <b>{d.title}</b></p>
        <p>{d.line}</p>
        <p className="pf-foot">Performance opens at the same date, {day(done.date)}, so its figures should match page 1.</p>
        <div className="pst-actions">
          <button type="button" className="pf-btn" onClick={onClose} data-testid="button-statement-done">Done</button>
          <Link className="pf-btn is-primary" to={d.performance} data-testid="link-statement-performance">Open Performance as of {day(done.date)}</Link>
        </div>
      </div>
    );
  } else if (positions.state === 'loading' || compliance.state === 'loading') {
    body = <p className="pst-wait" role="status" data-testid="statement-loading">Loading the statement… Download is held until Positions, Performance and Reporting are read.</p>;
  } else if (empty) {
    body = (
      <div className="pst-empty" data-testid="statement-empty">
        <p><b>{NO_POSITIONS}</b></p>
        <p>Positions appear when the studio records an investment in a company you hold.</p>
        <Link className="pf-btn" to="/portfolio/positions" onClick={onClose} data-testid="link-statement-positions">Go to Positions</Link>
      </div>
    );
  } else if (choices.state === 'unreadable') {
    body = (
      <section className="pst-fail-box" role="alert" data-testid="statement-window-unreadable">
        <p><AlertTriangle size={14} aria-hidden="true" /> <b>{choices.reason}</b></p>
        <p>No statement was produced and nothing was downloaded.</p>
        {onRetry ? <button type="button" className="pf-btn" onClick={() => onRetry(choices.retry)} data-testid="button-statement-retry-window">Try again</button> : null}
      </section>
    );
  } else if (choices.state !== 'ok') {
    body = (
      <div className="pst-empty" data-testid="statement-no-quarter">
        <p><b>{NO_QUARTER_YET}</b></p>
        <p>{choices.reason} A statement can be made once a quarter has ended after your first cheque.</p>
      </div>
    );
  } else {
    railed = true;
    body = (
      <>
        <fieldset className="pst-dates">
          <legend id={groupId}>As of · quarter-end <small>completed quarters only</small></legend>
          <div role="radiogroup" aria-labelledby={groupId} className="pst-date-list">
            {choices.dates.map((d) => (
              <label key={d.date} className={`pst-date${d.date === chosen ? ' is-on' : ''}`} data-testid={`statement-date-${d.date}`}>
                <input type="radio" name="statement-as-of" value={d.date} checked={d.date === chosen} onChange={() => setDate(d.date)} />
                <span>{d.label}</span>
                {d.latest ? <small>Latest completed</small> : null}
              </label>
            ))}
          </div>
          <p className="pf-foot">From {day(choices.from)} (the first cheque’s year, {choices.firstYear}) to {day(choices.to)} (the reporting read’s last completed quarter).</p>
        </fieldset>
        <DateBody
            key={chosen}
            date={chosen}
            firstYear={choices.firstYear}
            investor={investor}
            coverNote={include ? noteText : null}
            preview={adminPreview}
            compliance={compliance}
            exporter={exporter}
            onClose={onClose}
            onDownloaded={(pages) => setDone({ date: chosen, pages })}
          >
        <CoverNoteRail asOf={chosen} onEdit={editProposal} />
        <section className="pst-toc" aria-label="What the PDF holds" data-testid="statement-toc">
          <p className="pst-eyebrow">The PDF holds · US Letter</p>
          <ol>{STATEMENT_PAGES.map((p) => <li key={p}>{p}</li>)}</ol>
        </section>
        <section className="pst-scope" data-testid="statement-scope">
          <p className="pst-eyebrow">What it counts</p>
          {(adminPreview ? [ALL_POSITIONS] : scope).map((s) => <p key={s}>{s}</p>)}
        </section>
        <section className="pst-cover" data-testid="statement-cover">
          <label className="pst-check">
            <input type="checkbox" checked={include} onChange={(e) => setInclude(e.target.checked)} data-testid="checkbox-statement-cover" />
            Include as a cover note
          </label>
          {include ? (
            <>
              <textarea
                ref={noteRef}
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                rows={4}
                maxLength={1200}
                aria-label="Cover note, in your own words"
                data-testid="input-statement-cover"
              />
              <small>Printed above the figures on page 1, marked as your own words, not Axal’s.</small>
            </>
          ) : null}
        </section>
        <p className="pst-own" data-testid="statement-own"><Lock size={13} aria-hidden="true" /> {OWN_FILE}</p>
        </DateBody>
      </>
    );
  }

  return (
    <div className={`pst-layer${railed ? ' has-rail' : ''}`} data-testid="statement-sheet-layer">
      <button type="button" className="pst-scrim" aria-label="Close the statement" onClick={onClose} tabIndex={-1} />
      <section className="pst-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid="statement-sheet">
        {adminPreview ? (
          <p className="pst-preview-banner" role="status" data-testid="statement-admin-preview">
            <Lock size={13} aria-hidden="true" /> Admin preview · {ALL_POSITIONS} Every page is marked “Preview, not for distribution”.
          </p>
        ) : null}
        <header className="pst-head">
          <div>
            <p className="pst-crumb">Portfolio · {from}</p>
            <h2 id={titleId}>Portfolio statement</h2>
            <p className="pf-foot">{done ? 'Downloaded.' : 'One PDF of your book as of a quarter-end, gross of fees and carry.'}</p>
          </div>
          <button type="button" ref={closeRef} className="pf-icon-button" onClick={onClose} aria-label="Close" data-testid="button-statement-close"><X size={15} aria-hidden="true" /></button>
        </header>
        <div className="pst-body">{body}</div>
      </section>
    </div>
  );
}
