/**
 * D6038 (#6038; Build v2 BD11, BD25, BD26, BD29, BD30, BD31) — Company
 * creation's own page (`def.homes`, D6049): it starts from the company, not
 * from a filing table.
 *
 *   · No company yet (BD26, BD30 E): one state, Incorporate first, with Start
 *     guided incorporation and "Already incorporated elsewhere? Add a filing",
 *     and a greyed preview of what follows that carries no figures.
 *   · Otherwise (BD25): the entity summary band with its order line, the one
 *     nearest-deadline filing as the page's primary action, the 83(b) tracker
 *     (one row per founder), the BD11 filings table with where each filing is
 *     changed, its supporting tools (Add another filing, Legal documents,
 *     E-signature), documents with Stored or Missing, the After formation
 *     steps and the hand-off links. D9101 (#9101): the IP step's Record IP
 *     assignment copies the founder's accepted Spin-Out application's IP.
 *
 * Each block draws its own state (BD29): a block whose read failed says so,
 * on that block only, and the rest of the page still works. The words come
 * from `companyCreationModel.js`, so desktop and phone say the same. Every
 * colour has its `dark:` pair (BD31), and no state is carried by colour alone.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PhoneRows, Unreadable } from '../../ui';
import { spinoutLab } from '../../lib/api';
import { cyclesWrite } from '../../lib/api/cycles';
import { useViewMode } from '../../contexts/ViewModeContext';
import { isFounderPreview } from './previewUploadModel.js';
import { RecordsTable } from './CycleModulePage.jsx';
import { safeHref, isPlainClick } from './cycleModel';
import { incorporateFirst, listStage, progressiveFor } from './progressiveList.js';
import {
  documentsView, dominantView, electionView, filingRows, ipStep, runIpCopy, sourcesIn, suggestionHref, suggestionsView, summaryView, ventureQuery,
} from './companyCreationModel.js';
import { FilingsExport, PapersToDataRoom } from './CompanyCreationHandoffs.jsx';

const CARD = 'rounded-xl border border-axal-hairline bg-white dark:border-gray-800 dark:bg-gray-900';
const H2 = 'm-0 text-[15px] font-extrabold tracking-[-.015em] text-axal-ink dark:text-gray-100';
const MUTED = 'text-[12px] text-axal-muted dark:text-gray-400';
const LINK = 'text-[12.5px] font-semibold text-axal-violet-deep hover:underline dark:text-violet-300';
const PRIMARY = 'inline-flex min-h-[44px] items-center justify-center rounded-[10px] bg-axal-violet px-4 py-2.5 text-[13.5px] font-bold text-white hover:bg-axal-violet-deep';

/** Each state's word and glyph (BD25's legend): the word and the glyph carry it, the colour only helps. */
const TAGS = {
  Stored: ['✓', 'ok'], Filed: ['✓', 'ok'], Issued: ['✓', 'ok'], Confirmed: ['✓', 'ok'], 'Filed · Build filing': ['✓', 'ok'], Connected: ['✓', 'ok'],
  Pending: ['◷', 'pr'], Mailed: ['↗', 'pr'], 'Not issued yet': ['◷', 'pr'],
  Missing: ['▲', 'at'], 'Due soon': ['▲', 'at'],
  Missed: ['✕', 'ur'], Overdue: ['✕', 'ur'], Unreadable: ['!', 'ur'],
  'Not recorded': ['○', 'nr'], 'Not expected yet': ['–', 'nr'], 'Read only': ['🔒︎', 'nr'],
};
const TONE = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300',
  pr: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-400/40 dark:bg-violet-400/10 dark:text-violet-300',
  at: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/45 dark:bg-amber-500/10 dark:text-amber-300',
  ur: 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/45 dark:bg-red-500/10 dark:text-red-300',
  nr: 'border-dashed border-gray-300 bg-axal-ground text-axal-muted dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400',
};
export function Tag({ word, label }) {
  const [glyph, tone] = TAGS[word] || ['•', 'nr'];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-px text-[11px] font-bold ${TONE[tone]}`} data-state-word={word}>
      <span aria-hidden="true">{glyph}</span>{label || word}
    </span>
  );
}

function Block({ title, line, testid, children, aside = null }) {
  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-3 px-4 py-3.5`} data-testid={testid} aria-label={title}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-x-2.5"><h2 className={H2}>{title}</h2>{line && <span className={MUTED}>{line}</span>}</div>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Loading({ lines = 3 }) {
  return <div className="flex flex-col gap-2" aria-busy="true">{Array.from({ length: lines }, (_, i) => <div key={i} className="h-4 rounded bg-axal-ground dark:bg-gray-800" />)}</div>;
}

