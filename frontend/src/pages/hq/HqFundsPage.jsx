/**
 * HQ · Funds — oversight of every fund on the platform (D375, the Funds ·
 * Fabric canvas's F6 and F10), on the registry D245 built for canvas H24.
 *
 * ONE READ, `GET /api/admin/hq/funds`. HQ's own funds are the row "HQ"; every
 * branch answers the same `fundsRegistry` function over its own binding. Which
 * branch a fund belongs to is not a column — it is which database answered.
 *
 * F6 · OVERSIGHT, READ-ONLY. Five stats, the all-funds table and the flags
 * feed. What the canvas draws that no store holds is printed as Not recorded
 * with the Worker's own reason (`not_recorded` on the payload), never as a
 * figure: platform AUM and the FX date (no fund records a currency), TVPI
 * (no fund-level valuation), HQ's economics ledger and "HQ accrued" (revenue
 * per subsidiary stays not recorded by the owner's brief), and a filing
 * deadline such as franchise tax (no obligation store for a fund's entities).
 * A fund's jurisdiction is its linked vehicle entity's, and the GP entities'
 * count is of the linked GP entities' (D376, migration 314); an unlinked fund
 * reads Not recorded.
 *
 * F10 · HONESTY STATES. Each fund's flags come from the database that holds
 * it: no GP of record (which blocks LPA issue — D370 enforces it), custodian
 * not recorded, which GP-of-record facts are unset, and a report period
 * drafted and not issued. The page names THAT a fact is unset, never what a
 * set one says: the registry carries no person's name or email.
 *
 * THREE STATES PER READ, NEVER A ZERO. A branch that did not answer is one
 * Unreadable row; one provisioned with no binding is Not deployed. Inside an
 * answer, the call lines, the distributions and the report periods are each
 * their own read: one that failed reads Unreadable in its column, not 0% and
 * not "none". A branch still running a build from before D375 answers without
 * those fields, and its cells say "Not reported" rather than guessing.
 *
 * NO CURRENCY AND NO TOTAL. A committed figure is an amount with its currency
 * not recorded, drawn with no symbol; nothing sums across funds. Called % and
 * DPI divide one fund's own figures in its own currency, so each is a ratio.
 *
 * NOT BUILT: opening a fund's console from a row (the canvas's oversight
 * banner). No branch read renders a fund console, and the view-as overlay
 * reads only a branch's overview and accounts (D153); the page says so. There
 * is no /admin/fabric alias: it would be an /admin redirect, and the route
 * guard pins that set to one entry (D375).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Landmark } from 'lucide-react';
import { api } from '../../lib/api';
import { reportError } from '../../lib/log';
import { Card, WorkerRail, Unrecorded, Unreadable } from '../../ui';

const UNAVAILABLE = Symbol('unavailable');

const PILL = 'inline-block shrink-0 rounded-full px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-[.08em]';
const READ_PILL = {
  ok: ['Readable', 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300'],
  unreadable: ['Unreadable', 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300'],
  not_deployed: ['Not deployed', 'border border-axal-hairline bg-axal-ground text-axal-muted'],
};
const TONE = {
  bad: 'border-red-200 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300',
  warn: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200',
};

/** F6's eight columns, in the canvas's order. "Tenant" is a branch here. */
export const FUND_COLUMNS = ['Branch', 'Fund', 'Jurisdiction', 'Vintage', 'Committed', 'Called', 'DPI / TVPI', 'Flags'];

/** F10's GP-of-record facts, labelled as the canvas's `emptyGP` labels them. */
export const GP_FIELD_LABELS = {
  gp_name: 'GP name',
  gp_title: 'Title',
  gp_entity: 'GP entity',
  fund_admin: 'Fund administrator',
  auditor: 'Auditor',
};

const NOT_REPORTED = 'This deployment answered without the oversight fields: it runs a build from before they existed.';

/**
 * A committed amount in the minor units it travels in, as a plain number with
 * two decimals and NO currency symbol: the currency is not recorded, so any
 * symbol would be a guess. Null when the fund records none.
 */
