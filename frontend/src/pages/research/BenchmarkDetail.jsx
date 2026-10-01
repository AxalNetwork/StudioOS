import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Card, Pill, Unreadable, Unrecorded, WorkerRail } from '../../ui';
import { api } from '../../lib/api';
import WorkspaceShell from '../../workspaces/WorkspaceShell';
import { StatedLimit } from '../advisor/expertise/kit';
import { benchmarkTiles, editorFields, editorPatch, readingDraft } from './benchmarkRead';

/**
 * `/research/benchmarking/:uid` — one benchmark (canvas f2eb2046, D314).
 *
 * TWO FIGURES, NEITHER COLOURED AS BETTER. A number beside a peer median
 * invites a conclusion the numbers alone do not support; that is what the
 * reading is for. A tracked row — no peer figure — draws Not recorded in the
 * peer half with its reason, never 0.
 *
 * THE BASE COMES FIRST. A comparison under ten reads the thin-base banner with
 * THIS row's own n, not the list's minimum.
 *
 * CONSTITUENTS ARE NAMES YOU TYPED (migration 303). The product ships no peer
 * data, so the list is empty until you name members, and a list whose count
 * disagrees with the stored n is stated, never corrected.
 *
 * THE DRAFT IS A RESTATEMENT, NOT A MODEL, as the canvas draws it: it repeats
 * the fields on the page, and Accept writes it as the reading.
 */

const eyebrow = 'text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint';
const th = 'pb-2 text-[10px] font-extrabold uppercase tracking-[.07em] text-axal-faint';
const inputClass = 'mt-1 w-full rounded-lg border border-axal-hairline bg-white px-2.5 py-1.5 text-[12.5px] text-axal-ink '
  + 'placeholder:text-axal-faint focus:border-indigo-500 focus:outline-none dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';
const primaryBtn = 'rounded-lg bg-indigo-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-indigo-700 '
  + 'disabled:cursor-not-allowed disabled:bg-indigo-200 disabled:text-indigo-800';
const ghostBtn = 'rounded-lg border border-indigo-200 px-3 py-1.5 text-[12px] font-semibold text-indigo-700 hover:bg-indigo-50 '
  + 'disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-900 dark:text-indigo-300 dark:hover:bg-indigo-950/40';

const EMPTY_CONSTITUENT = { name: '', value: '', as_of: '' };
const FIELDS = [
  ['metric', 'Metric', 200],
  ['our_value', 'Ours', 100],
  ['peer_value', 'Peer figure', 100],
  ['peer_source', 'Peer source', 300],
  ['peer_sample_size', 'Sample size', null],
  ['peer_as_of', 'Measured as of', 40],
];

function Tile({ k, v, sub, nr, warn }) {
  return (
    <Card className={warn ? 'border-amber-200 dark:border-amber-900' : ''}>
      <div className={eyebrow}>{k}</div>
      {nr
        ? <div className="mt-2"><Unrecorded /></div>
        : <div className={`mt-1.5 font-mono text-[20px] font-bold tracking-tight ${warn ? 'text-amber-800 dark:text-amber-300' : 'text-axal-ink dark:text-gray-100'}`}>{v}</div>}
      <p className="mt-1 text-[11.5px] leading-relaxed text-axal-muted">{sub}</p>
    </Card>
  );
}

