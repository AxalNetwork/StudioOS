import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Card, Pill, WorkerRail } from '../../ui';
import { api } from '../../lib/api';
import WorkspaceShell from '../../workspaces/WorkspaceShell';
import { NotRecorded } from '../../workspaces/canvasKit';
import { StatedLimit } from '../advisor/expertise/kit';
import { AGE_AT, STALE_AT, ageBand, daysSince } from './MarketZone';
import {
  ageingAttachmentNote,
  catalogLine,
  comparableCount,
  dollarsToCents,
  freshReadingForm,
  rangeReadsForward,
  readingDraft,
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
 */

const inputClass =
  'mt-1 w-full rounded-lg border border-axal-hairline bg-axal-ground px-2.5 py-1.5 text-[12.5px] text-axal-ink '
  + 'placeholder:text-axal-faint focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 '
  + 'dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';

const primaryBtn =
  'rounded-lg bg-violet-700 px-3 py-1.5 text-[12px] font-semibold text-white '
  + 'hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-violet-300 disabled:opacity-70';

const ghostBtn =
  'rounded-lg border border-axal-hairline bg-axal-ground px-3 py-1.5 text-[12px] font-semibold text-axal-ink '
  + 'hover:bg-axal-ground/80 disabled:cursor-not-allowed disabled:opacity-40 '
  + 'dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';

const BAND_SKIN = {
  partner: 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40',
  advisor: 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40',
  investor: 'border-indigo-200 bg-indigo-50 dark:border-indigo-900 dark:bg-indigo-950/40',
  founder: 'border-violet-200 bg-violet-50 dark:border-violet-900 dark:bg-violet-950/40',
};

function fieldsFrom(item) {
  return {
    low: String(Math.round(item.range_low_cents / 100)),
    high: String(Math.round(item.range_high_cents / 100)),
    n: String(item.comparable_count),
    ran_at: item.ran_at,
  };
}

function Tile({ k, v, sub, nr, ink = 'text-axal-ink dark:text-gray-100', hair }) {
  return (
    <Card className={hair || ''}>
      <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">{k}</div>
      {nr
        ? <div className="mt-2"><NotRecorded /></div>
        : <div className={`mt-1.5 font-mono text-[17px] font-bold tracking-tight ${ink}`}>{v}</div>}
      <p className="mt-1 text-[12px] leading-relaxed text-axal-muted">{sub}</p>
    </Card>
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
      setForm(fieldsFrom(full.item));
      setQuoteId(full.proposals?.[0] ? String(full.proposals[0].id) : '');
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
  const days = item ? daysSince(item.ran_at) : null;
  const band = days == null ? null : ageBand(days);
  const stale = band === 'stale';
  const attachments = payload?.attachments || [];
  const proposals = payload?.proposals || [];
  const catalog = item ? catalogLine(item.catalog_price_cents) : null;
  const forward = form ? rangeReadsForward(form.low, form.high) : null;
  const draft = item && days != null && band
    ? readingDraft({ days, band, comparableCount: item.comparable_count })
    : '';
  const skin = BAND_SKIN[role] || BAND_SKIN.founder;

  const save = async (e) => {
    e.preventDefault();
    if (!item || !form || busy) return;
    const low = dollarsToCents(form.low);
    const high = dollarsToCents(form.high);
    const count = comparableCount(form.n);
    if (low.error || high.error || low.cents == null || high.cents == null) {
      setNotice({ ok: false, text: low.error || high.error || 'Enter the low and the high.' });
      return;
    }
    if (high.cents < low.cents) {
      setNotice({ ok: false, text: 'High is below low. Nothing is saved until the range reads forward.' });
      return;
    }
    if (count.n == null) {
      setNotice({ ok: false, text: count.error });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.ran_at || '')) {
      setNotice({ ok: false, text: 'A reading needs the date you ran it.' });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const saved = await api.research.marketReadingCreate({
        offering_uid: item.offering_uid || undefined,
        metric: item.metric,
        range_low_cents: low.cents,
        range_high_cents: high.cents,
        comparable_count: count.n,
        ran_at: form.ran_at,
        scope: item.scope || undefined,
      });
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

  const ageInk = stale
    ? 'text-red-700 dark:text-red-300'
    : (band === 'ageing' ? 'text-amber-800 dark:text-amber-300' : 'text-axal-ink dark:text-gray-100');
  const proposalInk = stale ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300';
  const staleHair = stale ? 'border-red-200 dark:border-red-900' : '';

  return (
    <WorkspaceShell
      role={role}
      title={item?.metric || 'Market reading'}
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
      <div data-testid="market-reading" className="space-y-3">
        <Link to="/research/markets" className="text-[12px] font-semibold text-axal-violet underline dark:text-violet-300">
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
            <button type="button" onClick={load} className={`${ghostBtn} mt-3`}>Try again</button>
          </Card>
        )}

        {item && form && band && (
          <>
            {notice && (
              <p className={`text-[12px] font-semibold ${notice.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
                {notice.text}
              </p>
            )}

            <Card className={stale ? 'border-red-200 bg-red-50/70 dark:border-red-900 dark:bg-red-950/30' : ''}>
              <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Market reading</div>
              <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{item.metric}</h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-axal-muted">
                {item.scope ? <span>{item.scope}</span> : null}
                {item.scope && catalog ? <span>·</span> : null}
                {catalog
                  ? <span className="text-axal-faint">{catalog}</span>
                  : <NotRecorded />}
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <Pill tone={stale ? 'danger' : (band === 'ageing' ? 'warn' : 'ok')}>
                  {stale ? 'Stale' : (band === 'ageing' ? 'Ageing' : 'Current')}
                </Pill>
                <Pill tone={stale ? 'danger' : 'ok'}>
                  {stale ? 'Re-run before attaching' : (attachments.length ? 'Attached' : 'Attachable')}
                </Pill>
                <span className="font-mono text-[11px] text-axal-muted">
                  ran {item.ran_at} · {days} d old
                </span>
              </div>
            </Card>

            <div className="grid grid-cols-2 gap-3">
              <Tile
                k="Comparable range"
                v={`${usd(item.range_low_cents)} – ${usd(item.range_high_cents)}`}
                sub={`${item.comparable_count} comparables`}
              />
              <Tile k="Run date" v={item.ran_at} sub="age is a gate, not a label" />
              <Tile
                k="Age"
                v={`${days} d old`}
                ink={ageInk}
                hair={staleHair}
                sub={`${stale ? 'Stale' : (band === 'ageing' ? 'Ageing' : 'Current')} · stale at ${STALE_AT} days`}
              />
              <Tile
                k="Proposal"
                v={stale ? 'Blocked' : (attachments.length ? 'Attached' : 'Attachable')}
                ink={proposalInk}
                hair={staleHair}
                sub={stale
                  ? 're-run before attaching'
                  : (attachments.length ? 'travelling with a quote' : 'range + run date travel together')}
              />
            </div>

            <Card>
              <h2 className="text-sm font-extrabold tracking-tight">Record this reading</h2>
              <p className="mt-1 text-[12px] text-axal-muted">A save writes a new run date. It does not edit the old one.</p>
              <form onSubmit={save} className="mt-3">
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-[11px] font-semibold text-axal-muted">
                    Low (USD)
                    <input
                      aria-label="Low (USD)"
                      className={`${inputClass} ${forward === false ? 'border-red-300 text-red-700 dark:border-red-800 dark:text-red-300' : ''}`}
                      inputMode="decimal"
                      value={form.low}
                      onChange={(e) => setForm({ ...form, low: e.target.value })}
                    />
                  </label>
                  <label className="text-[11px] font-semibold text-axal-muted">
                    High (USD)
                    <input
                      aria-label="High (USD)"
                      className={`${inputClass} ${forward === false ? 'border-red-300 text-red-700 dark:border-red-800 dark:text-red-300' : ''}`}
                      inputMode="decimal"
                      value={form.high}
                      onChange={(e) => setForm({ ...form, high: e.target.value })}
                    />
                  </label>
                  <label className="text-[11px] font-semibold text-axal-muted">
                    Comparables
                    <input
                      aria-label="Comparables"
                      className={inputClass}
                      inputMode="numeric"
                      value={form.n}
                      onChange={(e) => setForm({ ...form, n: e.target.value })}
                    />
                  </label>
                  <label className="text-[11px] font-semibold text-axal-muted">
                    Run date
                    <input
                      aria-label="Run date"
                      type="date"
                      className={inputClass}
                      value={form.ran_at}
                      onChange={(e) => setForm({ ...form, ran_at: e.target.value })}
                    />
                  </label>
                </div>
                <p className="mt-2 text-[11px] text-axal-muted">How many engagements the range came from. Refused if 0.</p>
                {forward === false && (
                  <p className="mt-2 text-[12px] font-semibold text-red-700 dark:text-red-300">
                    High is below low. Nothing is saved until the range reads forward.
                  </p>
                )}
                <button type="submit" className={`${primaryBtn} mt-3`} disabled={busy || forward === false}>
                  {busy ? 'Recording…' : 'Record this reading'}
                </button>
              </form>
            </Card>

            <Card>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-extrabold tracking-tight">Comparables basis</h2>
                <span className="font-mono text-[11px] text-axal-muted">
                  {item.comparable_count} counted · 0 named
                </span>
              </div>
              <div className="mt-3 hidden grid-cols-3 gap-3 border-b border-axal-hairline pb-2 text-[10px] font-extrabold uppercase tracking-[.07em] text-axal-faint dark:border-gray-700 sm:grid">
                <span>Date</span>
                <span>Engagement went for</span>
                <span>Source</span>
              </div>
              <p className="mt-3 text-[13px] font-bold text-axal-ink dark:text-gray-100">The count has no names behind it</p>
              <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-axal-muted">
                The product stores comparable_count only. A client will ask “which {item.comparable_count}?”.
                Add the engagements you actually used, or leave this blank — never type a count so the form accepts.
                Named engagements are not a column, so there is no control here that would pretend to save one.
              </p>
            </Card>

            <Card className={stale ? 'border-red-200 bg-red-50/70 dark:border-red-900 dark:bg-red-950/30' : ''}>
              <h2 className="text-sm font-extrabold tracking-tight">Proposal attachment</h2>
              {stale ? (
                <>
                  <p className="mt-2 max-w-xl text-[12.5px] leading-relaxed text-axal-ink dark:text-gray-100">
                    {staleAttachmentSentence(item.ran_at)}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className={primaryBtn}
                      onClick={() => {
                        setForm((current) => freshReadingForm(current, new Date().toISOString().slice(0, 10)));
                        setNotice(null);
                      }}
                    >
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
                  {band === 'ageing' && (
                    <p className="mt-1 text-[12.5px] text-amber-800 dark:text-amber-300">{ageingAttachmentNote(days)}</p>
                  )}
                  {attachments.length > 0 && (
                    <ul className="mt-2 space-y-1 text-[12.5px] text-axal-ink dark:text-gray-100">
                      {attachments.map((a) => (
                        <li key={a.uid}>
                          {a.proposal_name
                            ? `Attached to ${a.proposal_name}.`
                            : 'This reading is attached. The proposal is not named on the quote.'}
                        </li>
                      ))}
                    </ul>
                  )}
                  {proposals.length > 0 ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <select
                        aria-label="Proposal"
                        className={inputClass}
                        value={quoteId}
                        onChange={(e) => setQuoteId(e.target.value)}
                      >
                        {proposals.map((q) => (
                          <option key={q.id} value={q.id}>
                            {q.proposal_name || `Quote ${q.id} — proposal not named`}
                          </option>
                        ))}
                      </select>
                      <button type="button" className={ghostBtn} disabled={busy || !quoteId} onClick={attach}>
                        Attach to a proposal
                      </button>
                    </div>
                  ) : (
                    <p className="mt-2 text-[12px] text-axal-muted">
                      No proposal on this account. A reading attaches to a quote your partner profile owns.
                    </p>
                  )}
                </>
              )}
            </Card>

            <div data-testid="market-reading-draft" className={`rounded-[14px] border px-4 py-3.5 ${skin}`}>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-violet-700 px-2 py-0.5 text-[10px] font-extrabold tracking-[.06em] text-white">ZONEDRAFT</span>
                <span className="text-[13px] font-extrabold tracking-tight">Reading · demand movement</span>
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-axal-ink dark:text-gray-100">{draft}</p>
              {draftEdit !== '' && (
                <textarea
                  aria-label="Draft preview"
                  className={`${inputClass} min-h-[72px]`}
                  value={draftEdit}
                  onChange={(e) => setDraftEdit(e.target.value)}
                />
              )}
              {kept && (
                <p className="mt-2 text-[12px] text-axal-muted">Kept on this page for this visit: {kept}</p>
              )}
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <button type="button" className={primaryBtn} onClick={() => setDraftEdit(draft)}>Draft</button>
                <button
                  type="button"
                  className={ghostBtn}
                  disabled={!draft}
                  onClick={() => {
                    setKept(draftEdit.trim() || draft);
                    setDraftEdit('');
                  }}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className="px-1.5 py-1.5 text-[12px] font-semibold text-axal-muted disabled:opacity-40"
                  disabled={!draftEdit && !kept}
                  onClick={() => { setDraftEdit(''); setKept(''); }}
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
                Sector signals live on <Link to="/signals" className="text-axal-violet underline dark:text-violet-300">Signals</Link>. This page is about prices.
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