export function committedText(fund) {
  const minor = fund?.committed_minor;
  if (typeof minor !== 'number' || !Number.isFinite(minor)) return null;
  return (minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * The last issue: the period and its date, "None issued" when the fund has
 * issued none, and null when the periods could not be read — which the page
 * draws as Unreadable, never as "none".
 */
export function issuedText(fund, periodsAvailable) {
  if (periodsAvailable === false || fund?.last_issued === undefined) return null;
  if (fund.last_issued === null) return 'None issued';
  const { period, issued_at: issuedAt } = fund.last_issued;
  return issuedAt ? `${period} · ${String(issuedAt).slice(0, 10)}` : String(period);
}

/** A ratio as a percentage, to one decimal where it has one. */
export function pctText(ratio) {
  return `${Math.round(ratio * 1000) / 10}%`;
}

/**
 * The Called cell. The source's `calls_available` decides between a failed
 * read and a branch that never sent the field; a fund with no committed figure
 * has nothing to divide by, which is not 0%.
 */
export function calledCell(fund, source) {
  if (source?.calls_available === false) return { kind: 'unreadable', reason: source.calls_reason || null };
  if (fund?.called_ratio === undefined) return { kind: 'not_reported', reason: NOT_REPORTED };
  if (fund.called_ratio === null) {
    return { kind: 'unrecorded', reason: 'No committed figure is recorded for this fund, so there is nothing to divide what is called by.' };
  }
  return { kind: 'value', text: pctText(fund.called_ratio) };
}

/** The DPI half of "DPI / TVPI". TVPI is always the Worker's Not recorded. */
export function dpiCell(fund, source) {
  if (source?.calls_available === false) return { kind: 'unreadable', reason: source.calls_reason || null };
  if (source?.distributions_available === false) return { kind: 'unreadable', reason: source.distributions_reason || null };
  if (fund?.dpi === undefined) return { kind: 'not_reported', reason: NOT_REPORTED };
  if (fund.dpi === null) return { kind: 'unrecorded', reason: 'Nothing has been called on this fund, so there is no DPI.' };
  return { kind: 'value', text: `${fund.dpi.toFixed(2)}×` };
}

/**
 * The Jurisdiction cell (D376): the fund's vehicle entity's jurisdiction. A
 * fund linked to no vehicle, or to one that records none, is Not recorded
 * with the Worker's reason; a failed entities read is Unreadable.
 */
export function jurisdictionCell(fund, source, reason) {
  if (source?.entities_available === false) return { kind: 'unreadable', reason: source.entities_reason || null };
  if (fund?.jurisdiction === undefined) return { kind: 'not_reported', reason: NOT_REPORTED };
  if (fund.jurisdiction === null) return { kind: 'unrecorded', reason: reason || null };
  return { kind: 'value', text: fund.jurisdiction };
}

/**
 * One fund's F10 flags, worst first, or null when the answer carries none
 * (a branch on an earlier build) — which is "not reported", never "clear".
 */
export function fundFlags(fund) {
  const f = fund?.flags;
  if (!f) return null;
  const out = [];
  if (f.no_gp_of_record) out.push({ key: 'no_gp', what: 'No GP of record', detail: 'blocks LPA issue', tone: 'bad' });
  if (f.draft_not_issued) {
    out.push({ key: 'draft', what: `${f.draft_not_issued.period} report drafted, not issued`, detail: 'no reporting cadence is stored', tone: 'warn' });
  }
  if (f.custodian_recorded === false) out.push({ key: 'custodian', what: 'Custodian not recorded', detail: null, tone: 'warn' });
  const unset = (f.gp_fields_unset || []).map((k) => GP_FIELD_LABELS[k] || k);
  if (unset.length) out.push({ key: 'gp_fields', what: 'GP of record facts not recorded', detail: unset.join(', '), tone: 'warn' });
  return out;
}

/**
 * Every answering source, HQ first: its label, its read state, and its data.
 * The branches keep the order the Worker sent them in.
 */
function sources(payload) {
  if (!payload) return [];
  return [
    { ...(payload.hq || {}), code: 'hq', label: 'HQ' },
    ...(payload.branches || []).map((b) => ({ ...b, label: b.label || b.code })),
  ];
}

/**
 * One row per fund, and one row per source with no fund to list, with the
 * state that explains why.
 */
export function fundRows(payload) {
  const rows = [];
  for (const s of sources(payload)) {
    if (s.status === 'ok' && s.data) {
      const funds = Array.isArray(s.data.funds) ? s.data.funds : [];
      if (!funds.length) rows.push({ key: `${s.code}:none`, kind: 'none', branch: s.label, code: s.code, read: 'ok' });
      for (const f of funds) {
        rows.push({ key: `${s.code}:${f.id}`, kind: 'fund', branch: s.label, code: s.code, read: 'ok', fund: f, source: s.data });
      }
      if (s.data.complete === false) rows.push({ key: `${s.code}:cut`, kind: 'cut', branch: s.label, code: s.code, read: 'ok' });
    } else {
      const read = s.status === 'not_deployed' ? 'not_deployed' : 'unreadable';
      rows.push({ key: `${s.code}:${read}`, kind: read, branch: s.label, code: s.code, read, reason: s.reason || null });
    }
  }
  return rows;
}

/** The flags feed: one item per flag on every fund that answered, worst first. */
export function flagFeed(payload) {
  const items = [];
  for (const r of fundRows(payload)) {
    if (r.kind !== 'fund') continue;
    for (const fl of fundFlags(r.fund) || []) {
      items.push({ ...fl, key: `${r.key}:${fl.key}`, who: `${r.fund.name} · ${r.branch}` });
    }
  }
  return items.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'bad' ? -1 : 1));
}

