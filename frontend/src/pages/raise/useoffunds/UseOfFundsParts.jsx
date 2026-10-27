import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useOfFundsApi } from '../../../lib/api/useOfFunds';
import { Lightbox } from '../../../ui';
import {
  NOT_RECORDED, SECTIONS, centsFromTyped, dayText, money, roundSourceRows, sectionOf, splitCheck, sourceText,
} from './useOfFundsModel';
import Sheet from '../../../ui/Sheet.jsx';

/**
 * D1177 (#3104) — the Use of funds tool's shared parts: the plan read, the
 * cards, tiles and pills, three small charts that each have a table view, and
 * the dialogs (Edit split UF3, Add milestone UF6, Choose the round size UF13d).
 * Every change opens one of these; never a browser pop-up. Eadwyn fills
 * nothing here: no amount, share, runway, burn, hire cost or driver.
 */

export const CARD = 'rounded-xl border border-axal-hairline bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900';
export const H3 = 'm-0 text-[14px] font-extrabold text-axal-ink dark:text-gray-100';
export const MUTED = 'text-axal-muted dark:text-gray-400';
export const MONO = 'font-mono tabular-nums';
export const EYEBROW = 'text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
export const BTN = 'inline-flex min-h-[34px] items-center justify-center rounded-lg bg-axal-violet px-3 text-[12.5px] font-bold text-white disabled:opacity-50 max-md:min-h-[44px]';
export const BTN_GHOST = 'inline-flex min-h-[34px] items-center justify-center rounded-lg border border-axal-hairline bg-white px-3 text-[12.5px] font-bold text-axal-ink hover:bg-axal-ground disabled:opacity-50 max-md:min-h-[44px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
export const LINK = 'font-semibold text-axal-violet hover:text-axal-violet-deep dark:text-violet-300 dark:hover:text-violet-200';
export const FIELD = 'w-full rounded-lg border border-axal-hairline bg-white px-2.5 py-1.5 text-[13px] text-axal-ink max-md:min-h-[44px] dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100';

/** Each section's colour, light and dark (the canvas's S). */
export const SECTION_BG = {
  product: 'bg-violet-600 dark:bg-violet-400',
  'go-to-market': 'bg-sky-500 dark:bg-sky-400',
  infrastructure: 'bg-amber-500 dark:bg-amber-400',
  operations: 'bg-emerald-500 dark:bg-emerald-400',
  reserve: 'bg-gray-500 dark:bg-gray-400',
};

const TONE = {
  green: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  amber: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200',
  red: 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200',
  violet: 'border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-200',
  neutral: 'border-axal-hairline bg-gray-50 text-axal-muted dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
  dashed: 'border-dashed border-gray-300 text-axal-muted dark:border-gray-600 dark:text-gray-400',
};
export function Pill({ tone = 'neutral', children, testId }) {
  return <span className={`inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[11px] font-bold ${TONE[tone] || TONE.neutral}`} data-testid={testId}>{children}</span>;
}
/** A source pill: Typed, Connector, Document, Signed, Recorded or Modelled, with its detail. */
export function Source({ source, detail = '', testId }) {
  if (!source) return null;
  return <Pill tone={source === 'Modelled' ? 'neutral' : 'violet'} testId={testId}>{sourceText(source, detail)}</Pill>;
}
/** A value nobody recorded: "Not recorded", with its reason. Never a zero. */
export function NotRecorded({ reason, testId }) {
  return <span className="inline-flex flex-col gap-0.5" data-testid={testId}><Pill tone="dashed">{NOT_RECORDED}</Pill>{reason ? <span className={`text-[11.5px] ${MUTED}`}>{reason}</span> : null}</span>;
}

export function Card({ title, meta, children, testId, className = '' }) {
  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-2.5 ${className}`} data-testid={testId}>
      {title || meta ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {title ? <h3 className={H3}>{title}</h3> : <span />}
          {meta ? <span className={`text-[12px] ${MUTED}`}>{meta}</span> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** One block that could not be read: it says so, and the rest of the page still reads. */
export function BlockError({ text, onRetry, testId, tone = 'red' }) {
  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-[12.5px] font-semibold ${TONE[tone]}`} role="alert" data-testid={testId}>
      <span aria-hidden="true">!</span><span className="flex-1">{text}</span>
      {onRetry ? <button type="button" className={BTN_GHOST} onClick={onRetry}>Try again</button> : null}
    </div>
  );
}