/** The order's three steps (Order paid → Packet ready → Filed with state); a step with no date is not done. */
function OrderLine({ order }) {
  return (
    <ol className="m-0 flex list-none flex-wrap items-center gap-x-2 gap-y-1 p-0" aria-label="Incorporation order" data-testid="company-order-line">
      {order.steps.map((s, i) => (
        <li key={s.label} className="flex items-center gap-2 text-[12.5px]">
          <span className={s.done ? 'font-semibold text-axal-ink dark:text-gray-100' : 'text-axal-muted dark:text-gray-400'}>
            <span aria-hidden="true">{s.done ? '✓ ' : '○ '}</span>{s.label}{s.date ? ` · ${s.date}` : ' · not yet'}
          </span>
          {i < order.steps.length - 1 && <span aria-hidden="true" className="text-axal-faint">→</span>}
        </li>
      ))}
    </ol>
  );
}

export function Summary({ view, phone = false, onRetry }) {
  if (view.state === 'loading') return <section className={`${CARD} px-4 py-3.5`} data-testid="company-summary" data-state="loading"><Loading lines={2} /></section>;
  if (view.state === 'unreadable') {
    return <section className={`${CARD} px-4 py-3.5`} data-testid="company-summary" data-state="unreadable"><Unreadable what="The company summary" claim={view.reason} onRetry={onRetry} /></section>;
  }
  return (
    <section className={`${CARD} flex flex-col gap-3 px-4 py-3.5`} data-testid="company-summary" data-state="ok" aria-label="Company summary">
      <dl className={`m-0 grid gap-3 ${phone ? 'grid-cols-1' : 'grid-cols-2 lg:grid-cols-5'}`}>
        {view.cells.map((c) => (
          <div key={c.label} className="min-w-0 break-words">
            <dt className="text-[10.5px] font-bold uppercase tracking-[.06em] text-axal-muted dark:text-gray-400">{c.label}</dt>
            <dd className="m-0 mt-0.5 text-[13.5px] font-semibold text-axal-ink dark:text-gray-100">
              {c.state ? <Tag word={c.value} /> : c.recorded ? c.value : <Tag word="Not recorded" />}
              {c.note && <small className="mt-0.5 block text-[11px] font-normal text-axal-muted dark:text-gray-400">{c.note}</small>}
            </dd>
          </div>
        ))}
      </dl>
      {view.order && (
        <div className="flex flex-col gap-1.5 border-t border-axal-hairline pt-2.5 dark:border-gray-800">
          <span className="text-[10.5px] font-bold uppercase tracking-[.06em] text-axal-muted dark:text-gray-400">Incorporation order · {view.order.label}</span>
          <OrderLine order={view.order} />
        </div>
      )}
      {view.snapshot?.value && <p className={`m-0 ${MUTED}`} data-testid="company-incorporation-snapshot">Incorporation workspace: {view.snapshot.value} · {view.snapshot.source}</p>}
    </section>
  );
}