/**
 * F6's stats, counted ONLY from the sources that answered. "With a committed
 * figure" is the canvas's "with a close" said as what is stored. GP entities
 * are the distinct names recorded; a fund with none adds nothing.
 */
export function oversightStats(payload) {
  if (!payload) return null;
  const funds = fundRows(payload).filter((r) => r.kind === 'fund').map((r) => r.fund);
  const answered = sources(payload).filter((s) => s.status === 'ok');
  const cov = payload.branches_coverage || { total: 0, answered: 0 };
  const unreported = funds.filter((f) => !f.flags).length;
  return {
    funds: funds.length,
    withCommitted: funds.filter((f) => typeof f.committed_minor === 'number').length,
    gpEntities: new Set(funds.map((f) => f.gp_entity).filter(Boolean)).size,
    // D376: counted from GP entities an admin has linked, so it is a floor.
    jurisdictions: new Set(funds.map((f) => f.gp_entity_jurisdiction).filter(Boolean)).size,
    openFlags: flagFeed(payload).length,
    unreported,
    holding: answered.filter((s) => Array.isArray(s.data?.funds) && s.data.funds.length).length,
    coverage: `of ${cov.total} ${cov.total === 1 ? 'branch' : 'branches'}, ${cov.answered} answered`,
    complete: payload.hq?.status === 'ok' && cov.answered === cov.total,
  };
}

function ReadPill({ read }) {
  const [words, tone] = READ_PILL[read] || READ_PILL.unreadable;
  return <span className={`${PILL} ${tone}`}>{words}</span>;
}

/** A cell's value, or the state that stands in for it. */
function CellState({ cell }) {
  if (cell.kind === 'value') return <>{cell.text}</>;
  if (cell.kind === 'unreadable') {
    return <span className="italic text-red-700 dark:text-red-300" title={cell.reason || undefined}>Unreadable</span>;
  }
  if (cell.kind === 'not_reported') return <Unrecorded reason={cell.reason}>Not reported</Unrecorded>;
  return <Unrecorded reason={cell.reason} />;
}

function FlagPills({ fund }) {
  const flags = fundFlags(fund);
  if (flags === null) return <Unrecorded reason={NOT_REPORTED}>Not reported</Unrecorded>;
  if (!flags.length) return <span className="text-[10.5px] font-bold text-emerald-700 dark:text-emerald-300">clear</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {flags.map((f) => <span key={f.key} className={`${PILL} border ${TONE[f.tone]}`}>{f.what}</span>)}
    </span>
  );
}

