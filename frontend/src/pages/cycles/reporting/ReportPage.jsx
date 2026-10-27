/**
 * D1060 (#2930) — one report at `/grow/reporting/:id` and its builder at
 * `/grow/reporting/:id/edit`, over part 3's routes (D1059).
 *
 *   THE BUILDER (RPT3–RPT5, RPT19a): a draft, for the founders only. Opening
 *   it saves it once with no change, which reads every figure again from the
 *   Grow modules (D1059 §4: "each save re-reads the stores"); a module that
 *   cannot be read says so and the others still answer. Four steps:
 *   Figures by module with source chips (a required figure left out asks for
 *   the reason the investor reads), Narrative and documents (Eadwyn's lines
 *   through AUTOFILL's Accept rule, #2431), Recipients, and Preview as each
 *   group. Send's dialog lists what it meets and what it leaves out.
 *
 *   THE SENT REPORT (RPT6): who received and opened it, the revision strip,
 *   the report as frozen, and Correct, which opens the next revision's draft.
 *   Anyone else the Worker lets read a sent report (an admin, an advisor or a
 *   partner of the venture) reads it with "Read only" (RPT14, RPT15).
 *
 * D1062 (#2932), at phone width (RPT20b): the builder is one step to the
 * screen ("Step 2 of 4 · Narrative and documents", the step before one press
 * back), with Save draft and Next pinned to the bottom; Send's dialog is a
 * bottom sheet (RPT20c).
 *
 * The page sends choices, never a figure's value: every value is the
 * Worker's, read from its store. The founders' typed figures are labelled
 * "Typed · entered by [company]".
 */
import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { reportingApi } from '../../../lib/api/reporting.js';
import { shareUpdateApi } from '../../../lib/api/shareUpdate.js';
import { reportError } from '../../../lib/log';
import { Unreadable } from '../../../ui';
import { CycleBar } from '../PhoneModulePage';
import { BAR_GHOST, BAR_PRIMARY, CARD, H2, MUTED, PinnedBar } from './DeskBlocks.jsx';
import {
  LINE_KINDS, NO_NETWORK, STEPS, acceptable, canInclude, choiceFor, documentError, draftNote, figureGroups, ownLine, proposals, readiness,
  readinessLine, reasonOf, recipientRows, recipientStatus, reportHref, revisionStrip, sentLine, sizeWords, sourceChip, sourceLine,
  unreadableTitles, valueText,
} from './builderModel.js';
import { shortDay } from './deskModel.js';
import { CorrectDialog, SendDialog } from './ReportingDialogs.jsx';

const EYE = 'text-[10.5px] font-bold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const FIELD = 'w-full rounded-[9px] border border-axal-hairline bg-white px-3 py-2 text-[13px] text-axal-ink dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
const BTN = 'inline-flex w-fit items-center rounded-[9px] bg-axal-violet px-3 py-1.5 text-[12.5px] font-bold text-white hover:bg-axal-violet-deep disabled:opacity-60 dark:hover:bg-violet-500';
const GHOST = 'inline-flex w-fit items-center rounded-[9px] border border-axal-hairline bg-white px-3 py-1.5 text-[12.5px] font-bold text-axal-ink hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const CHIP = 'inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[11px] font-bold';
const LAV = 'border-axal-lavender-edge bg-axal-lavender text-axal-violet-deep dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-200';
const AMBER = 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200';
const REFUSED = 'm-0 text-[12.5px] text-red-700 dark:text-red-300';
const UNITS = [['usd', 'US dollars'], ['pct', 'Percent'], ['count', 'Count'], ['months', 'Months']];

const typedOf = (figures) => (figures || []).filter((f) => f.typed && f.value != null).map((f) => ({ label: f.label, value: f.value, unit: f.unit, as_of: f.as_of }));

/** A figure's value, or a dash with its reason: never 0 for a missing value. */
function Value({ f, testId }) {
  const v = f.team_only && !f.shared && f.value == null ? null : valueText(f);
  return v
    ? <span className="text-[15px] font-extrabold text-axal-ink dark:text-gray-100" data-testid={testId}>{v}</span>
    : <span className="text-[13px] text-axal-muted dark:text-gray-400" data-testid={testId}>— <span className="text-[12px]">{reasonOf(f)}</span></span>;
}

