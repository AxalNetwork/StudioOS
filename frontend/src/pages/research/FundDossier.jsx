import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card, Pill, WorkerRail } from '../../ui';
import { api } from '../../lib/api';
import WorkspaceShell from '../../workspaces/WorkspaceShell';
import { Field, StatedLimit } from '../advisor/expertise/kit';

/**
 * `/research/funds/:uid` — one fund the founder has researched.
 *
 * THREE AXES, NEVER ONE. `stage_fit`, `path` and `status` are separate columns
 * and the selects edit them separately. A null stage is "not assessed", never
 * "wrong". A cold path is neutral, not a penalty. A pass with no reason is a
 * warning, not a blank.
 *
 * THE DRAFT IS A RESTATEMENT, NOT A MODEL. It can only repeat the thesis, the
 * note and the two reads already on the page. Accept writes that text into
 * `note`. It does not email the fund and it does not call the AI draft store.
 *
 * A BLANK CHEQUE IS NOT ZERO. Empty inputs PATCH null. The overlap sentence is
 * the worker's `overlap_note`, which leaves an unrecorded end open and refuses
 * to print an overlap of 0 against a missing raise.
 */

const STAGE = { right: 'Right stage', wrong: 'Wrong stage' };
const PATH = { warm: 'Warm path', cold: 'No route in' };
const STATUS = { researching: 'Researching', passed: 'Passed' };

const stageLabel = (v) => STAGE[v] || 'Stage not assessed';
const pathLabel = (v) => PATH[v] || 'Route not recorded';
const statusLabel = (v) => STATUS[v] || 'Researching';

const usd = (cents) => (cents == null
  ? null
  : `$${Math.round(Number(cents) / 100).toLocaleString('en-US')}`);

function chequeTile(lo, hi) {
  if (lo == null && hi == null) return { nr: true, sub: 'either end may be unknown' };
  if (lo != null && hi != null) return { v: `${usd(lo)}–${usd(hi)}`, sub: 'their range, in their terms' };
  if (lo != null) return { v: `${usd(lo)} and up`, sub: 'only the low end is recorded' };
  return { v: `up to ${usd(hi)}`, sub: 'only the high end is recorded' };
}

function parseDollars(text) {
  const raw = String(text ?? '').trim().replace(/[$,\s]/g, '');
  if (!raw) return { cents: null };
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
    return { error: 'Enter an amount like 500000, or leave the field blank.' };
  }
  return { cents: Math.round(Number(raw) * 100) };
}

function draftRestatement(fund) {
  if (!fund?.thesis && !fund?.note) {
    return 'Record a thesis or a note first — there is nothing to draft from.';
  }
  const parts = [];
  if (fund.thesis) parts.push('their thesis');
  if (fund.note) parts.push('your note');
  return 'Draft restates only what is on this page: '
    + `${parts.join(', ')}, ${stageLabel(fund.stage_fit).toLowerCase()}, ${pathLabel(fund.path).toLowerCase()}. `
    + 'It will not name a partner, cite an AUM, or assume an introduction.';
}

const inputClass =
  'mt-1 w-full rounded-lg border border-axal-hairline bg-axal-ground px-2.5 py-1.5 text-[12.5px] text-axal-ink '
  + 'placeholder:text-axal-faint focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 '
  + 'dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';

const selectClass =
  'rounded-lg border border-axal-hairline bg-axal-ground px-2.5 py-1.5 text-[12px] font-semibold text-axal-ink '
  + 'dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';

const primaryBtn =
  'rounded-lg bg-violet-700 px-3 py-1.5 text-[12px] font-semibold text-white '
  + 'hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-violet-300 disabled:opacity-70';

const ghostBtn =
  'rounded-lg border border-violet-200 px-3 py-1.5 text-[12px] font-semibold text-violet-800 '
  + 'hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-40 '
  + 'dark:border-violet-800 dark:text-violet-200 dark:hover:bg-violet-950/40';