export function Skeleton({ lines = 3, testId }) {
  const widths = ['92%', '74%', '86%', '60%', '70%'];
  return (
    <section className={`${CARD} flex flex-col gap-2`} aria-busy="true" data-testid={testId}>
      <span className={`text-[13px] ${MUTED}`}>Reading…</span>
      {Array.from({ length: lines }, (_, i) => <span key={i} className="block h-3 animate-pulse rounded bg-gray-100 dark:bg-gray-800" style={{ width: widths[i % widths.length] }} aria-hidden="true" />)}
    </section>
  );
}

/** One read, its state and its retry. `read` is called with nothing; a null `key` makes no read. */
export function useRead(read, key) {
  const [state, setState] = useState({ status: 'loading', data: null });
  const [n, setN] = useState(0);
  useEffect(() => {
    if (key == null) return undefined;
    let alive = true;
    setState((s) => ({ status: 'loading', data: s.data }));
    Promise.resolve().then(read)
      .then((data) => { if (alive) setState({ status: 'ready', data }); })
      .catch((error) => { if (alive) setState({ status: 'unreadable', data: null, code: error?.code || null }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, n]);
  const reload = useCallback(() => setN((x) => x + 1), []);
  return { ...state, reload };
}

/** The plan read (D1176's `GET /plan`). */
export const usePlan = (projectId, api = useOfFundsApi) => useRead(() => api.plan(projectId), projectId ? `plan:${projectId}` : null);

/** The banner an admin or Super Admin works under (UF16): their changes are logged under their name. */
export function AdminBanner({ viewer }) {
  if (viewer?.kind !== 'admin') return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-[12.5px] text-axal-ink dark:border-violet-800 dark:bg-violet-950 dark:text-gray-100" role="note" data-testid="uof-admin-banner">
      <span aria-hidden="true" className="font-extrabold text-axal-violet dark:text-violet-300">i</span>
      <span>You are viewing this venture’s Use of funds as an Admin. Changes are logged under your name.{viewer.mercury === false ? ' Mercury figures stay the founder’s.' : ''}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Charts. Each has a Chart | Table switch, and the table is the truth.
 * ------------------------------------------------------------------ */

export function ChartToggle({ view, onChange, id }) {
  return (
    <span className="inline-flex rounded-lg border border-axal-hairline p-0.5 text-[11.5px] font-semibold dark:border-gray-700" role="group" aria-label="Show as" data-testid={`${id}-toggle`}>
      {['chart', 'table'].map((v) => (
        <button key={v} type="button" aria-pressed={view === v} onClick={() => onChange(v)}
          className={`rounded-md px-2 py-0.5 max-md:min-h-[40px] ${view === v ? 'bg-violet-50 text-axal-ink dark:bg-violet-950 dark:text-gray-100' : MUTED}`}>
          {v === 'chart' ? 'Chart' : 'Table'}
        </button>
      ))}
    </span>
  );
}

/** "Where the money goes" (UF1, UF2): one bar split five ways, and its legend. */
export function StackBar({ rows, currency, testId = 'uof-stack' }) {
  const known = rows.filter((r) => typeof r.share === 'number');
  const complete = known.length === rows.length && known.reduce((a, r) => a + r.share, 0) === 100;
  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <span className={EYEBROW}>The raise</span>
      {complete ? (
        <div className="flex h-3 w-full overflow-hidden rounded-full" role="img"
          aria-label={`The raise split five ways: ${rows.map((r) => `${r.label} ${r.share} percent`).join(', ')}.`}>
          {rows.map((r) => (r.share ? <span key={r.key} className={SECTION_BG[r.key]} style={{ width: `${r.share}%` }} title={`${r.label} · ${r.share}%`} /> : null))}
        </div>
      ) : <div className="h-3 w-full rounded-full border border-dashed border-gray-300 dark:border-gray-600" aria-hidden="true" />}
      <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[12px]">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${SECTION_BG[r.key]}`} aria-hidden="true" />
            <span className="text-axal-ink dark:text-gray-100">{r.short}</span>
            <span className={`${MONO} ${MUTED}`}>{typeof r.share === 'number' ? `${r.share}%${money(r.amountCents, currency) ? ` · ${money(r.amountCents, currency)}` : ''}` : NOT_RECORDED}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A line over months (cash over time, the cash path). Points are { month, cents }. */
export function CashLine({ points, label, marker, testId }) {
  const vals = points.map((p) => p.cents);
  const max = Math.max(1, ...vals);
  const w = 560; const h = 160; const pad = 6;
  const x = (i) => pad + (i * (w - pad * 2)) / Math.max(1, points.length - 1);
  const y = (v) => h - pad - (Math.max(0, v) / max) * (h - pad * 2);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.cents).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-40 w-full" role="img" aria-label={label} data-testid={testId}>
      <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} className="stroke-gray-200 dark:stroke-gray-700" />
      <path d={d} fill="none" strokeWidth="2" className="stroke-violet-600 dark:stroke-violet-400" />
      {marker != null && marker >= 0 && marker < points.length ? (
        <line x1={x(marker)} y1={pad} x2={x(marker)} y2={h - pad} strokeDasharray="4 3" className="stroke-red-500 dark:stroke-red-400" />
      ) : null}
    </svg>
  );
}

/** Grouped or single columns (planned burn, plan vs actual). Groups are { key, label, values: [{ key, value, fill }] }. */
export function Columns({ groups, label, testId, format = (v) => v }) {
  const all = groups.flatMap((g) => g.values.map((v) => v.value).filter((v) => typeof v === 'number'));
  const max = Math.max(1, ...all);
  return (
    <div className="flex h-44 items-end gap-3" role="img" aria-label={label} data-testid={testId}>
      {groups.map((g) => (
        <div key={g.key} className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <div className="flex h-36 w-full items-end justify-center gap-1">
            {g.values.map((v) => (typeof v.value === 'number'
              ? <span key={v.key} className={`block w-1/2 max-w-[22px] rounded-t ${v.fill}`} style={{ height: `${Math.max(2, (v.value / max) * 100)}%` }} title={`${g.label} · ${format(v.value)}`} />
              : <span key={v.key} className="block h-full w-1/2 max-w-[22px] rounded-t border border-dashed border-gray-300 dark:border-gray-600" title={`${g.label} · ${NOT_RECORDED}`} />))}
          </div>
          <span className={`truncate text-[11px] ${MUTED}`}>{g.label}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Dialogs
 * ------------------------------------------------------------------ */

function DialogButtons({ busy, onClose, go, goLabel, disabled, testId }) {
  return (
    <div className="flex justify-end gap-2 max-md:[&>*]:flex-1">
      <button type="button" className={BTN_GHOST} onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className={BTN} onClick={go} disabled={busy || disabled} data-testid={testId}>{busy ? 'Saving…' : goLabel}</button>
    </div>
  );
}

const refusal = (e) => (e?.message ? `${e.message}` : 'It was not saved. Read the plan again before retrying.');

/** UF3: the raise, the five shares with their amounts, the live total and the target runway. */
export function EditSplitDialog({ projectId, base, viewer, onClose, onSaved, api = useOfFundsApi }) {
  const start = Object.fromEntries(SECTIONS.map((s) => [s.key, String(base?.lines?.find((l) => l.category_key === s.key)?.share_pct ?? '')]));
  const [shares, setShares] = useState(start);
  const [amount, setAmount] = useState(base?.amount_to_raise_cents != null ? String(base.amount_to_raise_cents / 100) : '');
  const [target, setTarget] = useState(base?.target_runway_months ?? 18);
  const [custom, setCustom] = useState(![18, 24].includes(Number(base?.target_runway_months ?? 18)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const check = splitCheck(shares);
  const cents = centsFromTyped(amount);
  const months = Number(target);
  const monthsOk = Number.isInteger(months) && months >= 1 && months <= 120;
  const save = async () => {
    setBusy(true); setError('');
    try {
      await api.saveSplit(projectId, { amount_to_raise_cents: cents, runway_months: months, sections: SECTIONS.map((s) => ({ key: s.key, pct: Number(shares[s.key]) })) });
      onSaved('The split is saved. The deck’s Ask slide is marked out of sync.');
    } catch (e) { setError(refusal(e)); }
    setBusy(false);
  };
  return (
    <Sheet label="Edit split" title="Edit split" sub="Shares are whole percentages and add up to 100." onClose={onClose} width={620} phone="sheet" testId="uof-edit-split"
      footer={<DialogButtons busy={busy} onClose={onClose} go={save} goLabel="Save split" disabled={!check.ok || cents == null || !monthsOk} testId="uof-split-save" />}>
      <div className="flex flex-col gap-3 text-axal-ink dark:text-gray-100">
        {viewer?.kind === 'admin' ? <p className={`m-0 text-[12px] ${MUTED}`} data-testid="uof-split-admin">You are saving as an Admin. The change is logged under your name.</p> : null}
        <label className="flex flex-col gap-1"><span className={EYEBROW}>Amount to raise</span>
          <input className={`${FIELD} ${MONO}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount to raise" data-testid="uof-split-amount" />
          {amount && cents == null ? <span className="text-[12px] text-red-700 dark:text-red-300">Type a whole amount, like 1500000.</span> : null}
        </label>
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className={EYEBROW}>Split</legend>
          {SECTIONS.map((s) => {
            const pct = Number(shares[s.key]);
            const part = cents != null && Number.isFinite(pct) ? money(Math.round((cents * pct) / 100)) : null;
            return (
              <div key={s.key} className="grid grid-cols-[minmax(0,1fr)_84px] items-center gap-2">
                <div className="min-w-0">
                  <div className="text-[13px] font-bold">{s.label}</div>
                  <div className={`text-[11.5px] ${MUTED}`}>{part ? `${part} of the raise` : NOT_RECORDED}</div>
                  <span className="mt-1 block h-2 rounded-full bg-gray-100 dark:bg-gray-800"><span className={`block h-2 rounded-full ${SECTION_BG[s.key]}`} style={{ width: `${Math.min(100, Math.max(0, pct || 0))}%` }} /></span>
                </div>
                <label className="flex items-center gap-1"><input className={`${FIELD} ${MONO} text-right`} inputMode="numeric" value={shares[s.key]} aria-label={`${s.label} share`}
                  onChange={(e) => setShares((x) => ({ ...x, [s.key]: e.target.value.trim() }))} data-testid={`uof-split-${s.key}`} /><span className={MUTED}>%</span></label>
              </div>
            );
          })}
          <div className="flex items-center justify-between border-t border-axal-hairline pt-2 dark:border-gray-800">
            <span className="text-[13px] font-bold">Total</span>
            <span className={`${MONO} text-[14px] font-bold ${check.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`} data-testid="uof-split-total">{`${check.total}%`}</span>
          </div>
          {!check.ok ? <p className="m-0 text-[12px] text-red-700 dark:text-red-300" data-testid="uof-split-wait">The shares must be whole numbers that add up to 100. Save waits until they do.</p> : null}
        </fieldset>
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className={EYEBROW}>Your target runway</legend>
          <div className="flex flex-wrap gap-2">
            {[18, 24].map((m) => (
              <button key={m} type="button" aria-pressed={!custom && Number(target) === m} className={BTN_GHOST} onClick={() => { setCustom(false); setTarget(m); }}>{m} months</button>
            ))}
            <button type="button" aria-pressed={custom} className={BTN_GHOST} onClick={() => setCustom(true)}>Custom</button>
          </div>
          {custom ? <input className={`${FIELD} ${MONO} w-28`} inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Target runway in months" data-testid="uof-split-target" /> : null}
          {!monthsOk ? <span className="text-[12px] text-red-700 dark:text-red-300">A target is 1 to 120 months.</span> : null}
        </fieldset>
        <p className={`m-0 text-[12px] ${MUTED}`}>The pitch deck’s Ask slide reads this split. Saving marks it out of sync.</p>
        {error ? <p role="alert" className="m-0 text-[12.5px] font-semibold text-red-700 dark:text-red-300" data-testid="uof-split-error">{error}</p> : null}
      </div>
    </Sheet>
  );
}

/** UF6: a milestone names what a section's money pays for, by a month. An empty cost stays Not costed, never 0. */
export function AddMilestoneDialog({ projectId, onClose, onSaved, api = useOfFundsApi }) {
  const [label, setLabel] = useState('');
  const [section, setSection] = useState('product');
  const [by, setBy] = useState('');
  const [cost, setCost] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cents = cost.trim() === '' ? null : centsFromTyped(cost);
  const byOk = by === '' || /^\d{4}-(0[1-9]|1[0-2])$/.test(by);
  const save = async () => {
    setBusy(true); setError('');
    try {
      await api.createMilestone(projectId, { label: label.trim(), category_key: section, due_on: by || null, cost_cents: cents });
      onSaved(cents == null ? 'The milestone is added. It stays Not costed until you add a cost.' : 'The milestone is added.');
    } catch (e) { setError(refusal(e)); }
    setBusy(false);
  };
  return (
    <Lightbox label="Add milestone" title="Add milestone" sub="A milestone names what a section’s money pays for, by a month." onClose={onClose} width={520} phone="sheet" testId="uof-add-milestone"
      footer={<DialogButtons busy={busy} onClose={onClose} go={save} goLabel="Add milestone" disabled={!label.trim() || !byOk || (cost.trim() !== '' && cents == null)} testId="uof-milestone-save" />}>
      <div className="flex flex-col gap-3 text-axal-ink dark:text-gray-100">
        <label className="flex flex-col gap-1"><span className={EYEBROW}>Name</span><input className={FIELD} value={label} onChange={(e) => setLabel(e.target.value)} data-testid="uof-milestone-label" /></label>
        <label className="flex flex-col gap-1"><span className={EYEBROW}>Section</span>
          <select className={FIELD} value={section} onChange={(e) => setSection(e.target.value)} data-testid="uof-milestone-section">
            {SECTIONS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select></label>
        <label className="flex flex-col gap-1"><span className={EYEBROW}>By</span><input className={`${FIELD} ${MONO}`} placeholder="2027-03" value={by} onChange={(e) => setBy(e.target.value)} data-testid="uof-milestone-by" />
          {!byOk ? <span className="text-[12px] text-red-700 dark:text-red-300">A month is written like 2027-03.</span> : null}</label>
        <label className="flex flex-col gap-1"><span className={EYEBROW}>Cost · optional</span>
          <input className={`${FIELD} ${MONO}`} inputMode="decimal" placeholder="Leave empty to keep it Not costed" value={cost} onChange={(e) => setCost(e.target.value)} data-testid="uof-milestone-cost" />
          <span className={`text-[12px] ${MUTED}`}>An empty cost stays Not costed, never 0.</span></label>
        {error ? <p role="alert" className="m-0 text-[12.5px] font-semibold text-red-700 dark:text-red-300" data-testid="uof-milestone-error">{error}</p> : null}
      </div>
    </Lightbox>
  );
}

/** UF13d: the plan, the round and the cap-table scenario then read the same raise. Only a recorded size is offered. */
export function RoundSizeDialog({ projectId, plan, onClose, onSaved, api = useOfFundsApi }) {
  const base = plan?.base?.value;
  const options = roundSourceRows(plan).filter((r) => r.cents != null);
  const [pick, setPick] = useState(options.find((o) => o.chosen)?.key ?? options[0]?.key ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const chosen = options.find((o) => o.key === pick);
  const save = async () => {
    setBusy(true); setError('');
    try {
      await api.updateScenario(projectId, base.id, { amount_to_raise_cents: chosen.cents });
      onSaved(`This plan now raises ${chosen.raise}. Your split keeps its shares.`);
    } catch (e) { setError(refusal(e)); }
    setBusy(false);
  };
  return (
    <Sheet label="Choose the round size" title="Choose the round size" sub="The plan, the round and the cap-table scenario then read the same raise." onClose={onClose} width={620} phone="sheet" testId="uof-round-size"
      footer={<DialogButtons busy={busy} onClose={onClose} go={save} goLabel="Use this size" disabled={!chosen || !base?.id || chosen.cents === base?.amount_to_raise_cents} testId="uof-round-save" />}>
      <div className="flex flex-col gap-2 text-axal-ink dark:text-gray-100">
        {options.length ? options.map((o) => (
          <label key={o.key} className="flex min-h-[44px] items-start gap-2 text-[13px]" data-testid={`uof-round-${o.key}`}>
            <input type="radio" name="round" checked={pick === o.key} onChange={() => setPick(o.key)} className="mt-1" />
            <span><span className={`${MONO} font-bold`}>{o.raise}</span> · {o.label} · <span className={MUTED}>{o.source}</span></span>
          </label>
        )) : <p className={`m-0 text-[12.5px] ${MUTED}`}>No recorded round size to choose from.</p>}
        <p className={`m-0 text-[12px] ${MUTED}`}>Choosing a size changes this plan’s raise. Your split keeps its shares.</p>
        {error ? <p role="alert" className="m-0 text-[12.5px] font-semibold text-red-700 dark:text-red-300" data-testid="uof-round-error">{error}</p> : null}
      </div>
    </Sheet>
  );
}

/** "Where this plan is used" (UF13): the round's sources, the disagreement, the cap table and the deck. */
export function WhereUsedDialog({ plan, rows, onClose, onRound }) {
  const sources = roundSourceRows(plan);
  return (
    <Sheet label="Where this plan is used" title="Where this plan is used" onClose={onClose} width={720} testId="uof-where-used">
      <div className="flex flex-col gap-3 text-axal-ink dark:text-gray-100">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-left text-[12.5px]" data-testid="uof-round-table">
            <thead><tr>{['Source', 'Raise', ''].map((h, i) => <th key={i} className={`border-b border-axal-hairline px-2 py-1.5 dark:border-gray-800 ${EYEBROW}`}>{h}</th>)}</tr></thead>
            <tbody>{sources.map((r) => (
              <tr key={r.key}>
                <td className="border-b border-axal-hairline px-2 py-1.5 dark:border-gray-800">{r.label}{r.chosen ? <span className={`ml-1 text-[11px] ${MUTED}`}>· used by this plan</span> : null}</td>
                <td className={`border-b border-axal-hairline px-2 py-1.5 ${MONO} dark:border-gray-800`}>{r.raise || <NotRecorded reason={r.reason} />}</td>
                <td className="border-b border-axal-hairline px-2 py-1.5 dark:border-gray-800"><Pill>{r.source}</Pill></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {plan?.round?.disagreements?.length ? (
          <div className="flex flex-wrap items-center gap-2" data-testid="uof-round-differs">
            <Pill tone="amber">! Recorded round sizes differ</Pill>
            {plan?.viewer?.can_write ? <button type="button" className={BTN_GHOST} onClick={onRound}>Choose the round size</button> : null}
          </div>
        ) : null}
        {rows.filter((r) => r.key !== 'round').map((r) => (
          <div key={r.key} className="flex flex-wrap items-center justify-between gap-2 border-t border-axal-hairline pt-2 dark:border-gray-800">
            <div><div className={EYEBROW}>{r.eyebrow}</div><div className="text-[13px] font-bold">{r.text}</div></div>
            <span className="flex items-center gap-2">{r.pill ? <Pill tone={r.tone}>{r.pill}</Pill> : null}{r.href ? <Link className={LINK} to={r.href}>Open ›</Link> : null}</span>
          </div>
        ))}
        <p className={`m-0 text-[11.5px] ${MUTED}`}>No explicit link between this plan and a cap-table scenario is stored, so their dilution is not compared here.</p>
      </div>
    </Sheet>
  );
}

export { dayText, money, sectionOf };