export default function BenchmarkDetail({ role = 'investor' }) {
  const { uid } = useParams();
  const [detail, setDetail] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | missing | unreadable
  const [form, setForm] = useState(null);
  const [reading, setReading] = useState('');
  const [constituent, setConstituent] = useState(EMPTY_CONSTITUENT);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);

  const take = useCallback((d) => {
    setDetail(d);
    setForm(editorFields(d.item));
    setReading(d.item.reading || '');
  }, []);

  const load = useCallback(async () => {
    setState('loading');
    try {
      take(await api.research.benchmarkGet(uid));
      setState('ready');
    } catch (e) {
      setDetail(null);
      // D278 — the code decides; a uid that is not yours reads as missing.
      setState(e?.code === 'benchmark_not_found' ? 'missing' : 'unreadable');
    }
  }, [uid, take]);
  useEffect(() => { load(); }, [load]);

  const run = async (key, fn, ok) => {
    setBusy(key);
    setNotice(null);
    try {
      const d = await fn();
      if (d?.item) take(d);
      if (ok) setNotice({ ok: true, text: ok });
      return true;
    } catch (e) {
      setNotice({ ok: false, text: e?.message || 'That did not save.' });
      return false;
    } finally {
      setBusy('');
    }
  };

  const item = detail?.item || null;
  const cmp = Boolean(item?.is_comparison);
  const thin = Boolean(detail?.thin);
  const tiles = benchmarkTiles(item, { thin });
  const draft = readingDraft(item, { thin });
  const wantsPeer = Boolean(form?.peer_value?.trim());
  const cons = detail?.constituents || [];

  return (
    <WorkspaceShell
      role={role}
      title={item?.metric || 'Benchmark'}
      activeSlug="benchmarking"
      rail={(
        <WorkerRail
          workspace="Research"
          role="investor"
          stance="This page compares only what you entered and sourced"
          note="A peer figure carries its source and its sample. The product ships no peer data set and colours neither side as better."
          coverage={[item
            ? `${item.metric}: ${cmp ? `n=${item.peer_sample_size}` : 'tracked, not compared'}`
            : 'One benchmark']}
          unavailable={[
            ['A peer data set', 'Nothing here fetches or supplies peer figures; each one is yours.'],
            ['A ranking', 'Neither figure is coloured as winning.'],
          ]}
        />
      )}
    >
      <div data-testid="benchmark-detail" className="space-y-3">
        <Link to="/research/benchmarking" className="text-[12px] font-semibold text-indigo-700 underline dark:text-indigo-300">
          ‹ Benchmarking
        </Link>

        {state === 'loading' && (
          <Card variant="dashed" padding="lg"><p className="text-[12.5px] text-axal-muted">Loading this benchmark.</p></Card>
        )}
        {state === 'unreadable' && (
          <Card variant="dashed" padding="lg">
            <Unreadable what="This benchmark" claim="Nothing is shown rather than a figure the record may not hold." onRetry={load} />
          </Card>
        )}
        {state === 'missing' && (
          <Card padding="lg">
            <h1 className="text-[15px] font-extrabold tracking-tight">This benchmark is not on your list.</h1>
            <Link to="/research/benchmarking" className={`${ghostBtn} mt-3 inline-block`}>‹ Benchmarking</Link>
          </Card>
        )}

        {state === 'ready' && item && form && (
          <>
            {notice && (
              <p className={`text-[12px] font-semibold ${notice.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
                {notice.text}
              </p>
            )}

            <Card>
              <div className={eyebrow}>Benchmark</div>
              <h1 className="mt-1.5 text-2xl font-extrabold tracking-tight text-axal-ink dark:text-gray-100">{item.metric}</h1>
              <div className="mt-2 flex flex-wrap items-baseline gap-2 text-[13px]">
                <span className="font-mono font-bold">{item.our_value || <Unrecorded>Ours not recorded</Unrecorded>}</span>
                {cmp ? (
                  <>
                    <span className="text-axal-muted">vs</span>
                    <span className="font-mono font-bold">{item.peer_value}</span>
                    <Pill tone={thin ? 'warn' : 'neutral'}>{`n=${item.peer_sample_size}`}</Pill>
                  </>
                ) : (
                  <Pill tone="neutral">Tracked, not compared</Pill>
                )}
              </div>
              {cmp && (
                <p className="mt-1.5 text-[12px] text-axal-muted">
                  {`${item.peer_source} · as of `}{item.peer_as_of || <Unrecorded />}
                </p>
              )}
            </Card>

            {thin && (
              <div data-testid="benchmark-thin" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
                <div className="text-[13px] font-bold text-amber-800 dark:text-amber-300">Read the base before the number.</div>
                <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-gray-700 dark:text-gray-300">{detail.sample_note}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {tiles.map((t) => <Tile key={t.k} {...t} />)}
            </div>

            <Card data-testid="benchmark-comparison">
              <div className={eyebrow}>{cmp ? 'The comparison' : 'The figure'}</div>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <div>
                  <div className="text-[11px] font-semibold text-axal-muted">Ours</div>
                  <div className="mt-1 font-mono text-[32px] font-bold tracking-tight text-axal-ink dark:text-gray-100">
                    {item.our_value || <Unrecorded />}
                  </div>
                </div>
                <div className="border-t border-axal-hairline pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0 dark:border-gray-800">
                  <div className="text-[11px] font-semibold text-axal-muted">Peer</div>
                  {cmp ? (
                    <div className="mt-1 font-mono text-[32px] font-bold tracking-tight text-axal-ink dark:text-gray-100">{item.peer_value}</div>
                  ) : (
                    <>
                      <div className="mt-2"><Unrecorded /></div>
                      <p className="mt-1 text-[12px] text-axal-muted">
                        No peer figure is entered, so there is nothing to compare against. A zero here would be a number the record does not hold.
                      </p>
                    </>
                  )}
                </div>
              </div>
              <p className="mt-3 text-[11.5px] leading-relaxed text-axal-muted">
                {cmp
                  ? `${item.peer_source} · n=${item.peer_sample_size}${item.peer_as_of ? ` · as of ${item.peer_as_of}` : ''}. Neither figure is coloured as better: a number beside a peer median invites a conclusion the numbers alone do not support, which is what the reading is for.`
                  : 'Tracked without a peer. Nothing is coloured, ranked, or compared, because there is nothing to compare it to.'}
              </p>
            </Card>

            <Card>
              <div className="flex items-baseline justify-between gap-3">
                <span className={eyebrow}>What the comparison supports</span>
                <button type="button" className={ghostBtn} disabled={busy !== '' || reading === (item.reading || '')}
                  onClick={() => run('reading', () => api.research.benchmarkUpdate(uid, { reading: reading.trim() }), 'Reading saved.')}>
                  Save
                </button>
              </div>
              <textarea aria-label="What the comparison supports" className={`${inputClass} min-h-[72px]`} value={reading}
                placeholder="What this comparison does and does not support…" onChange={(e) => setReading(e.target.value)} />
              {!item.reading && (
                <p className="mt-1.5 text-[11.5px] text-axal-muted">
                  <Unrecorded /> <span className="ml-1">No read written yet — the comparison is shown without one.</span>
                </p>
              )}
            </Card>

            <Card data-testid="benchmark-constituents">
              <div className="flex items-baseline justify-between gap-3">
                <span className={eyebrow}>Peer constituents</span>
                <span className="text-[11px] text-axal-muted">
                  {cmp ? `${cons.length} named · n=${item.peer_sample_size}` : 'no peer set'}
                </span>
              </div>
              {cons.length > 0 && (
                <div className="mt-2.5 overflow-x-auto">
                  <table className="w-full text-left text-[12px]">
                    <thead><tr>{['Name', 'Value', 'As of', ''].map((h) => <th key={h || 'x'} className={th}>{h}</th>)}</tr></thead>
                    <tbody>
                      {cons.map((c) => (
                        <tr key={c.uid} className="border-t border-axal-hairline dark:border-gray-800">
                          <td className="py-2 pr-3 font-semibold">{c.name}</td>
                          <td className="py-2 pr-3 font-mono">{c.value || <Unrecorded />}</td>
                          <td className="py-2 pr-3 text-axal-muted">{c.as_of || <Unrecorded />}</td>
                          <td className="py-2 text-right">
                            <button type="button" className="text-[11.5px] font-semibold text-red-700 hover:underline disabled:opacity-50 dark:text-red-300"
                              disabled={busy !== ''}
                              onClick={() => run('remove', () => api.research.benchmarkConstituentRemove(uid, c.uid))}>
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {detail.count_mismatch && (
                <p data-testid="benchmark-mismatch" className="mt-2.5 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[12px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                  <span className="font-extrabold">! </span>
                  {`${detail.mismatch_note} The stored sample size is left as it is — a list that disagrees with the figure is a question for you, not something to silently correct.`}
                </p>
              )}
              {cons.length === 0 && (
                <p className="mt-2.5 text-[12px] text-axal-muted">
                  The product stores n only. Name the constituents or cite a published table. Do not invent funds.
                </p>
              )}
              {cmp ? (
                <div className="mt-3 rounded-xl border border-dashed border-axal-hairline p-3 dark:border-gray-700">
                  <div className={eyebrow}>Add a constituent</div>
                  <div className="mt-1 grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
                    <input aria-label="Constituent name" className={inputClass} placeholder="Name" maxLength={200}
                      value={constituent.name} onChange={(e) => setConstituent({ ...constituent, name: e.target.value })} />
                    <input aria-label="Constituent value" className={inputClass} placeholder="Value" maxLength={100}
                      value={constituent.value} onChange={(e) => setConstituent({ ...constituent, value: e.target.value })} />
                    <input aria-label="Constituent as of" className={inputClass} placeholder="As of" maxLength={40}
                      value={constituent.as_of} onChange={(e) => setConstituent({ ...constituent, as_of: e.target.value })} />
                    <button type="button" className={`${primaryBtn} mt-1`} disabled={!constituent.name.trim() || busy !== ''}
                      onClick={async () => {
                        const ok = await run('add', () => api.research.benchmarkConstituentAdd(uid, constituent));
                        if (ok) setConstituent(EMPTY_CONSTITUENT);
                      }}>
                      {busy === 'add' ? 'Adding…' : 'Add'}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-2.5 text-[11.5px] text-axal-muted">
                  A tracked row has no peer set to name members of. Enter a sourced peer figure below first.
                </p>
              )}
            </Card>

            <Card>
              <div className={eyebrow}>Edit this benchmark</div>
              <div className="mt-2 grid gap-3 sm:grid-cols-3">
                {FIELDS.map(([key, label, max]) => {
                  const req = wantsPeer && (key === 'peer_source' || key === 'peer_sample_size');
                  return (
                    <label key={key} className="block text-[11px] font-semibold text-axal-muted">
                      {label}{req ? ' *' : ''}
                      <input
                        aria-label={label}
                        className={`${inputClass} ${req && !String(form[key]).trim() ? 'border-amber-300 dark:border-amber-800' : ''}`}
                        type={key === 'peer_sample_size' ? 'number' : 'text'}
                        min={key === 'peer_sample_size' ? 1 : undefined}
                        maxLength={max || undefined}
                        placeholder="blank"
                        value={form[key]}
                        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                      />
                    </label>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button type="button" className={primaryBtn} disabled={busy !== '' || !form.metric.trim()}
                  onClick={() => run('save', () => api.research.benchmarkUpdate(uid, editorPatch(form)), 'Saved.')}>
                  {busy === 'save' ? 'Saving…' : 'Save'}
                </button>
                <span className="text-[11px] text-axal-muted">
                  {wantsPeer
                    ? 'A peer figure needs its source and sample size — the schema refuses the row without them.'
                    : 'Leave the peer field blank and the row stays tracked. Fill it and source and sample become required.'}
                </span>
              </div>
            </Card>

            <div data-testid="benchmark-draft" className="rounded-[14px] border border-indigo-200 bg-indigo-50 px-4 py-3.5 dark:border-indigo-900 dark:bg-indigo-950/40">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-extrabold tracking-[.06em] text-white">ZONEDRAFT</span>
                <span className="text-[13px] font-extrabold tracking-tight">Benchmark · what this supports</span>
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-axal-ink dark:text-gray-100">
                {draft
                  ? 'The draft restates only the fields on this page — it has no peer data set to reach for.'
                  : 'Enter ours or a sourced peer first.'}
              </p>
              {preview && (
                <textarea aria-label="Draft reading" className={`${inputClass} min-h-[72px]`} value={preview}
                  onChange={(e) => setPreview(e.target.value)} />
              )}
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <button type="button" className={primaryBtn} disabled={!draft || busy !== ''} onClick={() => setPreview(draft)}>Draft</button>
                <button type="button" className={ghostBtn} disabled={!preview.trim() || busy !== ''}
                  onClick={async () => {
                    const ok = await run('accept', () => api.research.benchmarkUpdate(uid, { reading: preview.trim() }), 'Written as the reading.');
                    if (ok) setPreview('');
                  }}>
                  Accept
                </button>
                <button type="button" className="px-1.5 py-1.5 text-[12px] font-semibold text-axal-muted disabled:opacity-40"
                  disabled={!preview} onClick={() => setPreview('')}>
                  Discard
                </button>
                <span className="text-[11px] text-axal-muted sm:ml-auto">Accept writes the reading. It does not invent a peer figure.</span>
              </div>
            </div>
          </>
        )}

        <StatedLimit title="Where the peer numbers come from">
          Nowhere but you. This product ships no peer data set and gathers none, so every comparison here is
          one you entered and sourced yourself. That is why the source and the sample travel with the figure
          and why nothing on this page is presented as a market rate.
        </StatedLimit>
      </div>
    </WorkspaceShell>
  );
}
