import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card, Pill, WorkerRail } from '../../ui';
import { api } from '../../lib/api';
import WorkspaceShell from '../../workspaces/WorkspaceShell';
import ZoneDraft from '../../workspaces/ZoneDraft';
import { Field, StatedLimit } from '../advisor/expertise/kit';
import { NO_STORE, gapCount, missingChecklist, updatedAgo } from './fundDossierRead';
import FundReportsPanel from './FundReportsPanel';

/**
 * `/research/funds/:uid` — one fund the founder has researched.
 *
 * THREE AXES, NEVER ONE. `stage_fit`, `path` and `status` are separate columns
 * and the selects edit them separately. A null stage is "not assessed", never
 * "wrong". A cold path is neutral, not a penalty. A pass with no reason is a
 * warning, not a blank.
 *
 * THE BRIEF IS DRAFTED FROM THIS ROW ALONE (D312). The `research/funds` draft
 * surface reads this one fund, owner-scoped, and marks every unrecorded fact
 * as a question to ask rather than a fact. It is never drafted on page load,
 * and not at all while the row holds neither a thesis nor a note. Accept
 * appends it to `note`, after what is already written; it does not email the
 * fund. The local "approach note" band it replaced put its own explanatory
 * sentence into the note on Accept.
 *
 * THE CHECKLIST COUNTS ONLY WHAT THIS PAGE CAN CLOSE. Rows derived from the
 * fund's columns are done or a gap. The canvas also draws a sourced
 * investment, a public size and the partner in the room; no store holds
 * those, so they read Not recorded with the reason and are not counted.
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

function exampleHost(value) {
  try {
    const raw = new URL(String(value)).hostname.toLowerCase();
    const host = raw.endsWith('.') ? raw.slice(0, -1) : raw;
    return host === 'example.com' || host === 'www.example.com';
  } catch {
    return false;
  }
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

function Tile({ k, v, sub, nr, tone = 'ink' }) {
  const ink = tone === 'ok'
    ? 'text-emerald-700 dark:text-emerald-300'
    : tone === 'warn'
      ? 'text-amber-800 dark:text-amber-300'
      : tone === 'danger'
        ? 'text-red-700 dark:text-red-300'
        : 'text-axal-ink';
  return (
    <Card>
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

  const checklist = missingChecklist(fund);
  const gaps = gapCount(checklist);
  const updated = updatedAgo(fund?.updated_at);
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
            ['A fit score', 'Nothing here scores a fund or ranks the list. The brief restates this row and asks about its gaps.'],
            ['Fund size and investments', 'No store holds a fund’s public size or what it has funded yet.'],
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
                        {fund.source_url}{exampleHost(fund.source_url) ? ' · placeholder' : ''}
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
                k="Last updated"
                nr={!updated}
                v={updated}
                sub={updated ? 'by you' : 'this row carries no update stamp'}
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

            <div className="grid gap-3 lg:grid-cols-2">
              <Card data-testid="fund-dossier-size">
                <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">Public size, if you recorded it</div>
                <div className="mt-2.5"><Nr /></div>
                <p className="mt-1.5 text-[12px] leading-relaxed text-axal-muted">
                  {NO_STORE.size} A missing year would be drawn as a gap, never as a fund that shrank.
                </p>
              </Card>
              <Card data-testid="fund-dossier-funded">
                <div className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">What they have funded</div>
                <div className="mt-2.5"><Nr /></div>
                <p className="mt-1.5 text-[12px] leading-relaxed text-axal-muted">
                  {NO_STORE.investments} An empty list here would not mean they have funded nothing.
                </p>
              </Card>
            </div>

            <FundReportsPanel fundUid={fund.uid} />

            <Card data-testid="fund-dossier-missing">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">What’s missing before a meeting</span>
                <span className={`text-[11px] font-bold ${gaps ? 'text-amber-800 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
                  {gaps ? `${gaps} ${gaps === 1 ? 'gap' : 'gaps'}` : 'nothing this page can close'}
                </span>
              </div>
              <ul className="mt-2.5 grid gap-x-6 gap-y-2 sm:grid-cols-2">
                {checklist.map((r) => (
                  <li key={r.key} className="flex items-start gap-2 text-[12px]">
                    <span
                      aria-hidden="true"
                      className={`mt-0.5 font-extrabold ${r.done === true ? 'text-emerald-700 dark:text-emerald-300' : r.done === false ? 'text-amber-800 dark:text-amber-300' : 'text-axal-faint'}`}
                    >
                      {r.done === true ? '✓' : r.done === false ? '○' : '–'}
                    </span>
                    <span>
                      <span className={`font-semibold ${r.done === false ? 'text-axal-ink dark:text-gray-100' : 'text-axal-muted'}`}>{r.label}</span>
                      {r.done === null ? <span className="ml-1.5"><Nr /></span> : null}
                      <span className="block text-[11px] text-axal-muted">{r.sub}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2.5 text-[11px] text-axal-muted">
                Rows marked Not recorded have no store yet, so they are not counted as gaps you can close here.
              </p>
            </Card>

            <ZoneDraft
              surface="research/funds"
              scopeKey={fund.uid}
              scoped
              accent="violet"
              label="Proposal · pre-meeting brief"
              run="Draft the brief"
              accept="Write into the note"
              empty="A short brief from this row alone: their thesis quoted back, your note, and every gap above turned into a question to ask. It will not name a partner, cite an AUM, or assume an introduction."
              nothingToDraft="Record a thesis or a note first — there is nothing to draft from."
              foot="Accept writes your note. It does not email them."
              onAccepted={load}
            />

            <StatedLimit title="What this page will not do">
              Nothing here scores a fund for you, ranks your list, or writes to the fund. The brief is drafted
              only when you press for it, from this row alone.
            </StatedLimit>
          </>
        )}
      </div>
    </WorkspaceShell>
  );
}
