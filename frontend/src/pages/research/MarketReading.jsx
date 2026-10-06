import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Card, Pill, WorkerRail } from '../../ui';
import { api } from '../../lib/api';
import WorkspaceShell from '../../workspaces/WorkspaceShell';
import { ACCENT } from '../../workspaces/shellConfig';
import { NotRecorded } from '../../workspaces/canvasKit';
import { StatedLimit } from '../advisor/expertise/kit';
import { AGE_AT, STALE_AT, ageBand, daysSince } from './MarketZone';
import {
  ATTACH_COPY,
  ageingAttachmentNote,
  attachState,
  catalogLine,
  freshReadingForm,
  openProposals,
  rangeReadsForward,
  readingDraft,
  readingFields,
  readingSubmission,
  staleAttachmentSentence,
  usd,
} from './marketReadingRead';

/**
 * `/research/markets/:uid` — one comparable range.
 *
 * THE SHELL ALREADY DRAWS the sidebar, the zone pills and the ANALYTICS mark.
 * This page is the reading. Dark mode is the app theme.
 *
 * A SAVE WRITES A NEW READING. It does not edit the row this page opened.
 * Age is `ran_at`. A stale reading has no Attach control. The catalog price
 * sits beside the scope and is never added into the range. Named engagements
 * are not stored, so the table stays empty.
 *
 * `MarketReadingView` draws the page, shell included, from props; the default
 * export reads the reading and owns the state. The view takes the shell with
 * it because the one-h1 rule spans both: the metric is this page's h1, so the
 * shell's title line is a paragraph once the reading is on screen (D593).
 */

/**
 * THE ACCENT IS THE LICENCE'S, NOT VIOLET (D593). Partner amber, founder
 * violet, advisor green, investor indigo: `ACCENT` in the shell config, the
 * table ZoneNav and the rail already read. Tailwind cannot build a class from a
 * hex at runtime, so the page root carries the role's values as CSS variables
 * and the classes below read them.
 *
 * Two pairs, as `ui/WorkerRail.jsx` does it. What sits on the page ground (the
 * back link, the focus ring, Accept's outline) moves to the 400 weight on dark.
 * A fill under white ink keeps its light value on dark, which is what the
 * canvas's dark board (D6) draws; the `dark:` classes say so rather than leave
 * it to an omission.
 */
export function accentVars(role) {
  const a = ACCENT[role] || ACCENT.founder;
  return {
    '--mr-accent': a.ink,
    '--mr-accent-deep': a.deep,
    '--mr-accent-line': a.border,
    '--mr-accent-dark': a.deepDark,
  };
}

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--mr-accent)] '
  + 'dark:focus-visible:outline-[color:var(--mr-accent-dark)]';

const inputClass =
  'mt-1 w-full min-w-0 rounded-lg border border-axal-hairline bg-axal-ground px-2.5 py-1.5 text-[12.5px] text-axal-ink '
  + 'placeholder:text-axal-faint focus:border-[color:var(--mr-accent)] focus:outline-none focus:ring-1 '
  + 'focus:ring-[color:var(--mr-accent)] dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 '
  + 'dark:focus:border-[color:var(--mr-accent-dark)] dark:focus:ring-[color:var(--mr-accent-dark)]';

const primaryBtn =
  'rounded-lg bg-[var(--mr-accent)] px-3 py-1.5 text-[12px] font-semibold text-white '
  + 'hover:bg-[var(--mr-accent-deep)] disabled:cursor-not-allowed disabled:opacity-50 '
  + 'dark:bg-[var(--mr-accent)] dark:text-white dark:hover:bg-[var(--mr-accent-deep)] '
  + focusRing;

const ghostBtn =
  'rounded-lg border border-axal-hairline bg-axal-ground px-3 py-1.5 text-[12px] font-semibold text-axal-ink '
  + 'hover:bg-axal-ground/80 disabled:cursor-not-allowed disabled:opacity-40 '
  + 'dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800 '
  + focusRing;