function Nr() {
  return (
    <span className="inline-flex rounded border border-axal-hairline bg-axal-ground px-1.5 py-0.5 text-[10px] font-bold text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
      Not recorded
    </span>
  );
}

function Tile({ k, v, sub, nr, tone = 'ink', warnBorder = false }) {
  const ink = tone === 'ok'
    ? 'text-emerald-700 dark:text-emerald-300'
    : tone === 'warn'
      ? 'text-amber-800 dark:text-amber-300'
      : tone === 'danger'
        ? 'text-red-700 dark:text-red-300'
        : 'text-axal-ink';
  return (
    <Card className={warnBorder ? 'border-red-200 dark:border-red-800' : ''}>
      <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">{k}</div>
      {nr
        ? <div className="mt-2"><Nr /></div>
        : <div className={`mt-1.5 font-mono text-[17px] font-bold tracking-tight ${ink}`}>{v}</div>}
      <p className="mt-1 text-[12px] leading-relaxed text-axal-muted">{sub}</p>
    </Card>
  );
}

export default function FundDossier({ role = 'founder' }) {
  const { uid } = useParams();
  const [fund, setFund] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [note, setNote] = useState('');
  const [thesis, setThesis] = useState('');
  const [editingThesis, setEditingThesis] = useState(false);
  const [passReason, setPassReason] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [editingSource, setEditingSource] = useState(false);
  const [loText, setLoText] = useState('');
  const [hiText, setHiText] = useState('');
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const row = await api.research.fundGet(uid);
      setFund(row);
      setNote(row.note || '');
      setThesis(row.thesis || '');
      setPassReason(row.pass_reason || '');
      setSourceUrl(row.source_url || '');
      setLoText(row.cheque_min_cents == null ? '' : usd(row.cheque_min_cents));
      setHiText(row.cheque_max_cents == null ? '' : usd(row.cheque_max_cents));
      setEditingThesis(!row.thesis);
      setEditingSource(!row.source_url);
    } catch (e) {
      setFund(null);
      setError(e?.status === 404
        ? 'This fund is not on your list.'
        : (e?.message || 'The fund did not load.'));
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => { load(); }, [load]);

  const apply = async (patch) => {
    setNotice(null);
    setBusy(true);
    try {
      await api.research.fundUpdate(uid, patch);
      const row = await api.research.fundGet(uid);
      setFund(row);
      setNote(row.note || '');
      setThesis(row.thesis || '');
      setPassReason(row.pass_reason || '');
      setSourceUrl(row.source_url || '');
      setLoText(row.cheque_min_cents == null ? '' : usd(row.cheque_min_cents));
      setHiText(row.cheque_max_cents == null ? '' : usd(row.cheque_max_cents));
      setNotice({ ok: true, text: 'Saved.' });
      return row;
    } catch (e) {
      setNotice({ ok: false, text: e?.message || 'That did not save.' });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const saveCheque = async (which, text) => {
    const parsed = parseDollars(text);
    if (parsed.error) {
      setNotice({ ok: false, text: parsed.error });
      return;
    }
    const key = which === 'lo' ? 'cheque_min_cents' : 'cheque_max_cents';
    if ((fund?.[key] ?? null) === parsed.cents) return;
    await apply({ [key]: parsed.cents });
  };

  const canDraft = Boolean(fund?.thesis || fund?.note);
  const restatement = draftRestatement(fund);
  const ch = fund ? chequeTile(fund.cheque_min_cents, fund.cheque_max_cents) : null;
  const passed = fund?.status === 'passed';
  const passMissing = passed && !fund?.pass_reason;
  const httpSource = fund?.source_url && /^https?:\/\//i.test(fund.source_url) ? fund.source_url : null;

  return (
    <WorkspaceShell
      role={role}
      title={fund?.name || 'Fund'}
      activeSlug="funds"
      rail={(
        <WorkerRail
          workspace="Research"
          role={role}
          stance="This page does not score a fund or email one"
          note="Accept writes the note already on this page. It does not send anything."
          coverage={[fund
            ? `${fund.name}: ${stageLabel(fund.stage_fit)} · ${pathLabel(fund.path)} · ${statusLabel(fund.status)}`
            : 'One researched fund']}
          unavailable={[
            ['A fit score', 'Nothing here scores a fund, ranks the list, or drafts an approach.'],
            ['An email', 'Accept writes your note. It does not email them.'],
          ]}
        />
      )}
    >
      <div data-testid="fund-dossier" className="space-y-3">
        {loading && (
          <Card variant="dashed" padding="lg">
            <p className="text-[12.5px] text-axal-muted">Loading this fund.</p>
          </Card>
        )}
        {error && (
          <Card variant="dashed" padding="lg">
            <h2 className="text-sm font-extrabold tracking-tight">This did not load</h2>
            <p className="mt-2 max-w-xl text-[12.5px] leading-relaxed text-axal-muted">
              {error} Nothing is shown rather than an empty fund, because an empty page here would
              say the row has no reading — and that is not something this page can currently know.
            </p>
            <button type="button" onClick={load} className={`${ghostBtn} mt-3`}>Try again</button>
          </Card>
        )}

        {fund && (
          <>
            {notice && (
              <p className={`text-[12px] font-semibold ${notice.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
                {notice.text}
              </p>
            )}

            <Card>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Pill tone={passed ? 'danger' : 'neutral'}>{statusLabel(fund.status)}</Pill>
                    <Pill tone={fund.stage_fit === 'right' ? 'ok' : fund.stage_fit === 'wrong' ? 'warn' : 'neutral'}>
                      {stageLabel(fund.stage_fit)}
                    </Pill>
                    <Pill tone={fund.path === 'warm' ? 'ok' : 'neutral'}>{pathLabel(fund.path)}</Pill>
                  </div>
                  <div className="mt-2">
                    {httpSource ? (
                      <a href={httpSource} target="_blank" rel="noreferrer" className="text-[12px] font-semibold text-violet-700 underline dark:text-violet-300">
                        Their site →
                      </a>
                    ) : (
                      <span className="inline-flex flex-wrap items-center gap-2">
                        <Nr />
                        <span className="text-[12px] text-axal-muted">no source URL on this row</span>
                      </span>
                    )}
                    {httpSource && (
                      <span className="ml-2 font-mono text-[10px] text-axal-muted">
                        {fund.source_url}{/example\.com/i.test(fund.source_url) ? ' · placeholder' : ''}
                      </span>
                    )}
                  </div>
                  {(editingSource || !fund.source_url) && (
                    <div className="mt-2 max-w-md">
                      <Field label="Source URL" hint="Optional. A blank stays blank.">
                        <input
                          className={inputClass}
                          value={sourceUrl}
                          placeholder="https://"
                          onChange={(e) => setSourceUrl(e.target.value)}
                        />
                      </Field>
                      <button
                        type="button"
                        className={`${primaryBtn} mt-2`}
                        disabled={busy}
                        onClick={() => apply({ source_url: sourceUrl.trim() })}
                      >
                        Save source
                      </button>
                    </div>
                  )}
                  {fund.source_url && !editingSource && (
                    <button type="button" className={`${ghostBtn} mt-2`} onClick={() => setEditingSource(true)}>
                      Edit source
                    </button>
                  )}
                </div>
                <div>
                  <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Your read</div>
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                    <label className="block">
                      <span className="mb-1 block text-[9px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Stage</span>
                      <select
                        aria-label={`Stage fit for ${fund.name}`}
                        className={selectClass}
                        value={fund.stage_fit || ''}
                        onChange={(e) => apply({ stage_fit: e.target.value })}
                      >
                        <option value="">Stage not assessed</option>
                        <option value="right">Right stage</option>
                        <option value="wrong">Wrong stage</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[9px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Path</span>
                      <select
                        aria-label={`Route in for ${fund.name}`}
                        className={selectClass}
                        value={fund.path || ''}
                        onChange={(e) => apply({ path: e.target.value })}
                      >
                        <option value="">Route not recorded</option>
                        <option value="warm">Warm path</option>
                        <option value="cold">No route in</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[9px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Status</span>
                      <select
                        aria-label={`Status for ${fund.name}`}
                        className={selectClass}
                        value={fund.status || 'researching'}
                        onChange={(e) => apply({ status: e.target.value })}
                      >
                        <option value="researching">Researching</option>
                        <option value="passed">Passed</option>
                      </select>
                    </label>
                  </div>
                </div>
              </div>
            </Card>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile k="Cheque" nr={ch.nr} v={ch.v} sub={ch.sub} />
              <Tile
                k="Stage"
                v={stageLabel(fund.stage_fit)}
                sub="your read, not theirs"
                tone={fund.stage_fit === 'right' ? 'ok' : fund.stage_fit === 'wrong' ? 'warn' : 'ink'}
              />
              <Tile
                k="Path"
                v={pathLabel(fund.path)}
                sub={fund.path === 'warm' ? 'a route exists' : fund.path === 'cold' ? 'no route recorded in' : 'route not yet recorded'}
                tone={fund.path === 'warm' ? 'ok' : 'ink'}
              />
              <Tile
                k="Pass"
                v={passed ? 'Passed' : 'Live'}
                sub={passed ? (fund.pass_reason || 'no reason recorded') : 'still researching'}
                tone={passed ? 'danger' : 'ink'}
                warnBorder={passMissing}
              />
            </div>

            <p data-testid="fund-dossier-overlap" className="px-0.5 text-[12px] leading-relaxed text-axal-muted">
              {fund.overlap_note}
            </p>

            {passMissing && (
              <div
                data-testid="fund-dossier-pass-warn"
                className="flex items-start gap-2 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
              >
                <span className="font-extrabold" aria-hidden="true">!</span>
                <span>Passed with no reason recorded — worth adding one before you rediscover them.</span>
              </div>
            )}

            <div className="grid gap-3 lg:grid-cols-2">
              <Card>
                <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Their thesis</div>
                {fund.thesis && !editingThesis ? (
                  <>
                    <p className="mt-2.5 text-[18px] font-medium italic leading-snug text-axal-ink">“{fund.thesis}”</p>
                    <button type="button" className={`${ghostBtn} mt-3`} onClick={() => setEditingThesis(true)}>Edit thesis</button>
                  </>
                ) : (
                  <>
                    {!fund.thesis && (
                      <>
                        <div className="mt-2.5"><Nr /></div>
                        <p className="mt-1.5 text-[12px] text-axal-muted">quoted in their words, not summarised</p>
                      </>
                    )}
                    <Field label={fund.thesis ? 'Edit their words' : 'Record their words'}>
                      <textarea
                        className={`${inputClass} min-h-[88px]`}
                        value={thesis}
                        onChange={(e) => setThesis(e.target.value)}
                      />
                    </Field>
                    <button
                      type="button"
                      className={`${primaryBtn} mt-2`}
                      disabled={busy}
                      onClick={async () => {
                        const saved = await apply({ thesis });
                        if (saved) setEditingThesis(!saved.thesis);
                      }}
                    >
                      Save thesis
                    </button>
                  </>
                )}
              </Card>
              <Card>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">What the research says</span>
                  <button type="button" className={primaryBtn} disabled={busy} onClick={() => apply({ note })}>Save</button>
                </div>
                <textarea
                  aria-label="What the research says"
                  className={`${inputClass} min-h-[88px]`}
                  value={note}
                  placeholder="Your read of this fund…"
                  onChange={(e) => setNote(e.target.value)}
                />
                {!fund.note && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Nr />
                    <span className="text-[12px] text-axal-muted">the reading that matters is yours to write</span>
                  </div>
                )}
              </Card>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <Card>
                <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Cheque range</div>
                <div className="mt-2.5 grid grid-cols-2 gap-2.5">
                  <Field label="Low (USD)">
                    <input
                      data-testid="fund-dossier-cheque-low"
                      className={`${inputClass} font-mono`}
                      value={loText}
                      placeholder="blank"
                      inputMode="decimal"
                      onChange={(e) => setLoText(e.target.value)}
                      onBlur={() => saveCheque('lo', loText)}
                    />
                  </Field>
                  <Field label="High (USD)">
                    <input
                      data-testid="fund-dossier-cheque-high"
                      className={`${inputClass} font-mono`}
                      value={hiText}
                      placeholder="blank"
                      inputMode="decimal"
                      onChange={(e) => setHiText(e.target.value)}
                      onBlur={() => saveCheque('hi', hiText)}
                    />
                  </Field>
                </div>
                <p className="mt-2 text-[12px] leading-relaxed text-axal-muted">
                  Stored as cents; the UI is dollars. A blank stays blank — it is never written as 0.
                </p>
              </Card>
              <Card className={passMissing ? 'border-red-200 dark:border-red-800' : ''}>
                <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Pass reason</div>
                {passed ? (
                  <>
                    <textarea
                      aria-label="Pass reason"
                      className={`${inputClass} min-h-[56px] ${passMissing ? 'border-red-200 text-red-700 placeholder:text-red-400 dark:border-red-800 dark:text-red-300' : ''}`}
                      value={passReason}
                      placeholder="Passed with no reason recorded — worth adding one before you rediscover them."
                      onChange={(e) => setPassReason(e.target.value)}
                    />
                    <button type="button" className={`${primaryBtn} mt-2`} disabled={busy} onClick={() => apply({ pass_reason: passReason })}>
                      Save reason
                    </button>
                  </>
                ) : (
                  <p className="mt-2.5 text-[12px] leading-relaxed text-axal-muted">
                    Appears when the status is set to Passed. This fund is still live.
                  </p>
                )}
              </Card>
            </div>

            <div
              data-testid="fund-dossier-draft"
              className="rounded-[14px] border border-violet-200 bg-violet-50 px-4 py-3.5 dark:border-violet-900 dark:bg-indigo-950/50"
            >
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-violet-700 px-2 py-0.5 text-[10px] font-extrabold tracking-[.06em] text-white">ZONEDRAFT</span>
                <span className="text-[13px] font-extrabold tracking-tight">Fund · approach note</span>
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-axal-ink">{restatement}</p>
              {preview && (
                <textarea
                  aria-label="Draft preview"
                  className={`${inputClass} min-h-[72px]`}
                  value={preview}
                  onChange={(e) => setPreview(e.target.value)}
                />
              )}
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className={primaryBtn}
                  disabled={!canDraft || busy}
                  onClick={() => setPreview(restatement)}
                >
                  Draft the note
                </button>
                <button
                  type="button"
                  className={ghostBtn}
                  disabled={!preview.trim() || busy}
                  onClick={async () => {
                    const saved = await apply({ note: preview });
                    if (saved) setPreview('');
                  }}
                >
                  Accept note
                </button>
                <button
                  type="button"
                  className="px-1.5 py-1.5 text-[12px] font-semibold text-axal-muted disabled:opacity-40"
                  disabled={!preview || busy}
                  onClick={() => setPreview('')}
                >
                  Discard
                </button>
                <span className="text-[12px] text-axal-muted sm:ml-auto">
                  Accept writes your note. It does not email them.
                </span>
              </div>
            </div>

            <StatedLimit title="What this page will not do">
              Nothing here scores a fund for you, ranks your list, or drafts an approach.
            </StatedLimit>
          </>
        )}
      </div>
    </WorkspaceShell>
  );
}