export function Dominant({ view, add }) {
  if (!view) {
    const href = safeHref(add?.href);
    return (
      <section className={`${CARD} flex flex-wrap items-center justify-between gap-3 px-4 py-3.5`} data-testid="company-next" data-state="none">
        <p className="m-0 text-[13px] text-axal-ink dark:text-gray-200">No filing is open. Nothing on record is due.</p>
        {href && <Link to={href} state={add.state} className={LINK}>Add another filing</Link>}
      </section>
    );
  }
  const edge = view.tone === 'bad' ? 'border-red-200 dark:border-red-900' : view.tone === 'warn' ? 'border-amber-300 dark:border-amber-700' : 'border-axal-lavender-edge dark:border-violet-800';
  return (
    <section className={`flex flex-col gap-2 rounded-xl border-2 bg-white px-4 py-3.5 dark:bg-gray-900 ${edge}`} data-testid="company-next" data-state={view.tone} aria-labelledby="company-next-title">
      <span className="text-[10.5px] font-extrabold uppercase tracking-[.1em] text-axal-violet-deep dark:text-violet-300">Nearest deadline</span>
      <h2 id="company-next-title" className="m-0 text-[18px] font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100">{view.title}</h2>
      <p className={`m-0 ${MUTED}`}>{view.sub}</p>
      {safeHref(view.href) && <Link to={view.href} className={`${PRIMARY} self-start`} data-testid="company-next-action">{view.action}</Link>}
    </section>
  );
}

/**
 * D8259 (#8259, BD28 A and B): the filings Axal's pack suggests for this company, each with "Add to my filings"
 * (the Add filing form, opened with the suggestion's values) and "Not now", which hides it for this venture.
 * Without an Add (a read-only viewer) the list is shown and nothing can be changed. BD28 B: no pack, no list.
 */