// Accept is the canvas's outline button in the accent: the licence's border
// and deep ink on light, its 400 weight on dark.
const acceptBtn =
  'rounded-lg border border-[color:var(--mr-accent-line)] bg-transparent px-3 py-1.5 text-[12px] font-semibold '
  + 'text-[color:var(--mr-accent-deep)] hover:bg-white/60 disabled:cursor-not-allowed disabled:opacity-40 '
  + 'dark:border-[color:var(--mr-accent-dark)]/40 dark:text-[color:var(--mr-accent-dark)] dark:hover:bg-white/5 '
  + focusRing;

const accentLink =
  'font-semibold underline text-[color:var(--mr-accent)] dark:text-[color:var(--mr-accent-dark)] '
  + focusRing;

const BAND_SKIN = {
  partner: 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40',
  advisor: 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40',
  investor: 'border-indigo-200 bg-indigo-50 dark:border-indigo-900 dark:bg-indigo-950/40',
  founder: 'border-violet-200 bg-violet-50 dark:border-violet-900 dark:bg-violet-950/40',
};

// Age and Proposal are the two tiles that gate, and the canvas sets their
// values larger: 20px on a desktop, 17px on a phone. The range and the run
// date are 17px and 14px.
function Tile({ k, v, sub, nr, ink = 'text-axal-ink dark:text-gray-100', hair, big = false }) {
  const size = big ? 'text-[17px] sm:text-[20px]' : 'text-[14px] sm:text-[17px]';
  return (
    <Card className={`min-w-0 ${hair || ''}`}>
      <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">{k}</div>
      {nr
        ? <div className="mt-2"><NotRecorded /></div>
        : <div className={`mt-1.5 break-words font-mono font-bold tracking-tight ${size} ${ink}`}>{v}</div>}
      <p className="mt-1 text-[12px] leading-relaxed text-axal-muted">{sub}</p>
    </Card>
  );
}

const noop = () => {};