/** One figure in the builder: its value and source, in or out, its share, and a required figure's reason. */
function FigureRow({ f, company, onChoose, busy }) {
  const [reason, setReason] = useState(f.left_out_reason || '');
  useEffect(() => { setReason(f.left_out_reason || ''); }, [f.left_out_reason]);
  const out = !f.included;
  return (
    <li className="flex flex-col gap-1.5 border-t border-axal-hairline py-2.5 first:border-t-0 dark:border-gray-800" data-testid={`reporting-figure-${f.key}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{f.label}</span>
          <span className={MUTED}>{f.typed ? 'Typed by your team' : f.required ? 'Required by a duty this report meets' : 'Optional'}</span>
          <span className={`${CHIP} ${f.team_only && !f.shared ? LAV : 'border-axal-hairline text-axal-muted dark:border-gray-700 dark:text-gray-400'}`} data-testid={`reporting-figure-${f.key}-source`}>{sourceChip(f, company)}</span>
        </div>
        <Value f={f} testId={`reporting-figure-${f.key}-value`} />
      </div>
      {!f.typed && (
        <div className="flex flex-wrap items-center gap-3 text-[12.5px]">
          {f.team_only && f.value != null && (
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={!!f.shared} disabled={busy} onChange={(e) => onChoose(choiceFor(f, { share: e.target.checked, include: e.target.checked }))} data-testid={`reporting-figure-${f.key}-share`} />
              Share from my Mercury
            </label>
          )}
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={!!f.included} disabled={busy || (!f.included && !canInclude(f))} onChange={(e) => onChoose(choiceFor(f, { include: e.target.checked }))} data-testid={`reporting-figure-${f.key}-include`} />
            In the report
          </label>
        </div>
      )}
      {f.required && out && (
        <label className="flex flex-col gap-1">
          <span className={EYE}>Why it is left out · the investor reads this</span>
          <input type="text" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Write a reason…" className={FIELD}
            onBlur={() => { if (reason.trim() !== (f.left_out_reason || '')) onChoose(choiceFor(f, { reason: reason.trim() || null })); }} data-testid={`reporting-figure-${f.key}-reason`} />
          {!reason.trim() && <span className="text-[12px] text-amber-800 dark:text-amber-200">Send refuses a required figure left out with no reason.</span>}
        </label>
      )}
    </li>
  );
}

/** RPT3 a figure no source holds: the founders type it, and it reads "Typed · entered by [company]". */
function AddTyped({ onAdd, busy, count }) {
  const [t, setT] = useState({ label: '', value: '', unit: 'count', as_of: '' });
  const n = Number(t.value);
  const ready = t.label.trim() && t.value !== '' && Number.isFinite(n) && /^\d{4}-\d{2}-\d{2}$/.test(t.as_of) && count < 8;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-axal-hairline p-3 dark:border-gray-700" data-testid="reporting-typed-add">
      <span className={EYE}>Add a figure no source holds</span>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
        <input aria-label="Name" placeholder="Name" maxLength={60} value={t.label} onChange={(e) => setT({ ...t, label: e.target.value })} className={FIELD} data-testid="reporting-typed-label" />
        <input aria-label="Value" placeholder="Value" inputMode="decimal" value={t.value} onChange={(e) => setT({ ...t, value: e.target.value })} className={FIELD} data-testid="reporting-typed-value" />
        <select aria-label="Unit" value={t.unit} onChange={(e) => setT({ ...t, unit: e.target.value })} className={FIELD}>{UNITS.map(([k, w]) => <option key={k} value={k}>{w}</option>)}</select>
        <input aria-label="Date" type="date" value={t.as_of} onChange={(e) => setT({ ...t, as_of: e.target.value })} className={FIELD} data-testid="reporting-typed-date" />
      </div>
      <button type="button" className={GHOST} disabled={!ready || busy} onClick={() => { onAdd({ label: t.label.trim(), value: n, unit: t.unit, as_of: t.as_of }); setT({ label: '', value: '', unit: 'count', as_of: '' }); }} data-testid="reporting-typed-go">Add figure</button>
      <p className={MUTED}>It shows Typed · entered by your company, so investors can tell it apart from connected figures. At most eight.</p>
    </div>
  );
}

function FiguresStep({ report, company, unreadable, save, busy }) {
  const groups = figureGroups(report.figures);
  const r = readiness(report.figures);
  const u = unreadableTitles(unreadable);
  const typed = typedOf(report.figures);
  return (
    <div className="flex flex-col gap-3" data-testid="reporting-step-figures">
      {u.length > 0 && (
        <p className={`m-0 rounded-lg border px-3 py-2 text-[12.5px] ${AMBER}`} data-testid="reporting-unreadable">Unreadable: {u.join(', ')} could not be read. The rest is ready. Its figures read Not recorded until it answers; open the report again to read it again.</p>
      )}
      {groups.map((g) => (
        <section key={g.module} className={CARD} data-testid={`reporting-module-${g.module}`}>
          <span className={EYE}>{g.module === 'typed' ? 'Typed' : 'Grow module'}</span>
          <h2 className={H2}>{g.title}</h2>
          <ul className="m-0 list-none p-0">
            {g.figures.map((f) => (
              <React.Fragment key={f.key}>
                <FigureRow f={f} company={company} busy={busy} onChoose={(c) => save({ figures: [c] })} />
                {f.typed && <li className="pb-2"><button type="button" className={GHOST} disabled={busy} onClick={() => save({ typed: typed.filter((x) => !(x.label === f.label && x.as_of === f.as_of && x.value === f.value)) })}>Remove {f.label}</button></li>}
              </React.Fragment>
            ))}
          </ul>
        </section>
      ))}
      <AddTyped busy={busy} count={typed.length} onAdd={(t) => save({ typed: [...typed, t] })} />
      <p className={MUTED} data-testid="reporting-readiness-line">{readinessLine(r, unreadable)}</p>
    </div>
  );
}

/** RPT4 the narrative: the title, Eadwyn's proposals, the lines in the report, and the founders' own words. */
function NarrativeStep({ report, projectId, save, busy }) {
  const [title, setTitle] = useState(report.title || '');
  const [words, setWords] = useState(report.body || '');
  const [draft, setDraft] = useState(null);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState('');
  const [waiting, setWaiting] = useState([]);
  const [own, setOwn] = useState({ field: 'highlights', text: '' });
  const lines = { highlights: report.highlights || [], lowlights: report.lowlights || [] };
  const ask = async () => {
    setDrafting(true); setDraftError('');
    try {
      const d = await shareUpdateApi.draftLines(projectId, report.period.start, report.period.end);
      setDraft(d); setWaiting(proposals(d));
    } catch (e) { reportError('ReportPage:draftLines', e); setDraftError(e?.message || 'Eadwyn could not draft this time. Write the lines by hand.'); } finally { setDrafting(false); }
  };
  const accept = async (p) => {
    if (!acceptable(p)) return;
    const ok = await save({ [p.field]: [...lines[p.field], { text: p.text.trim(), source: p.source }] });
    if (ok) setWaiting((xs) => xs.filter((x) => x.key !== p.key));
  };
  const remove = (field, i) => save({ [field]: lines[field].filter((_, j) => j !== i) });
  return (
    <div className="flex flex-col gap-3" data-testid="reporting-step-narrative">
      <section className={CARD}>
        <label className="flex flex-col gap-1"><span className={EYE}>Title</span>
          <input value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} onBlur={() => { if (title.trim() && title.trim() !== report.title) save({ title: title.trim() }); }} className={FIELD} data-testid="reporting-title" />
        </label>
      </section>
      <section className={CARD} data-testid="reporting-eadwyn">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className={H2}>Eadwyn’s lines</h2>
          <button type="button" className={GHOST} onClick={ask} disabled={drafting} data-testid="reporting-eadwyn-draft">{drafting ? 'Drafting…' : 'Draft lines from my data'}</button>
        </div>
        <p className={MUTED}>Eadwyn drafts only from this period’s stored data, and every line cites its source. A line lands only when you accept it; a line with no source cannot be accepted.</p>
        {draftError && <p className={REFUSED} role="alert">{draftError}</p>}
        {draft && <p className={MUTED} data-testid="reporting-eadwyn-note">{draftNote(draft)}</p>}
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {waiting.map((p) => (
            <li key={p.key} className={`flex flex-col gap-1 rounded-lg border p-2.5 ${LAV}`} data-testid="reporting-proposal">
              <span className={EYE}>{LINE_KINDS[p.field]} · proposed by Eadwyn</span>
              <textarea rows={2} maxLength={400} value={p.text} onChange={(e) => setWaiting((xs) => xs.map((x) => (x.key === p.key ? { ...x, text: e.target.value, edited: true } : x)))} className={FIELD} aria-label="Edit the line" />
              <span className="text-[12px]">{p.edited ? 'Edited by you · ' : ''}{p.source?.label ? `from ${sourceLine(p)}` : 'No source in your stored data · a line with no source cannot be accepted'}</span>
              <div className="flex gap-2">
                <button type="button" className={BTN} disabled={busy || !acceptable(p)} onClick={() => accept(p)} data-testid="reporting-proposal-accept">Accept</button>
                <button type="button" className={GHOST} onClick={() => setWaiting((xs) => xs.filter((x) => x.key !== p.key))} data-testid="reporting-proposal-dismiss">Dismiss</button>
              </div>
            </li>
          ))}
        </ul>
      </section>
      {['highlights', 'lowlights'].map((field) => (
        <section key={field} className={CARD} data-testid={`reporting-lines-${field}`}>
          <h2 className={H2}>{LINE_KINDS[field]}s in the report</h2>
          {lines[field].length ? (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {lines[field].map((l, i) => (
                <li key={`${field}-${i}`} className="flex flex-wrap items-start justify-between gap-2 border-t border-axal-hairline pt-1.5 first:border-t-0 dark:border-gray-800">
                  <span className="flex flex-col"><span className="text-[13px] text-axal-ink dark:text-gray-100">{l.text}</span><span className={MUTED}>{sourceLine(l)}</span></span>
                  <button type="button" className={GHOST} disabled={busy} onClick={() => remove(field, i)}>Remove</button>
                </li>
              ))}
            </ul>
          ) : <p className={MUTED}>None yet.</p>}
        </section>
      ))}
      <section className={CARD}>
        <span className={EYE}>Add a line in your words</span>
        <div className="flex flex-wrap gap-2">
          <select aria-label="Kind" value={own.field} onChange={(e) => setOwn({ ...own, field: e.target.value })} className={`${FIELD} w-auto`}>
            {Object.entries(LINE_KINDS).map(([k, w]) => <option key={k} value={k}>{w}</option>)}
          </select>
          <input aria-label="Line" maxLength={400} value={own.text} onChange={(e) => setOwn({ ...own, text: e.target.value })} className={`${FIELD} min-w-[220px] flex-1`} data-testid="reporting-own-line" />
          <button type="button" className={GHOST} disabled={busy || !own.text.trim()} onClick={async () => { if (await save({ [own.field]: [...lines[own.field], ownLine(own.text.trim())] })) setOwn({ ...own, text: '' }); }} data-testid="reporting-own-line-go">Add</button>
        </div>
        <p className={MUTED}>Your own lines cite “Written by the founders”.</p>
      </section>
      <section className={CARD}>
        <label className="flex flex-col gap-1"><span className={EYE}>In your words · optional</span>
          <textarea rows={5} maxLength={4000} value={words} onChange={(e) => setWords(e.target.value)} onBlur={() => { if (words.trim() !== (report.body || '')) save({ body: words.trim() || null }); }} placeholder="Write to your investors…" className={FIELD} data-testid="reporting-body" />
        </label>
        <p className={MUTED}>Every recipient reads it as you write it.</p>
      </section>
      <Documents report={report} onChanged={() => save({})} />
    </div>
  );
}

/** Statements: PDFs on the draft (at most ten, 6 MB each), read back private and no-store. */
function Documents({ report, onChanged, sent = false }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef(null);
  const attach = (file) => {
    const bad = documentError(file);
    if (bad) { setError(bad); return; }
    setBusy(true); setError('');
    const reader = new FileReader();
    reader.onerror = () => { setBusy(false); setError('The file could not be read. Nothing was attached.'); };
    reader.onload = async () => {
      try { await reportingApi.attachReportDocument(report.uid, { filename: file.name, data: String(reader.result) }); onChanged?.(); } catch (e) { reportError('ReportPage:attach', e); setError(e?.message || 'The statement could not be attached. Try again.'); } finally { setBusy(false); }
    };
    reader.readAsDataURL(file);
  };
  const download = async (d) => {
    setError('');
    try {
      const { blob, filename } = await reportingApi.reportDocument(d.uid);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { reportError('ReportPage:download', e); setError(e?.message || 'The statement could not be downloaded.'); }
  };
  const docs = report.documents || [];
  return (
    <section className={CARD} data-testid="reporting-documents">
      <h2 className={H2}>Documents</h2>
      {docs.length ? (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {docs.map((d) => (
            <li key={d.uid} className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex flex-col"><span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{d.label || d.filename}</span><span className={MUTED}>{sizeWords(d.size_bytes)}{d.added_at ? ` · added ${shortDay(d.added_at)}` : ''}</span></span>
              <button type="button" className={GHOST} onClick={() => download(d)} data-testid="reporting-document-download">Download</button>
            </li>
          ))}
        </ul>
      ) : <p className={MUTED} data-testid="reporting-documents-none">No statement attached.</p>}
      {!sent && (
        <>
          <input ref={input} type="file" accept="application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) attach(f); }} data-testid="reporting-document-input" />
          <button type="button" className={GHOST} disabled={busy || docs.length >= 10} onClick={() => input.current?.click()} data-testid="reporting-document-attach">{busy ? 'Attaching…' : 'Attach statements (PDF)'}</button>
        </>
      )}
      {error && <p className={REFUSED} role="alert" data-testid="reporting-document-refused">{error}</p>}
    </section>
  );
}

function RecipientsStep({ report, save, busy }) {
  const rows = recipientRows(report.meets);
  return (
    <section className={CARD} data-testid="reporting-step-recipients">
      <h2 className={H2}>Recipients</h2>
      {rows.length ? (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {rows.map((r) => <li key={r.name} className="text-[13px] text-axal-ink dark:text-gray-100" data-testid="reporting-recipient">✓ <b>{r.name}</b> · {r.line}</li>)}
        </ul>
      ) : <p className={MUTED} data-testid="reporting-recipients-none">No investor is owed this period. Include your team to send it to them only.</p>}
      <p className={MUTED}>Each investor owed a period this report covers receives it. Investors with no duty this period are not offered here: no record says who they are yet.</p>
      <span className={EYE}>Your team</span>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={!!report.include_team} disabled={busy} onChange={(e) => save({ include_team: e.target.checked })} data-testid="reporting-include-team" />
        Your co-founders · founders
      </label>
      <p className={MUTED}>{NO_NETWORK}</p>
    </section>
  );
}

/** RPT5 Preview: exactly what a group reads, and the digest Send needs. */
function PreviewStep({ report, onSend, onRefresh, busy }) {
  const [as, setAs] = useState('investor');
  const [state, setState] = useState({ status: 'loading', preview: null });
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    setState({ status: 'loading', preview: null });
    reportingApi.previewReport(report.uid, as)
      .then((p) => { if (alive) setState({ status: 'ready', preview: p }); })
      .catch(() => { if (alive) setState({ status: 'unreadable', preview: null }); });
    return () => { alive = false; };
  }, [report.uid, report.figures_sha256, as, reload]);
  const p = state.preview;
  return (
    <div className="flex flex-col gap-3" data-testid="reporting-step-preview">
      <div className="flex flex-wrap items-center gap-2">
        <span className={EYE}>Preview as</span>
        {[['investor', 'An investor'], ['team', 'Your team']].map(([k, w]) => (
          <button key={k} type="button" aria-pressed={as === k} onClick={() => setAs(k)}
            className={`rounded-full border px-2.5 py-1 text-[12px] font-bold ${as === k ? LAV : 'border-axal-hairline text-axal-muted hover:text-axal-ink dark:border-gray-700 dark:text-gray-400 dark:hover:text-gray-100'}`} data-testid={`reporting-preview-${k}`}>{w}</button>
        ))}
      </div>
      {state.status === 'loading' && <p className={MUTED} aria-busy="true">Reading…</p>}
      {state.status === 'unreadable' && <Unreadable what="The preview" claim="Nothing was sent." onRetry={() => setReload((n) => n + 1)} />}
      {p && (
        <>
          {p.stale && (
            <div className={`flex flex-col gap-2 rounded-lg border px-3 py-2 text-[12.5px] ${AMBER}`} data-testid="reporting-preview-stale">
              <p className="m-0">{p.stale_reason}</p>
              <button type="button" className={GHOST} disabled={busy} onClick={onRefresh}>Save the draft again</button>
            </div>
          )}
          <FrozenBody report={p} reader={as === 'investor'} />
          <div className="flex justify-end">
            <button type="button" className={BTN} disabled={busy || p.stale} onClick={() => onSend(p)} aria-haspopup="dialog" data-testid="reporting-send-open">Send report</button>
          </div>
        </>
      )}
    </div>
  );
}

/** A report's figures and words as a reader (or the team) reads them. */
function FrozenBody({ report, reader }) {
  const groups = figureGroups((report.figures || []).map((f) => ({ ...f, module: f.module || 'revenue-and-traction' })));
  return (
    <>
      {groups.map((g) => (
        <section key={g.module} className={CARD} data-testid={`reporting-frozen-${g.module}`}>
          <h2 className={H2}>{g.title}</h2>
          <ul className="m-0 list-none p-0">
            {g.figures.map((f) => {
              const out = reader ? f.left_out : !f.included;
              return (
                <li key={f.key} className="flex flex-wrap items-start justify-between gap-2 border-t border-axal-hairline py-2 first:border-t-0 dark:border-gray-800" data-testid={`reporting-frozen-${f.key}`}>
                  <span className="flex flex-col"><span className="text-[13px] font-bold text-axal-ink dark:text-gray-100">{f.label}</span>
                    <span className={MUTED}>{out ? `Not included${f.left_out_reason ? `: ‘${f.left_out_reason}’` : ''}` : reader && f.shared_from_mercury ? '◐ Shared from Mercury' : sourceChip(f)}</span></span>
                  {out ? <span className="text-axal-muted dark:text-gray-400">—</span> : <Value f={f} />}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {['highlights', 'lowlights'].some((k) => (report[k] || []).length) && (
        <section className={CARD} data-testid="reporting-frozen-lines">
          <h2 className={H2}>In their words</h2>
          {['highlights', 'lowlights'].flatMap((k) => (report[k] || []).map((l, i) => (
            <p key={`${k}-${i}`} className="m-0 flex flex-col"><span className="text-[13px] text-axal-ink dark:text-gray-100">{k === 'highlights' ? '↑' : '↓'} {l.text}</span><span className={MUTED}>{LINE_KINDS[k]} · {sourceLine(l)}</span></p>
          )))}
        </section>
      )}
      {report.body && <section className={CARD}><span className={EYE}>In your words</span><p className="m-0 whitespace-pre-wrap text-[13px] text-axal-ink dark:text-gray-100">{report.body}</p></section>}
    </>
  );
}

/** The builder: four steps over a draft, saved on every choice. */
function Builder({ initial, projectId, company, navigate, search, phone = false }) {
  const [report, setReport] = useState(initial);
  const [unreadable, setUnreadable] = useState([]);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [savedAt, setSavedAt] = useState(null);
  const [refreshError, setRefreshError] = useState('');
  const [sending, setSending] = useState(null);
  const [correction, setCorrection] = useState(initial.correction_reason || '');

  const save = async (patch) => {
    setBusy(true); setError('');
    try {
      const r = await reportingApi.saveReport(report.uid, patch);
      setReport(r); setUnreadable(Array.isArray(r?.unreadable) ? r.unreadable : []);
      setSavedAt(new Date()); return true;
    } catch (e) { reportError('ReportPage:save', e); setError(e?.message || 'The draft could not be saved. Try again.'); return false; } finally { setBusy(false); }
  };
  // Opening the builder reads the figures again: a save with no change re-reads every store (D1059 §4).
  useEffect(() => {
    let alive = true;
    reportingApi.saveReport(initial.uid, {})
      .then((r) => { if (alive) { setReport(r); setUnreadable(Array.isArray(r?.unreadable) ? r.unreadable : []); } })
      .catch((e) => { if (alive) setRefreshError(`${e?.message || 'The figures could not be read again.'} The figures shown are the ones last saved.`); });
    return () => { alive = false; };
  }, [initial.uid]);

  const recipients = recipientRows(report.meets).length;
  return (
    <div className="flex flex-col gap-3" data-testid="reporting-builder">
      <p className={MUTED}>Figures are read from your Grow modules as of today. They are frozen when you send.</p>
      {refreshError && <p className={`m-0 rounded-lg border px-3 py-2 text-[12.5px] ${AMBER}`} data-testid="reporting-refresh-refused">{refreshError}</p>}
      {Number(report.revision) > 1 && (
        <section className={`${CARD} ${LAV}`} data-testid="reporting-correction">
          <span className={EYE}>Correction · revision {report.revision}</span>
          <label className="flex flex-col gap-1"><span className="text-[12.5px]">What it changes · everyone the last revision reached reads this</span>
            <input value={correction} maxLength={280} onChange={(e) => setCorrection(e.target.value)} onBlur={() => { if (correction.trim().length >= 3 && correction.trim() !== report.correction_reason) save({ correction_reason: correction.trim() }); }} className={FIELD} data-testid="reporting-correction-reason" />
          </label>
        </section>
      )}
      {phone ? (
        // RPT20b: one step to the screen, its place in the four said, and the step before one press away.
        <div className="flex flex-col gap-0.5" data-testid="reporting-steps">
          {step > 0 && <button type="button" className="inline-flex min-h-11 w-fit items-center bg-transparent p-0 text-[13px] font-bold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300 dark:hover:text-violet-200" onClick={() => setStep((n) => Math.max(0, n - 1))} data-testid="reporting-back">‹ {STEPS[step - 1].label}</button>}
          <h2 className={H2} aria-live="polite" data-testid="reporting-step-count">Step {step + 1} of {STEPS.length} · {STEPS[step].label}</h2>
          <p className={MUTED} aria-live="polite" data-testid="reporting-saved">{busy ? 'Saving…' : savedAt ? `Draft saved ${savedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}</p>
        </div>
      ) : (
        <ol className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="Steps" data-testid="reporting-steps">
          {STEPS.map((st, i) => (
            <li key={st.id}>
              <button type="button" aria-current={i === step ? 'step' : undefined} onClick={() => setStep(i)}
                className={`rounded-full border px-2.5 py-1 text-[12px] font-bold ${i === step ? LAV : 'border-axal-hairline text-axal-muted hover:text-axal-ink dark:border-gray-700 dark:text-gray-400 dark:hover:text-gray-100'}`}
                data-testid={`reporting-step-${st.id}-tab`}>{i < step ? '✓ ' : ''}{i + 1} · {st.label}</button>
            </li>
          ))}
          <li className={`${MUTED} self-center`} aria-live="polite" data-testid="reporting-saved">{busy ? 'Saving…' : savedAt ? `Draft saved ${savedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}</li>
        </ol>
      )}
      {error && <p className={REFUSED} role="alert" data-testid="reporting-save-refused">{error}</p>}
      {step === 0 && <FiguresStep report={report} company={company} unreadable={unreadable} save={save} busy={busy} />}
      {step === 1 && <NarrativeStep report={report} projectId={projectId} save={save} busy={busy} />}
      {step === 2 && <RecipientsStep report={report} save={save} busy={busy} />}
      {step === 3 && <PreviewStep report={report} busy={busy} onRefresh={() => save({})} onSend={(p) => setSending(p)} />}
      {phone ? (
        // RPT20b: Save draft and Next pinned to the bottom. Preview's own Send is the last step's press.
        <PinnedBar testId="reporting-builder-bar">
          <button type="button" className={BAR_GHOST} onClick={() => save({})} disabled={busy} data-testid="reporting-save-draft">{busy ? 'Saving…' : 'Save draft'}</button>
          {step < STEPS.length - 1 && <button type="button" className={BAR_PRIMARY} onClick={() => setStep((n) => n + 1)} data-testid="reporting-next">Next</button>}
        </PinnedBar>
      ) : (
        <div className="flex justify-between gap-2">
          <button type="button" className={GHOST} disabled={step === 0} onClick={() => setStep((n) => Math.max(0, n - 1))} data-testid="reporting-back">Back</button>
          {step < STEPS.length - 1 && <button type="button" className={BTN} onClick={() => setStep((n) => n + 1)} data-testid="reporting-next">Next</button>}
        </div>
      )}
      {sending && (
        <SendDialog report={report} preview={sending} recipients={recipients} onClose={() => setSending(null)}
          onDone={() => { setSending(null); navigate(reportHref(report.uid, { search }), { replace: true, state: { sent: true } }); }} />
      )}
    </div>
  );
}

/** RPT6 the sent report, for the founders with Correct, or read only for anyone else the Worker admits. */
function Sent({ report, navigate, search, justSent }) {
  const [correcting, setCorrecting] = useState(false);
  const strip = revisionStrip(report);
  const team = report.view === 'team';
  const readOnly = !team;
  return (
    <div className="flex flex-col gap-3" data-testid="reporting-sent">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`${CHIP} border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200`}>✓ Sent</span>
        {report.corrected_by && <span className={`${CHIP} ${LAV}`}>↻ Corrected</span>}
        {readOnly && <span className={`${CHIP} border-axal-hairline text-axal-muted dark:border-gray-700 dark:text-gray-400`} data-testid="reporting-sent-readonly">◉ Read only</span>}
        {team && !report.corrected_by && <button type="button" className={GHOST} onClick={() => setCorrecting(true)} aria-haspopup="dialog" data-testid="reporting-correct-open">Correct this report</button>}
      </div>
      <p className={MUTED} data-testid="reporting-sent-line">{sentLine(report)}</p>
      {justSent && <p className={`m-0 rounded-lg border px-3 py-2 text-[12.5px] ${LAV}`} data-testid="reporting-just-sent">Sent. Each recipient is told through their notification settings; the table below says who was reached.</p>}
      {strip && <p className={`m-0 rounded-lg border px-3 py-2 text-[12.5px] ${LAV}`} data-testid="reporting-revision-strip">{strip}</p>}
      {report.corrected_by && team && <Link className="w-fit text-[12.5px] font-bold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300 dark:hover:text-violet-200" to={reportHref(report.corrected_by.uid, { search }) || '#'}>Open revision {report.corrected_by.revision}</Link>}
      {team && (
        <section className={CARD} data-testid="reporting-recipients-sent">
          <h2 className={H2}>Recipients</h2>
          {(report.recipients || []).length ? (
            <table className="w-full border-collapse text-left text-[12.5px]">
              <thead><tr className={EYE}><th className="py-1.5 pr-3">Holder</th><th className="pr-3">Person</th><th className="pr-3">Delivered</th><th>Opened</th></tr></thead>
              <tbody>{report.recipients.map((r, i) => { const s = recipientStatus(r); return <tr key={i} className="border-t border-axal-hairline dark:border-gray-800"><td className="py-1.5 pr-3">{s.who}</td><td className="pr-3">{s.name}</td><td className="pr-3">{s.delivered}</td><td>{s.opened}</td></tr>; })}</tbody>
            </table>
          ) : <p className={MUTED}>No recipient is recorded.</p>}
        </section>
      )}
      <FrozenBody report={report} reader={!team} />
      <Documents report={report} sent />
      {correcting && (
        <CorrectDialog report={report} onClose={() => setCorrecting(false)}
          onDone={(r) => { setCorrecting(false); const to = reportHref(r?.uid, { draft: true, search }); if (to) navigate(to); }} />
      )}
    </div>
  );
}

export default function ReportPage({ uid, edit = false, projectId, projectStatus = 'ready', onRetryProject, search = '', phone = false }) {
  const navigate = useNavigate();
  const [state, setState] = useState({ status: 'loading', report: null });
  const [reload, setReload] = useState(0);
  const justSent = !!useLocation().state?.sent;
  useEffect(() => {
    if (!uid) return undefined;
    let alive = true;
    setState({ status: 'loading', report: null });
    reportingApi.report(uid)
      .then((r) => { if (alive) setState({ status: 'ready', report: r }); })
      .catch((e) => { if (alive) setState({ status: e?.status === 404 ? 'missing' : 'unreadable', report: null }); });
    return () => { alive = false; };
  }, [uid, reload]);
  const r = state.report;
  const draft = r?.view === 'team' && r?.status === 'draft';
  // A draft's address is its builder's; a sent report's is its own.
  useEffect(() => {
    if (!r) return;
    if (draft && !edit) navigate(reportHref(uid, { draft: true, search }), { replace: true });
    if (!draft && edit) navigate(reportHref(uid, { search }), { replace: true });
  }, [r, draft, edit, uid, search, navigate]);
  const label = r?.period?.label ? `${r.period.label} report` : 'Report';
  const back = `/grow/reporting${search}`;
  let body;
  if (projectStatus === 'unreadable') body = <Unreadable what="Your ventures" claim="This is not a claim that you have none." onRetry={onRetryProject} />;
  else if (!uid || state.status === 'missing') body = <section className={CARD} data-testid="reporting-report-missing"><p className={MUTED}>No such report, or it is not shared with you. A draft is the founders’ own until it is sent.</p></section>;
  else if (state.status === 'loading') body = <section className={CARD} aria-busy="true" data-testid="reporting-report-loading"><p className={MUTED}>Reading…</p><div className="h-3 w-48 animate-pulse rounded bg-axal-ground dark:bg-gray-800" /></section>;
  else if (state.status === 'unreadable') body = <Unreadable what="The report" claim="This is not a claim that it was not sent." onRetry={() => setReload((n) => n + 1)} />;
  else if (draft) body = <Builder key={r.uid} initial={r} projectId={projectId} company="your company" navigate={navigate} search={search} phone={phone} />;
  else body = <Sent report={r} navigate={navigate} search={search} justSent={justSent} />;
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid={`reporting-${edit ? 'edit' : 'report'}-page`}>
      {phone
        ? <CycleBar back={{ label: 'Reporting', to: back }} title={label} eadwynLabel={`Grow · Reporting · ${label}`} />
        : (
          <header className="flex flex-col gap-1.5" data-testid="reporting-report-header">
            <span className={`${EYE} text-axal-violet dark:text-violet-300`}>Grow › <Link to={back} className="text-axal-violet hover:text-axal-violet-deep dark:text-violet-300 dark:hover:text-violet-200">Reporting</Link> › {label}</span>
            <h1 className="m-0 text-[20px] font-extrabold leading-tight tracking-[-.025em] text-axal-ink sm:text-2xl dark:text-gray-100">{label}</h1>
          </header>
        )}
      {body}
    </div>
  );
}