export function Suggested({ view, add, projectId, onChanged, onRetry }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  if (view.state === 'loading' || view.state === 'none') return null;
  if (view.state === 'unreadable') return <Block title="Suggested filings" testid="company-suggested"><Unreadable what="Suggested filings" claim={view.reason} onRetry={onRetry} /></Block>;
  if (view.state === 'no_pack') {
    return (
      <Block title={view.title} testid="company-suggested">
        <div data-testid="company-suggested-none"><p className="m-0 text-[13px] font-semibold text-axal-ink dark:text-gray-100">{view.heading}</p><p className={`m-0 ${MUTED}`}>{view.reason}</p></div>
      </Block>
    );
  }
  const addHref = safeHref(add?.href);
  const dismiss = async (key) => {
    setBusy(key); setError('');
    try { await cyclesWrite.build.dismissSuggestedFiling(projectId, key); onChanged?.(); }
    catch (e) { setError(e?.message || 'That suggestion could not be hidden. Try again.'); }
    finally { setBusy(null); }
  };
  return (
    <Block title={view.title} line={view.line} testid="company-suggested">
      <ul className="m-0 flex list-none flex-col p-0" aria-label="Suggested filings">
        {view.rows.map((r) => {
          const href = addHref ? suggestionHref(addHref, r) : null;
          return (
            <li key={r.key} className="flex flex-wrap items-center justify-between gap-2 border-b border-axal-ground py-2.5 text-[12.5px] last:border-b-0 dark:border-gray-800" data-testid="company-suggestion" data-key={r.key}>
              <span className="min-w-0"><span className="font-semibold text-axal-ink dark:text-gray-100">{r.title}</span><small className="block text-[11px] text-axal-muted dark:text-gray-400">{r.line}</small></span>
              {href && (
                <span className="flex flex-wrap items-center gap-2">
                  <Link to={href} state={add.state} className="inline-flex min-h-[44px] sm:min-h-[36px] items-center rounded-[9px] border border-axal-lavender-edge px-3 text-[12.5px] font-bold text-axal-violet-deep hover:bg-axal-lavender dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-950/40" data-testid="company-suggestion-add">Add to my filings</Link>
                  <button type="button" disabled={busy != null} onClick={() => dismiss(r.key)} aria-label={`Not now: ${r.title}`}
                    className="inline-flex min-h-[44px] sm:min-h-[36px] items-center rounded-[9px] px-3 text-[12.5px] font-semibold text-axal-muted hover:text-axal-ink disabled:opacity-60 dark:text-gray-400 dark:hover:text-gray-100" data-testid="company-suggestion-dismiss">{busy === r.key ? 'Hiding…' : 'Not now'}</button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="m-0 text-[12px] text-red-700 dark:text-red-300" role="alert" data-testid="company-suggestion-error">{error}</p>}
      <p className={`m-0 ${MUTED}`}>Adding one creates a Build filing you own, with its due date. Nothing is filed. “Not now” hides the suggestion for this venture.</p>
    </Block>
  );
}

export function Elections({ view, rowHref, phone = false, onRetry, search = '' }) {
  const foundingTeam = `/build/founding-team${search || ''}`;
  const foot = <p className={`m-0 ${MUTED}`}>The deadline is counted as 30 calendar days from the grant date. Check with counsel. This is a record, not tax advice. <Link to={foundingTeam} className={LINK}>Founding team →</Link></p>;
  if (view.state === 'loading') return <Block title="83(b) elections" testid="company-83b"><Loading /></Block>;
  if (view.state === 'unreadable') return <Block title="83(b) elections" testid="company-83b"><Unreadable what="83(b) trackers" claim={view.reason} onRetry={onRetry} /></Block>;
  if (view.state === 'empty') return <Block title="83(b) elections" testid="company-83b" line={view.line}>{foot}</Block>;
  const open = (r) => (r.filingId ? safeHref(rowHref({ id: r.filingId })) : null);
  return (
    <Block title="83(b) elections" testid="company-83b" line={view.line}>
      <ul className="m-0 flex list-none flex-col p-0" aria-label="83(b) election per founder">
        {!phone && (
          <li aria-hidden="true" className="hidden grid-cols-[1.4fr_1fr_1.2fr_1fr_1fr_1fr_auto] gap-2.5 border-b border-axal-hairline pb-2 text-[10.5px] font-bold uppercase tracking-[.06em] text-axal-muted lg:grid dark:border-gray-800 dark:text-gray-400">
            <span>Founder</span><span>Grant date</span><span>Deadline</span><span>Mailed on</span><span>Status</span><span>Proof</span><span />
          </li>
        )}
        {view.rows.map((r) => (
          <li key={r.key} data-testid="company-83b-row" data-status={r.status}
            className={`grid items-center gap-x-2.5 gap-y-1 border-b border-axal-ground py-2.5 text-[12.5px] last:border-b-0 dark:border-gray-800 ${phone ? 'grid-cols-1' : 'grid-cols-2 lg:grid-cols-[1.4fr_1fr_1.2fr_1fr_1fr_1fr_auto]'}`}>
            <span className="font-semibold text-axal-ink dark:text-gray-100">{r.name}<small className="block font-normal text-axal-muted dark:text-gray-400">{r.who}</small></span>
            <span>{r.grant || <Tag word="Not recorded" label="Grant date not recorded" />}</span>
            <span>{r.deadline ? <>{r.deadline}{r.left && <small className="block text-axal-muted dark:text-gray-400">{r.left}</small>}</> : <Tag word="Not recorded" label="No deadline recorded" />}</span>
            <span className="text-axal-ink/80 dark:text-gray-300">{r.mailed || <Tag word="Not recorded" />}</span>
            <span><Tag word={r.status} /></span>
            <span>{r.proof ? <Tag word={r.proof} label={phone ? r.proofNote : undefined} /> : <Tag word="Not recorded" />}</span>
            <span className={phone ? '' : 'lg:justify-self-end'}>{open(r) ? <Link to={open(r)} className={LINK}>Open filing</Link> : null}</span>
            {r.reason && <small className={`${phone ? '' : 'col-span-2 lg:col-span-7'} text-[11px] text-axal-muted dark:text-gray-400`}>{r.reason}</small>}
          </li>
        ))}
      </ul>
      {foot}
    </Block>
  );
}

function DocRow({ d, rowHref }) {
  const href = d.action?.filingId ? safeHref(rowHref({ id: d.action.filingId })) : safeHref(d.action?.href);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-b border-axal-ground py-2 text-[12.5px] last:border-b-0 dark:border-gray-800" data-testid="company-doc" data-state={d.state}>
      <span className="min-w-0"><span className="font-semibold text-axal-ink dark:text-gray-100">{d.label}</span><small className="block text-[11px] text-axal-muted dark:text-gray-400">{d.note}</small></span>
      <span className="flex items-center gap-2.5"><Tag word={d.state} />{href && <Link to={href} className={LINK}>{d.action.text}</Link>}</span>
    </li>
  );
}

export function Documents({ view, rowHref, onRetry }) {
  if (view.state === 'loading') return <Block title="Documents" testid="company-documents"><Loading /></Block>;
  const proofs = view.proofs.length ? <ul className="m-0 list-none p-0" aria-label="83(b) proofs">{view.proofs.map((d) => <DocRow key={d.key} d={d} rowHref={rowHref} />)}</ul> : null;
  let papers;
  if (view.state === 'ok') papers = <ul className="m-0 list-none p-0" aria-label="Company papers">{view.papers.map((d) => <DocRow key={d.key} d={d} rowHref={rowHref} />)}</ul>;
  else if (view.state === 'not_linked') papers = <p className="m-0 text-[12.5px] text-axal-ink dark:text-gray-200" data-testid="company-documents-unlinked">{view.reason} Company papers are stored on the company record. <Link to={view.linkHref} className={LINK}>Link company</Link></p>;
  else if (view.state === 'refused') papers = <p className="m-0 text-[12.5px] text-axal-ink dark:text-gray-200" data-testid="company-documents-refused"><Tag word="Read only" label="Refused" /> {view.reason}</p>;
  else papers = <Unreadable what="Documents" claim={view.reason} onRetry={onRetry} />;
  return <Block title="Documents" testid="company-documents" line={view.line}>{papers}{proofs}</Block>;
}

const SMALL_BTN = 'inline-flex min-h-[44px] items-center justify-center rounded-[9px] border border-axal-lavender-edge px-3 text-[12.5px] font-bold text-axal-violet-deep hover:bg-axal-lavender disabled:cursor-not-allowed disabled:opacity-60 dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-950/40';

/**
 * D9101 (#9101, BD25, BD29, BD30 C): the IP step's own action and states. Record IP assignment (Record on a phone)
 * only in the copy state; the Lab read's failure, a failed copy and founder preview say so here and nowhere else.
 */
function IpAction({ ip, phone, saving, error, onCopy, onRetryCheck }) {
  if (ip.recorded) return null;
  if (ip.check === 'unreadable') {
    return (
      <span className="flex flex-wrap items-center gap-2" data-testid="company-ip-check">
        <Tag word="Unreadable" label="Could not be read" />
        {onRetryCheck && <button type="button" className={SMALL_BTN} onClick={onRetryCheck} data-testid="company-ip-check-retry">Try again</button>}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Tag word="Not recorded" />
      {ip.action === 'copy' && onCopy && (
        <button type="button" className={SMALL_BTN} disabled={saving} aria-busy={saving || undefined} onClick={onCopy} data-testid="company-ip-copy">
          {saving ? 'Saving…' : error ? 'Try again' : phone ? 'Record' : 'Record IP assignment'}
        </button>
      )}
    </span>
  );
}

export function AfterFormation({ ip, search = '', phone = false, saving = false, error = '', onCopy = null, onRetryCheck = null }) {
  return (
    <Block title="After formation" testid="company-after" line="2 steps">
      <ul className="m-0 list-none p-0">
        <li className="flex flex-wrap items-center justify-between gap-2 border-b border-axal-ground py-2 text-[12.5px] dark:border-gray-800">
          <span><span className="font-semibold text-axal-ink dark:text-gray-100">Bank account</span><small className="block text-[11px] text-axal-muted dark:text-gray-400">Its connection and state are kept in Operating systems › Systems</small></span>
          <Link to={`/build/operating-systems${search || ''}`} className={LINK}>Manage in Operating systems</Link>
        </li>
        <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-[12.5px]" data-testid="company-ip" data-state={ip.recorded ? 'recorded' : 'not_recorded'}
          data-action={ip.action || undefined} data-check={ip.check || undefined} aria-busy={ip.check === 'loading' || undefined}>
          <span className="min-w-0 break-words"><span className="font-semibold text-axal-ink dark:text-gray-100">IP assignment</span>
            <small className="block text-[11px] text-axal-muted dark:text-gray-400">{ip.recorded ? `${ip.value} · ${ip.source}` : `${ip.reason} ${ip.source}.`}</small>
            {!ip.recorded && ip.note && <small className="block text-[11px] text-axal-muted dark:text-gray-400" data-testid="company-ip-note">{ip.note}</small>}
            {!ip.recorded && error && <small className="block text-[11px] font-semibold text-red-700 dark:text-red-300" role="alert" data-testid="company-ip-error"><span aria-hidden="true">! </span>{error}</small>}</span>
          <IpAction ip={ip} phone={phone} saving={saving} error={error} onCopy={onCopy} onRetryCheck={onRetryCheck} />
        </li>
      </ul>
    </Block>
  );
}

/**
 * D9101: the IP step with its Lab read and its copy. The viewer's Lab state is read once, and only while the step
 * is not recorded and the viewer is not a Super Admin previewing a founder (the copy reads the caller's own
 * application). A copy that lands refetches the module, so the step reads the record from `facts.ip`, never from
 * the copy's answer.
 */
function IpAssignment({ facts, projectId, phone, search, reload, labApi, copyIp }) {
  const mode = useViewMode();
  const recorded = ipStep(facts).recorded;
  const preview = isFounderPreview(mode);
  const [lab, setLab] = useState({ status: 'loading', application: null });
  const [tick, setTick] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const needed = !recorded && !preview;
  useEffect(() => {
    if (!needed) return undefined;
    let live = true;
    setLab({ status: 'loading', application: null });
    Promise.resolve().then(() => labApi.state())
      .then((s) => { if (live) setLab({ status: 'ready', application: s?.application || null }); })
      .catch(() => { if (live) setLab({ status: 'unreadable', application: null }); });
    return () => { live = false; };
  }, [needed, tick, labApi]);
  const ip = ipStep(facts, needed ? lab : null, mode);
  const copy = async () => {
    if (ip.action !== 'copy' || saving) return;
    setSaving(true); setError('');
    setError(await runIpCopy(ip, projectId, copyIp, reload));
    setSaving(false);
  };
  return <AfterFormation ip={ip} search={search} phone={phone} saving={saving} error={error} onCopy={copy} onRetryCheck={() => setTick((n) => n + 1)} />;
}

function Handoff({ projectId, search = '' }) {
  return (
    <nav aria-label="Hand off" className="flex flex-wrap gap-x-4 gap-y-2" data-testid="company-handoff">
      <Link to={`/raise/data-room${ventureQuery(projectId)}`} className={LINK}>Raise › Data room →</Link>
      <Link to={`/build/founding-team${search || ''}`} className={LINK}>Founding team →</Link>
    </nav>
  );
}

/** BD11: the filings' supporting tools, together and below the one primary action. */
function Supporting({ add, tools }) {
  const addHref = safeHref(add?.href);
  const list = (Array.isArray(tools) ? tools : []).filter((t) => t?.supporting && safeHref(t.href));
  if (!addHref && !list.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-1" data-testid="company-supporting">
      <span className="text-[10.5px] font-bold uppercase tracking-[.06em] text-axal-muted dark:text-gray-400">Supporting tools</span>
      {addHref && <Link to={addHref} state={add.state} className={LINK} data-testid="company-add-filing"
        aria-haspopup={add.onOpen ? 'dialog' : undefined} onClick={add.onOpen ? (e) => { if (isPlainClick(e)) { e.preventDefault(); add.onOpen(); } } : undefined}>Add another filing</Link>}
      {list.map((t) => <Link key={t.href} to={t.href} className={LINK} data-testid="cycle-module-tool">{t.supporting}</Link>)}
    </div>
  );
}

/** BD27 B/C on the page: where a Lab step and an Axal filing are changed, and the way there. */
function WhereChanged({ records, projectId }) {
  const s = sourcesIn(records);
  if (!s.lab && !s.obligation) return null;
  return (
    <ul className="m-0 flex list-none flex-col gap-1 px-1 p-0" data-testid="company-filing-sources">
      {s.lab && <li className={MUTED}>Lab steps are read only here: Axal updates them from your incorporation order. <Link to={`/raise/legal-engine/incorporation${ventureQuery(projectId)}`} className={LINK}>Open in the Legal engine →</Link></li>}
      {s.obligation && <li className={MUTED}>Filings set by Axal are read only here, except uploading their proof; Axal files or waives them. <Link to="/help/tickets" className={LINK}>Ask Axal to change one →</Link></li>}
    </ul>
  );
}

export function IncorporateFirst({ copy, add, phone = false }) {
  const addHref = safeHref(add?.href);
  return (
    <div className="flex flex-col gap-4" data-testid="company-incorporate-first">
      <section className={`${CARD} flex flex-col items-start gap-2.5 px-5 py-5`} aria-labelledby="company-incorporate-title">
        <span className="text-[10.5px] font-extrabold uppercase tracking-[.1em] text-axal-muted dark:text-gray-400">{copy.eyebrow}</span>
        <h2 id="company-incorporate-title" className={`m-0 font-extrabold tracking-[-.02em] text-axal-ink dark:text-gray-100 ${phone ? 'text-[26px]' : 'text-[20px]'}`}>{copy.heading}</h2>
        <p className="m-0 max-w-[62ch] text-[13px] leading-relaxed text-axal-ink/80 dark:text-gray-300">{copy.outcome}</p>
        <Link to={copy.href} className={`${PRIMARY} ${phone ? 'w-full' : ''}`} data-testid="company-incorporate-action">{copy.action}</Link>
        {addHref && <Link to={addHref} state={add.state} className={LINK} data-testid="company-incorporate-secondary"
          aria-haspopup={add.onOpen ? 'dialog' : undefined} onClick={add.onOpen ? (e) => { if (isPlainClick(e)) { e.preventDefault(); add.onOpen(); } } : undefined}>{copy.secondary}</Link>}
      </section>
      <section className={`${CARD} px-5 py-4 opacity-70`} aria-label="What follows, a preview" data-testid="company-incorporate-preview">
        <span className="text-[10.5px] font-bold uppercase tracking-[.06em] text-axal-muted dark:text-gray-400">What follows · preview</span>
        <ol className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0">
          {copy.preview.map((s, i) => <li key={s} className="flex items-center gap-2 text-[12.5px] text-axal-muted dark:text-gray-400"><span aria-hidden="true" className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-gray-300 text-[10.5px] dark:border-gray-600">{i + 1}</span>{s}</li>)}
        </ol>
        <p className={`m-0 mt-2 ${MUTED}`}>{copy.previewNote}</p>
      </section>
    </div>
  );
}

/** The page. `p` is what `CycleModulePage` / `PhoneModulePage` hand a module's home; `data` and `projectId` the def's own. */
export default function CompanyCreationHome({ data, projectId, labApi = spinoutLab, copyIp = cyclesWrite.build.ipCopy, ...p }) {
  const phone = !!p.phone;
  const copy = progressiveFor('build', 'company-creation');
  const loading = !data;
  const status = loading ? 'loading' : 'ready';
  const facts = data?.facts;
  const records = p.records;
  const rowHref = typeof p.rowHref === 'function' ? p.rowHref : () => null;
  const add = (Array.isArray(p.add) ? p.add : [p.add || records?.add]).find((a) => a?.text && safeHref(a.href)) || null;
  if (!loading && p.recordsStatus !== 'unreadable' && incorporateFirst(facts, records, p.query)) {
    return <IncorporateFirst copy={copy.incorporate} add={add} phone={phone} />;
  }
  const zero = p.recordsStatus === 'ready' && listStage(records, p.query || {}) === 'zero';
  const retry = p.onRetry;
  const docs = documentsView(facts, status, projectId);
  return (
    <div className={`flex min-w-0 flex-col ${phone ? 'mt-[18px] gap-3' : 'gap-4'}`} data-testid="company-creation" data-phone={phone ? 'true' : undefined}>
      {/* BD30 A: on phone the dominant action comes first, then the summary as a stacked card. A formed company with no
          filings yet (BD29's measured zero) leads with the table's own first Add instead, so no second action competes. */}
      {phone && !loading && !zero && <Dominant view={dominantView(facts, rowHref)} add={add} />}
      <Summary view={summaryView(facts, status)} phone={phone} onRetry={retry} />
      {!phone && !loading && !zero && <Dominant view={dominantView(facts, rowHref)} add={add} />}
      <Elections view={electionView(facts, status)} rowHref={rowHref} phone={phone} onRetry={retry} search={p.search} />
      <Suggested view={suggestionsView(facts, status)} add={add} projectId={projectId} onChanged={p.reload || retry} onRetry={retry} />
      {/* D703 / BD30: on a phone the filings are the module page's own phone rows (a tap opens Edit as a page);
          loading, unreadable and the empty stages stay with the table, which says each. */}
      {phone && p.phoneRows && (p.recordsStatus || 'ready') === 'ready' && (p.phoneRows.rows || []).length > 0
        ? <div className="min-w-0"><PhoneRows groups={[p.phoneRows]} /></div>
        : (
        <RecordsTable
          key="build/company-creation"
          title="Filings"
          records={filingRows(records)}
          status={p.recordsStatus || (records ? 'ready' : 'loading')}
          message={p.recordsMessage}
          query={p.query || {}}
          onQuery={p.onQuery}
          onRetry={p.onRetryRecords || retry}
          // BD11: the table's Add is a supporting tool below; only the measured zero of a formed company leads with it (BD29).
          add={zero ? p.add : []}
          rowAction={p.rowAction}
          progressive={copy}
          onExport={p.onExport}
          rowHref={p.rowHref}
        />
        )}
      {/* D8260 (BD25): the company's filings and proofs as CSV, for its members. */}
      {!loading && !zero && docs.state === 'ok' && <FilingsExport projectId={projectId} />}
      <WhereChanged records={records} projectId={projectId} />
      {!zero && <Supporting add={add} tools={p.tools} />}
      {zero && <Supporting add={null} tools={p.tools} />}
      <div className={`grid gap-4 ${phone ? 'grid-cols-1' : 'lg:grid-cols-2'}`}>
        <div className="flex min-w-0 flex-col gap-2">
          <Documents view={docs} rowHref={rowHref} onRetry={retry} />
          {/* D8260 (BD25): the stored papers, preselected for the venture's data room; members only. */}
          {docs.state === 'ok' && <PapersToDataRoom projectId={projectId} />}
        </div>
        <IpAssignment facts={facts} projectId={projectId} phone={phone} search={p.search} reload={p.reload || retry} labApi={labApi} copyIp={copyIp} />
      </div>
      <Handoff projectId={projectId} search={p.search} />
    </div>
  );
}