export function MarketReadingView({
  role = 'founder',
  payload = null,
  loading = false,
  error = null,
  notice = null,
  form = null,
  onForm = noop,
  busy = false,
  quoteId = '',
  onQuote = noop,
  onRetry = noop,
  onSave = (e) => e?.preventDefault?.(),
  onAttach = noop,
  onFresh = noop,
  draftEdit = '',
  onDraft = noop,
  onDraftEdit = noop,
  kept = '',
  onKeep = noop,
  onDiscard = noop,
}) {
  const item = payload?.item || null;
  const days = item ? daysSince(item.ran_at) : null;
  const band = days == null ? null : ageBand(days);
  const stale = band === 'stale';
  const ready = Boolean(item && form && band);
  const attachments = payload?.attachments || [];
  const proposals = payload?.proposals || [];
  const open = openProposals(proposals, attachments);
  const attachKey = attachState({ stale, attachments, proposals });
  const attach = ATTACH_COPY[attachKey];
  const catalog = item ? catalogLine(item.catalog_price_cents) : null;
  const forward = form ? rangeReadsForward(form.low, form.high) : null;
  const draft = item && days != null && band
    ? readingDraft({ days, band, comparableCount: item.comparable_count })
    : '';
  const skin = BAND_SKIN[role] || BAND_SKIN.founder;
  const ageLabel = stale ? 'Stale' : (band === 'ageing' ? 'Ageing' : 'Current');

  const ageInk = stale
    ? 'text-red-700 dark:text-red-300'
    : (band === 'ageing' ? 'text-amber-800 dark:text-amber-300' : 'text-axal-ink dark:text-gray-100');
  const proposalInk = stale
    ? 'text-red-700 dark:text-red-300'
    : (attachKey === 'nowhere' ? 'text-axal-muted dark:text-gray-300' : 'text-emerald-700 dark:text-emerald-300');
  const staleHair = stale ? 'border-red-200 dark:border-red-900' : '';

  return (
    <WorkspaceShell
      role={role}
      title={item?.metric || 'Market reading'}
      titleAs={ready ? 'p' : 'h1'}
      activeSlug="markets"
      rail={(
        <WorkerRail
          workspace="Research"
          role={role}
          stance="This page does not invent a market figure"
          note="A save writes a new reading. It does not edit the one you opened, and a stale range cannot be attached."
          coverage={[item
            ? `${item.metric}: ${days ?? '—'} days · ${item.comparable_count} comparables`
            : 'One market reading']}
          unavailable={[
            ['Named comparables', 'The count is stored. The engagements behind it are not, so this page will not invent them.'],
            ['A generated range', 'Nothing here calls a model to price a service line.'],
          ]}
        />
      )}
    >
      <div data-testid="market-reading" className="space-y-3" style={accentVars(role)}>
        <Link to="/research/markets" className={`text-[12px] ${accentLink}`}>
          ‹ Markets
        </Link>

        {loading && (
          <Card variant="dashed" padding="lg">
            <p className="text-[12.5px] text-axal-muted">Loading this reading.</p>
          </Card>
        )}
        {error && (
          <Card variant="dashed" padding="lg">
            <h2 className="text-sm font-extrabold tracking-tight">This did not load</h2>
            <p className="mt-2 max-w-xl text-[12.5px] leading-relaxed text-axal-muted">
              {error} Nothing is shown rather than an empty range, because an empty page here would
              say the firm looked and found the work is worth nothing.
            </p>
            <button type="button" onClick={onRetry} className={`${ghostBtn} mt-3`}>Try again</button>
          </Card>
        )}

        {ready && (
          <>
            {notice && (
              <p className={`text-[12px] font-semibold ${notice.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
                {notice.text}
              </p>
            )}

            <Card
              data-testid="market-reading-header"
              className={stale ? 'border-red-200 bg-red-50/70 dark:border-red-900 dark:bg-red-950/30' : ''}
            >
              <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Market reading</div>
              <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{item.metric}</h1>
              {/* The chip stands for a missing SCOPE and for nothing else. The
                  catalog line is a different fact: muted, after the scope, and
                  absent when the offering is not catalogued (D593). */}
              <div data-testid="market-reading-scope" className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-axal-muted">
                <span className="sr-only">Scope:</span>
                {item.scope ? <span>{item.scope}</span> : <NotRecorded />}
                {catalog ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{catalog}</span>
                  </>
                ) : null}
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <Pill tone={stale ? 'danger' : (band === 'ageing' ? 'warn' : 'ok')}>{ageLabel}</Pill>
                <Pill tone={attach.tone}>{attach.pill}</Pill>
                <span className="font-mono text-[11px] text-axal-muted">
                  ran {item.ran_at} · {days} d old
                </span>
              </div>
            </Card>

            <div data-testid="market-reading-tiles" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <Tile
                k="Comparable range"
                v={`${usd(item.range_low_cents)} – ${usd(item.range_high_cents)}`}
                sub={`${item.comparable_count} comparables`}
              />
              <Tile k="Run date" v={item.ran_at} sub="age is a gate, not a label" />
              <Tile
                k="Age"
                big
                v={`${days} d old`}
                ink={ageInk}
                hair={staleHair}
                sub={`${ageLabel} · stale at ${STALE_AT} days`}
              />
              <Tile k="Proposal" big v={attach.tile} ink={proposalInk} hair={staleHair} sub={attach.sub} />
            </div>

            <Card>
              <h2 className="text-sm font-extrabold tracking-tight">Record this reading</h2>
              <p className="mt-1 text-[12px] text-axal-muted">A save writes a new run date. It does not edit the old one.</p>
              <form onSubmit={onSave} className="mt-3">
                <label className="block text-[11px] font-semibold text-axal-muted">
                  Scope
                  <input
                    aria-label="Scope"
                    className={inputClass}
                    maxLength={200}
                    value={form.scope ?? ''}
                    onChange={(e) => onForm({ ...form, scope: e.target.value })}
                  />
                </label>
                <p className="mt-1 text-[11px] text-axal-muted">
                  What this range covers. Left blank, the reading says Not recorded.
                </p>
                {/* One row on a desktop, the button last; two by two on a
                    phone, the button under them (D593). */}
                <div
                  data-testid="market-reading-form-row"
                  className="mt-3 grid grid-cols-2 gap-3 xl:grid-cols-[repeat(4,minmax(0,1fr))_auto] xl:items-end"
                >
                  <label className="min-w-0 text-[11px] font-semibold text-axal-muted">
                    Low (USD)
                    <input
                      aria-label="Low (USD)"
                      className={`${inputClass} ${forward === false ? 'border-red-300 text-red-700 dark:border-red-800 dark:text-red-300' : ''}`}
                      inputMode="decimal"
                      value={form.low}
                      onChange={(e) => onForm({ ...form, low: e.target.value })}
                    />
                  </label>
                  <label className="min-w-0 text-[11px] font-semibold text-axal-muted">
                    High (USD)
                    <input
                      aria-label="High (USD)"
                      className={`${inputClass} ${forward === false ? 'border-red-300 text-red-700 dark:border-red-800 dark:text-red-300' : ''}`}
                      inputMode="decimal"
                      value={form.high}
                      onChange={(e) => onForm({ ...form, high: e.target.value })}
                    />
                  </label>
                  <label className="min-w-0 text-[11px] font-semibold text-axal-muted">
                    Comparables
                    <input
                      aria-label="Comparables"
                      className={inputClass}
                      inputMode="numeric"
                      value={form.n}
                      onChange={(e) => onForm({ ...form, n: e.target.value })}
                    />
                  </label>
                  <label className="min-w-0 text-[11px] font-semibold text-axal-muted">
                    Run date
                    <input
                      aria-label="Run date"
                      type="date"
                      className={inputClass}
                      value={form.ran_at}
                      onChange={(e) => onForm({ ...form, ran_at: e.target.value })}
                    />
                  </label>
                  <button
                    type="submit"
                    className={`${primaryBtn} col-span-2 justify-self-start xl:col-span-1`}
                    disabled={busy || forward === false}
                  >
                    {busy ? 'Recording…' : 'Record this reading'}
                  </button>
                </div>
                <p className="mt-2 text-[11px] text-axal-muted">How many engagements the range came from. Refused if 0.</p>
                {forward === false && (
                  <div
                    role="alert"
                    className="mt-2.5 flex items-start gap-2 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
                  >
                    <span aria-hidden="true" className="flex-none font-extrabold">!</span>
                    <span>High is below low. Nothing is saved until the range reads forward.</span>
                  </div>
                )}
              </form>
            </Card>

            <Card>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-extrabold tracking-tight">Comparables basis</h2>
                <span className="font-mono text-[11px] text-axal-muted">
                  {item.comparable_count} counted · 0 named
                </span>
              </div>
              <div
                data-testid="market-reading-comparables-head"
                className="mt-3 hidden grid-cols-[1fr_1.4fr_1.2fr_1.4fr] gap-3 border-b border-axal-hairline pb-2 text-[10px] font-extrabold uppercase tracking-[.07em] text-axal-faint dark:border-gray-700 sm:grid"
              >
                <span>Date</span>
                <span>Engagement went for</span>
                <span>Source</span>
                <span>URL or file</span>
              </div>
              <p className="mt-3 text-[13px] font-bold text-axal-ink dark:text-gray-100">The count has no names behind it</p>
              <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-axal-muted">
                The product stores comparable_count only. A client will ask “which {item.comparable_count}?”.
                Add the engagements you actually used, or leave this blank — never type a count so the form accepts.
                Named engagements are not a column, so there is no control here that would pretend to save one.
              </p>
            </Card>

            <Card
              data-testid="market-reading-attachment"
              className={stale ? 'border-red-200 bg-red-50/70 dark:border-red-900 dark:bg-red-950/30' : ''}
            >
              <h2 className="text-sm font-extrabold tracking-tight">Proposal attachment</h2>
              {stale ? (
                <>
                  <p className="mt-2 max-w-xl text-[12.5px] leading-relaxed text-red-700 dark:text-red-300">
                    {staleAttachmentSentence(item.ran_at)}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button type="button" className={primaryBtn} onClick={onFresh}>
                      Record a fresh reading
                    </button>
                    <span className="text-[12px] text-axal-muted">Prefills the metric, blanks the dollars, sets the run date to today.</span>
                  </div>
                </>
              ) : (
                <>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-axal-muted">
                    The range and its run date travel together onto the quote.
                  </p>
                  {/* "Still attachable" only where there is a quote to take it. */}
                  {band === 'ageing' && attachKey !== 'nowhere' && (
                    <p className="mt-1 text-[12.5px] text-amber-800 dark:text-amber-300">{ageingAttachmentNote(days)}</p>
                  )}
                  {attachments.length > 0 && (
                    <>
                      <div className="mt-2.5">
                        <Pill tone="ok">Attached</Pill>
                      </div>
                      <ul className="mt-1.5 space-y-1 text-[12.5px] text-axal-ink dark:text-gray-100">
                        {attachments.map((a) => (
                          <li key={a.uid}>
                            {a.proposal_name
                              ? `Attached to ${a.proposal_name}.`
                              : 'This reading is attached. The proposal is not named on the quote.'}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {open.length > 0 ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <select
                        aria-label={attachments.length > 0 ? 'Another proposal' : 'Proposal'}
                        className={inputClass}
                        value={quoteId}
                        onChange={(e) => onQuote(e.target.value)}
                      >
                        {open.map((q) => (
                          <option key={q.id} value={q.id}>
                            {q.proposal_name || `Quote ${q.id} — proposal not named`}
                          </option>
                        ))}
                      </select>
                      <button type="button" className={ghostBtn} disabled={busy || !quoteId} onClick={onAttach}>
                        {attachments.length > 0 ? 'Attach to another proposal' : 'Attach to a proposal'}
                      </button>
                    </div>
                  ) : (
                    <p className="mt-2 text-[12px] text-axal-muted">
                      {attachments.length > 0
                        ? 'There is no other proposal on this account to attach it to.'
                        : 'No proposal on this account. A reading attaches to a quote your partner profile owns.'}
                    </p>
                  )}
                </>
              )}
            </Card>

            <div data-testid="market-reading-draft" className={`rounded-[14px] border px-4 py-3.5 ${skin}`}>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-[var(--mr-accent)] px-2 py-0.5 text-[10px] font-extrabold tracking-[.06em] text-white dark:bg-[var(--mr-accent)] dark:text-white">ZONEDRAFT</span>
                <span className="text-[13px] font-extrabold tracking-tight">Reading · demand movement</span>
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-axal-ink dark:text-gray-100">{draft}</p>
              {draftEdit !== '' && (
                <textarea
                  aria-label="Draft preview"
                  className={`${inputClass} min-h-[72px]`}
                  value={draftEdit}
                  onChange={(e) => onDraftEdit(e.target.value)}
                />
              )}
              {kept && (
                <p className="mt-2 text-[12px] text-axal-muted">Kept on this page for this visit: {kept}</p>
              )}
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <button type="button" className={primaryBtn} onClick={() => onDraft(draft)}>Draft</button>
                <button
                  type="button"
                  className={acceptBtn}
                  disabled={!draft}
                  onClick={() => onKeep(draftEdit.trim() || draft)}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className="px-1.5 py-1.5 text-[12px] font-semibold text-axal-muted disabled:opacity-40"
                  disabled={!draftEdit && !kept}
                  onClick={onDiscard}
                >
                  Discard
                </button>
                <span className="text-[12px] text-axal-muted sm:ml-auto">
                  Run dates carried into any attachment. Accept writes nothing — a reading has no note — and it does not call a model.
                </span>
              </div>
            </div>

            <StatedLimit title="Where these numbers come from">
              <p>
                A reading is what you found, recorded by you. There is no comparables database, and there is not going to be one this product invents.
              </p>
              <p>
                A range is refused without the number of comparables and the date you ran it. Both travel onto any proposal.
              </p>
              <p>
                Sector signals live on <Link to="/signals" className={accentLink}>Signals</Link>. This page is about prices.
              </p>
            </StatedLimit>
            <p className="text-[11px] text-axal-faint">
              Ageing starts after {AGE_AT} days and is still attachable. Stale, past {STALE_AT}, is blocked.
            </p>
          </>
        )}
      </div>
    </WorkspaceShell>
  );
}

export default function MarketReading({ role = 'founder' }) {
  const { uid } = useParams();
  const navigate = useNavigate();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [form, setForm] = useState(null);
  const [quoteId, setQuoteId] = useState('');
  const [busy, setBusy] = useState(false);
  const [draftEdit, setDraftEdit] = useState('');
  const [kept, setKept] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const full = await api.research.marketReadingGet(uid);
      setPayload(full);
      setForm(readingFields(full.item));
      // The picker offers only the proposals this reading is not on yet.
      const open = openProposals(full.proposals, full.attachments);
      setQuoteId(open[0] ? String(open[0].id) : '');
      setDraftEdit('');
      setKept('');
    } catch (e) {
      setPayload(null);
      setForm(null);
      setError(e?.status === 404
        ? 'This reading is not on your list.'
        : (e?.message || 'The reading did not load.'));
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => { load(); }, [load]);

  const item = payload?.item || null;
  const stale = item ? ageBand(daysSince(item.ran_at)) === 'stale' : false;

  const save = async (e) => {
    e.preventDefault();
    if (!item || !form || busy) return;
    const submission = readingSubmission(item, form);
    if (submission.error) {
      setNotice({ ok: false, text: submission.error });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const saved = await api.research.marketReadingCreate(submission.body);
      const next = saved?.item?.uid;
      if (next && next !== item.uid) navigate(`/research/markets/${encodeURIComponent(next)}`);
      else await load();
      setNotice({ ok: true, text: 'Recorded as a new reading. The one you opened is unchanged.' });
    } catch (err) {
      // D258 — the refusal's code travels on `err.code`, and is compared
      // whole: research.ts answers each of these as a bare `detail` code.
      const code = err?.code || '';
      const text = code === 'range_required'
        ? 'High is below low. Nothing is saved until the range reads forward.'
        : code === 'comparable_count_required'
          ? 'How many engagements the range came from. Refused if 0.'
          : code === 'ran_at_required'
            ? 'A reading needs the date you ran it.'
            : (err?.message || 'That reading could not be saved.');
      setNotice({ ok: false, text });
    } finally {
      setBusy(false);
    }
  };

  const attach = async () => {
    if (!item || stale || busy || !quoteId) return;
    setBusy(true);
    setNotice(null);
    try {
      await api.research.attach('reading', item.uid, Number(quoteId));
      await load();
      setNotice({ ok: true, text: 'Attached. The range and its run date travel with that quote.' });
    } catch (err) {
      // D258 — the code is `err.code`; `err.message` is its sentence.
      setNotice({
        ok: false,
        text: err?.code === 'reading_stale'
          ? 'This reading is past ninety days. Record a fresh one before attaching it.'
          : 'That proposal is not on your account, so nothing was attached.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <MarketReadingView
      role={role}
      payload={payload}
      loading={loading}
      error={error}
      notice={notice}
      form={form}
      onForm={setForm}
      busy={busy}
      quoteId={quoteId}
      onQuote={setQuoteId}
      onRetry={load}
      onSave={save}
      onAttach={attach}
      onFresh={() => {
        setForm((current) => freshReadingForm(current, new Date().toISOString().slice(0, 10)));
        setNotice(null);
      }}
      draftEdit={draftEdit}
      onDraft={setDraftEdit}
      onDraftEdit={setDraftEdit}
      kept={kept}
      onKeep={(text) => {
        setKept(text);
        setDraftEdit('');
      }}
      onDiscard={() => {
        setDraftEdit('');
        setKept('');
      }}
    />
  );
}