/** The table, pure: it renders what it is given, so every state can be drawn by a test. */
export function FundsTable({ payload }) {
  const rows = fundRows(payload);
  const nr = payload?.not_recorded || {};
  return (
    <div className="overflow-x-auto" data-testid="hq-funds-table">
      <table className="w-full min-w-[860px] text-left text-[12px]">
        <thead>
          <tr className="text-[10px] font-extrabold uppercase tracking-[.08em] text-axal-faint">
            {FUND_COLUMNS.map((c) => (
              <th key={c} className="px-2 py-1.5" scope="col">
                {c}
                {c === 'Committed' && <span className="block font-medium normal-case tracking-normal">currency not recorded</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            if (r.kind === 'fund') {
              const f = r.fund;
              const committed = committedText(f);
              const issued = issuedText(f, r.source.periods_available !== false);
              return (
                <tr key={r.key} className="border-t border-axal-hairline align-top" data-testid="hq-funds-row">
                  <td className="px-2 py-2 font-semibold">{r.branch}</td>
                  <td className="px-2 py-2">
                    <div className="font-semibold text-axal-ink dark:text-white">{f.name}</div>
                    <div className="text-[10.5px] text-axal-faint">
                      {f.status || 'no stage'} · {f.gp_entity || <Unrecorded reason="The fund records no GP entity.">GP entity not recorded</Unrecorded>}
                    </div>
                    <div className="text-[10.5px] text-axal-faint">
                      Last issued:{' '}
                      {issued ?? <span className="italic text-red-700 dark:text-red-300" title={r.source.periods_reason || undefined}>Unreadable</span>}
                    </div>
                  </td>
                  <td className="px-2 py-2 font-mono text-[11px]"><CellState cell={jurisdictionCell(f, r.source, nr.jurisdiction)} /></td>
                  <td className="px-2 py-2 tabular-nums">
                    {f.vintage_year === undefined ? <Unrecorded reason={NOT_REPORTED}>Not reported</Unrecorded>
                      : f.vintage_year === null ? <Unrecorded reason="The fund records no vintage year." />
                        : f.vintage_year}
                  </td>
                  <td className="px-2 py-2 tabular-nums" title={f.committed_source ? `From ${f.committed_source}` : undefined}>
                    {committed ?? <Unrecorded reason="Neither the fund size nor the legacy total commitment is set." />}
                  </td>
                  <td className="px-2 py-2 tabular-nums"><CellState cell={calledCell(f, r.source)} /></td>
                  <td className="px-2 py-2 tabular-nums">
                    <CellState cell={dpiCell(f, r.source)} /> / <Unrecorded reason={nr.tvpi} />
                  </td>
                  <td className="px-2 py-2"><FlagPills fund={f} /></td>
                </tr>
              );
            }
            const statement = {
              none: 'No fund on this deployment',
              cut: 'The list stopped at its ceiling; more funds exist than one read returns',
              unreadable: 'Unreadable',
              not_deployed: 'Not deployed',
            }[r.kind];
            const detail = {
              none: 'It answered, and holds no fund.',
              cut: 'The rows above are the first by name.',
              unreadable: `It did not answer, which is not a claim that it runs no fund. ${r.reason || ''}`.trim(),
              not_deployed: r.reason || 'HQ holds a deployment row for it and no binding to read it through.',
            }[r.kind];
            return (
              <tr key={r.key} className="border-t border-axal-hairline bg-axal-ground/60" data-testid={`hq-funds-row-${r.kind}`}>
                <td className="px-2 py-2 font-semibold">{r.branch}</td>
                <td className="px-2 py-2 font-semibold text-axal-muted">{statement}</td>
                <td className="px-2 py-2 text-[11px] leading-snug text-axal-muted" colSpan={5}>{detail}</td>
                <td className="px-2 py-2"><ReadPill read={r.read} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** F6's five stats. Every one the canvas draws with no store says so with the Worker's reason. */
export function OversightStats({ payload }) {
  const s = oversightStats(payload);
  const nr = payload?.not_recorded || {};
  const tiles = [
    { k: 'Platform AUM', v: <Unrecorded reason={nr.platform_aum} />, note: nr.platform_aum },
    { k: 'Funds', v: s.funds, note: `${s.withCommitted} with a committed figure` },
    {
      k: 'GP entities',
      v: s.gpEntities,
      note: s.jurisdictions
        ? `across ${s.jurisdictions} ${s.jurisdictions === 1 ? 'jurisdiction' : 'jurisdictions'}, from linked GP entities`
        : <>jurisdictions: <Unrecorded reason={nr.jurisdiction} /></>,
    },
    { k: 'HQ accrued', v: <Unrecorded reason={nr.hq_economics} />, note: 'brand-licence share' },
    { k: 'Open flags', v: s.openFlags, note: s.unreported ? `${s.unreported} not reported` : 'see the feed', warn: s.openFlags > 0 },
  ];
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5" data-testid="hq-funds-stats">
      {tiles.map((t) => (
        <div key={t.k} className={`rounded-xl border p-3 ${t.warn ? TONE.warn : 'border-axal-hairline bg-white dark:bg-white/5'}`} data-testid="hq-funds-stat">
          <div className="text-[9px] font-extrabold uppercase tracking-[.08em] text-axal-faint">{t.k}</div>
          <div className="mt-1 text-[17px] font-extrabold tabular-nums">{t.v}</div>
          <div className="mt-1 text-[10px] leading-snug text-axal-muted">{t.note}</div>
        </div>
      ))}
    </div>
  );
}

/** The compliance flags feed, and the one kind of flag no store can raise. */
export function FlagFeed({ payload }) {
  const items = flagFeed(payload);
  return (
    <div data-testid="hq-funds-feed">
      {items.length === 0 && <p className="text-[12px] text-axal-muted">No flag on any fund that answered.</p>}
      <ul className="grid gap-2">
        {items.map((f) => (
          <li key={f.key} className={`rounded-lg border px-3 py-2 ${TONE[f.tone]}`} data-testid={`hq-funds-flag-${f.tone}`}>
            <div className="text-[11px] font-bold">{f.what}</div>
            <div className="mt-0.5 text-[10px] opacity-80">{f.who}{f.detail ? ` · ${f.detail}` : ''}</div>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] leading-relaxed text-axal-muted">
        Filing deadlines: <Unrecorded reason={payload?.not_recorded?.obligations} />. {payload?.not_recorded?.obligations}
      </p>
    </div>
  );
}

/**
 * F10, per fund: which GP-of-record facts are set, and — with no GP of record
 * — the block on LPA issue; a drafted period beside the last issued one.
 */
export function HonestyStates({ payload }) {
  const cards = [];
  for (const r of fundRows(payload)) {
    if (r.kind !== 'fund' || !r.fund.flags) continue;
    const f = r.fund;
    const unset = new Set(f.flags.gp_fields_unset || []);
    if (f.flags.no_gp_of_record || unset.size) {
      cards.push(
        <div key={`${r.key}:gp`} className={`rounded-xl border p-4 ${f.flags.no_gp_of_record ? 'border-amber-300 dark:border-amber-500/40' : 'border-axal-hairline'}`} data-testid="hq-funds-f10-gp">
          <div className="text-[12px] font-bold">{f.flags.no_gp_of_record ? 'Fund with no GP of record' : 'GP of record facts'}</div>
          <div className="text-[10.5px] text-axal-faint">{f.name} · {r.branch} · {f.status || 'no stage'}</div>
          <ul className="mt-2 divide-y divide-axal-hairline">
            {Object.entries(GP_FIELD_LABELS).map(([k, label]) => (
              <li key={k} className="flex justify-between gap-3 py-1.5 text-[11px]">
                <span className="text-axal-muted">{label}</span>
                {unset.has(k) ? <Unrecorded reason={`The fund records no ${label.toLowerCase()}.`} /> : <span>Recorded</span>}
              </li>
            ))}
          </ul>
          {f.flags.no_gp_of_record && (
            <div className={`mt-3 rounded-lg border p-3 ${TONE.bad}`} data-testid="hq-funds-lpa-block">
              <div className="text-[11.5px] font-bold">LPA issue is blocked</div>
              <p className="mt-1 text-[11px] leading-relaxed">
                An LPA is signed by the fund&rsquo;s general partner of record. With none on file there is nobody to
                sign as, so no LPA is drafted and a regenerate is refused, rather than a placeholder name being put into
                a document an LP will rely on. The fund can stay at its stage; it cannot issue.
              </p>
            </div>
          )}
          <p className="mt-2 text-[10.5px] text-axal-muted">LPA document: {f.flags.lpa_on_file ? 'on file' : 'none on file'}.</p>
        </div>,
      );
    }
    if (f.flags.draft_not_issued) {
      const issued = issuedText(f, r.source.periods_available !== false);
      cards.push(
        <div key={`${r.key}:draft`} className="rounded-xl border border-axal-hairline p-4" data-testid="hq-funds-f10-draft">
          <div className="text-[12px] font-bold">Report drafted, not issued</div>
          <div className="text-[10.5px] text-axal-faint">{f.name} · {r.branch}</div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-lg border border-dashed border-slate-300 p-2.5 dark:border-slate-600">
              <span className="font-extrabold">{f.flags.draft_not_issued.period}</span> <span className={`${PILL} bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300`}>Draft</span>
              <p className="mt-1 text-axal-muted">Numbers can still move, and no LP can open it.</p>
            </div>
            <div className="rounded-lg border border-emerald-200 p-2.5 dark:border-emerald-500/30">
              {f.last_issued
                ? <><span className="font-extrabold">{f.last_issued.period}</span> <span className={`${PILL} bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300`}>Issued</span></>
                : <span className="text-axal-muted">{issued}</span>}
              <p className="mt-1 text-axal-muted">The last issue LPs hold.</p>
            </div>
          </div>
          <p className="mt-2 text-[10.5px] text-axal-muted">{payload?.not_recorded?.report_cadence}</p>
        </div>,
      );
    }
  }
  return (
    <div className="grid gap-3 md:grid-cols-2" data-testid="hq-funds-f10">
      {cards.length ? cards : <p className="text-[12px] text-axal-muted">No fund that answered has an unset GP of record or a drafted, unissued report.</p>}
    </div>
  );
}

export default function HqFundsPage() {
  const [data, setData] = useState(null);
  const load = useCallback(() => {
    setData(null);
    api.hqFunds().then(setData, (e) => { reportError('hq-funds', e); setData(UNAVAILABLE); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const ready = data && data !== UNAVAILABLE;
  const stats = ready ? oversightStats(data) : null;
  const nr = ready ? data.not_recorded || {} : {};

  // ONE LINE PER READ THAT ANSWERED (D126): HQ's own table, the branches, and
  // each second table a source could not read.
  const partial = ready ? sources(data).filter((s) => s.status === 'ok' && s.data).flatMap((s) => [
    ...(s.data.calls_available === false ? [`${s.label}: call lines unreadable`] : []),
    ...(s.data.distributions_available === false ? [`${s.label}: distributions unreadable`] : []),
    ...(s.data.periods_available === false ? [`${s.label}: report periods unreadable`] : []),
    ...(s.data.entities_available === false ? [`${s.label}: fund entities unreadable`] : []),
  ]) : [];
  const coverage = ready ? [
    ...(data.hq?.status === 'ok' ? [`HQ: ${data.hq.data.funds.length} ${data.hq.data.funds.length === 1 ? 'fund' : 'funds'} read`] : []),
    `Branches: ${stats.coverage}`,
    `${stats.funds} ${stats.funds === 1 ? 'fund' : 'funds'} across ${stats.holding} ${stats.holding === 1 ? 'deployment' : 'deployments'}, ${stats.openFlags} open ${stats.openFlags === 1 ? 'flag' : 'flags'}`,
    ...partial,
  ] : [];

  const rail = (
    <WorkerRail
      workspace="Funds"
      role="super_admin"
      stance="Reads every fund on the platform, read-only"
      note="This rail reads back what the page loaded: HQ's own funds and every branch's, each read on its own. It changes nothing."
      coverage={coverage}
      coverageNote={coverage.length ? undefined
        : (data === null ? 'Reading the funds…' : 'The funds registry could not be read, so there is nothing to read back.')}
      unavailable={[
        ['Currency', ready ? data.committed_unit?.reason : 'No fund table records a currency.'],
        ['A total committed', ready ? data.total?.reason : 'The currency of each figure is not recorded, so no sum is shown.'],
        ['Platform AUM', nr.platform_aum || 'Not recorded.'],
        ['Jurisdiction', nr.jurisdiction || 'Not recorded.'],
        ['HQ economics', nr.hq_economics || 'Not recorded.'],
        ['TVPI', nr.tvpi || 'Not recorded.'],
        ['Filing deadlines', nr.obligations || 'Not recorded.'],
        ['Open in the branch', ready ? data.open_in_branch?.reason : 'Opening a branch’s Funds console from here is not built.'],
      ]}
      data-testid="hq-funds-rail"
    />
  );

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start lg:gap-6" data-testid="hq-funds-page">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#1e3a8a] px-4 py-2.5 text-white">
          <span className="flex items-center gap-2 text-[12.5px] font-bold">
            Oversight <span className="rounded bg-white/20 px-1.5 py-0.5 text-[9.5px] font-extrabold tracking-[.06em]">READ ONLY</span>
          </span>
          <span className="text-[11px] opacity-80 tabular-nums" data-testid="hq-funds-band">
            {data === null ? '…' : !ready ? 'the funds registry could not be read'
              : `${stats.funds} ${stats.funds === 1 ? 'fund' : 'funds'} · ${stats.coverage}`}
          </span>
        </div>

        <header>
          <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.09em] text-axal-faint">
            <Landmark size={13} /> HQ · Funds
          </div>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-axal-ink dark:text-white">Funds</h1>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-axal-muted">
            Every fund on the platform, read-only: which deployment runs it, its vintage, what is committed and called,
            and which facts it has not recorded. HQ&rsquo;s own funds are the row &ldquo;HQ&rdquo;; every branch is read
            over its own binding, and one that does not answer reads Unreadable without changing any other row.
          </p>
        </header>

        {data === UNAVAILABLE && (
          <Unreadable what="The funds registry" claim="This is not a claim that no deployment runs a fund." onRetry={load} />
        )}
        {data === null && <p className="text-[12.5px] text-axal-muted">Reading the funds…</p>}

        {ready && (
          <>
            <OversightStats payload={data} />
            <Card className="p-4">
              <h2 className="mb-2 text-[13px] font-bold">Every fund on the platform</h2>
              <FundsTable payload={data} />
              <p className="mt-3 text-[11px] leading-relaxed text-axal-muted" data-testid="hq-funds-note">
                A deployment that cannot be read reads Unreadable, not zero. Called and DPI divide one fund&rsquo;s own
                figures, so each is a ratio in that fund&rsquo;s currency. {data.committed_unit?.reason}{' '}
                {data.total?.reason}
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-axal-muted" data-testid="hq-funds-open-in-branch">
                {data.open_in_branch?.reason}
              </p>
            </Card>
            <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
              <Card className="p-4" data-testid="hq-funds-economics">
                <h2 className="text-[13px] font-bold">HQ economics</h2>
                <p className="mt-1 text-[12px]"><Unrecorded reason={nr.hq_economics} /></p>
                <p className="mt-1 text-[11px] leading-relaxed text-axal-muted">{nr.hq_economics}</p>
              </Card>
              <Card className="p-4">
                <h2 className="mb-2 text-[13px] font-bold">Compliance flags</h2>
                <FlagFeed payload={data} />
              </Card>
            </div>
            <Card className="p-4">
              <h2 className="mb-2 text-[13px] font-bold">Honesty states</h2>
              <HonestyStates payload={data} />
            </Card>
          </>
        )}

        <Card className="p-4">
          <p className="text-[12.5px] leading-relaxed text-axal-muted">
            HQ&rsquo;s own fund operations &mdash; capital calls, limited partners and reports &mdash; stay in the
            shared Funds product.
          </p>
          <Link
            to="/funds"
            className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-medium text-violet-700 underline dark:text-violet-300"
            data-testid="hq-funds-link-product"
          >
            Open HQ&rsquo;s fund operations
          </Link>
        </Card>
      </div>
      <div className="mt-4 lg:mt-0">{rail}</div>
    </div>
  );
}
