/**
 * D1266 (#3289) — the founder's Evidence view (VR1) from one read of
 * `GET /api/cycles/raise/evidence`: the tiles, claims by area with their states
 * and filters, the pinned evidence by area (each opening its drawer, and
 * selectable for Share), Waiting for review, Coverage by area, What investors
 * see, and Investor opens. Its states: empty (VR13), loading (VR14), error and
 * partial (VR15), and a studio admin's read-only view (VR12).
 *
 * ONE FAILED BLOCK NEVER BLANKS THE PAGE. Each block says Unreadable with its
 * own Try again; the whole read failing says so, and that it is not the same as
 * having none.
 */
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CLAIM_STATE, SHARING, SOURCES, claimHref, itemHref, previewHref, reviewHref } from './evidenceModel';
import {
  claimTitle, claimWhere, claimsByArea, countOf, coverageByArea, day, filterClaims, investorsSee, itemFigure, itemTitle, itemsByArea, statedFigure,
} from './evidenceView';
import {
  BTN_L, BTN_P, BTN_S, BlockUnreadable, CARD, ChangedPill, H2, LINK, MUTED, SharingPill, SourcePill, StalePill, StatePill, StrengthMark,
} from './EvidenceParts';
import { DecisionDialog, ProposalRow, ShareDialog } from './EvidenceReview';

function Tile({ label, value, sub, testId }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-axal-hairline bg-white p-3 dark:border-gray-800 dark:bg-gray-900" data-testid={testId}>
      <span className="text-[11px] font-bold uppercase tracking-[.08em] text-axal-muted dark:text-gray-400">{label}</span>
      <span className="text-[20px] font-bold text-axal-ink dark:text-gray-100">{value ?? 'Unreadable'}</span>
      {sub ? <span className="text-[12px] text-axal-muted dark:text-gray-400">{sub}</span> : null}
    </div>
  );
}

/** The six tiles. A count the read could not answer is Unreadable, never 0. */
export function Tiles({ model, admin = false }) {
  const t = model.tiles;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" data-testid="evidence-tiles">
      <Tile testId="tile-backed" label="Claims backed" value={t.total == null ? null : `${countOf(t.backed, t.more)} of ${countOf(t.total, t.more)}`}
        sub={admin ? 'Bank-derived claims are not shown to admins' : t.founders != null ? `${t.founders} more are your own figure` : null} />
      <Tile testId="tile-mismatch" label="Mismatches" value={countOf(t.mismatch, t.more)} sub="The record differs from what you state" />
      <Tile testId="tile-not-backed" label="Not backed" value={countOf(t.notBacked, t.more)} sub="No pinned record of that kind" />
      <Tile testId="tile-waiting" label="Waiting for review" value={countOf(t.waiting, t.waitingMore)} sub={admin ? 'The founders review these' : t.newestWaiting ? `Newest ${day(t.newestWaiting)}` : null} />
      <Tile testId="tile-shared" label="Shared after NDA" value={t.afterNda == null ? null : String(t.afterNda)} sub={t.summary ? `${t.summary} more as a summary` : null} />
      <Tile testId="tile-opens" label="Investor opens, 30 days" value={t.opens == null ? null : String(t.opens)} sub={t.openers ? `By ${t.openers} ${t.openers === 1 ? 'investor' : 'investors'}` : null} />
    </div>
  );
}

function ClaimRow({ c, model, search }) {
  const best = model.byUid.get(c?.record?.items?.[0]);
  return (
    <li className="flex flex-col gap-1.5 py-2.5" data-testid="evidence-claim" data-state={c.state}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to={claimHref(c.uid, search)} className="text-[13.5px] font-semibold text-axal-ink hover:text-axal-violet dark:text-gray-100 dark:hover:text-violet-300">{claimTitle(c)}</Link>
        <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">{statedFigure(c) ?? ''}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StatePill state={c.state} />
        <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{claimWhere(c)}</span>
        {c.record ? <SourcePill source={c.record.source_label} provider={c.record.provider} on={c.record.observed_on} /> : <SourcePill source={null} />}
        {best ? <StrengthMark strength={best.strength} /> : null}
        {best ? <SharingPill visibility={best.visibility} /> : null}
        {best?.source_state === 'changed' ? <ChangedPill /> : null}
        {best?.stale ? <StalePill /> : null}
      </div>
      {c.state === 'mismatch' && c.record?.shown ? <span className="text-[12px] text-red-700 dark:text-red-300">{statedFigure(c)} stated · {c.record.shown} in the record</span> : null}
    </li>
  );
}

const SELECT = 'rounded-lg border border-axal-hairline bg-white px-2 py-1.5 text-[12.5px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

/** VR1's main card: claims by area, sorted Needs you first, with State, Source, Sharing and a search. */
export function ClaimsCard({ model, read, search, onRetry }) {
  const [f, setF] = useState({ state: '', source: '', sharing: '', q: '', sort: 'needs' });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const rows = useMemo(() => filterClaims(model.claims, model.byUid, f), [model.claims, model.byUid, f]);
  const areas = claimsByArea(rows);
  return (
    <section className={CARD} data-testid="evidence-claims">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={H2}>Claims {model.claims ? <span className="text-[12px] font-semibold text-axal-muted dark:text-gray-400">[{countOf(model.claims.length, read?.claims?.has_more)}]</span> : null}</h2>
        <select aria-label="Sort" value={f.sort} onChange={set('sort')} className={SELECT} data-testid="claims-sort">
          <option value="needs">Sort: Needs you first</option><option value="checked">Sort: Newest checked</option>
        </select>
      </div>
      <div className="flex flex-wrap gap-2">
        <select aria-label="State" value={f.state} onChange={set('state')} className={SELECT} data-testid="claims-filter-state">
          <option value="">State: all</option>{Object.entries(CLAIM_STATE).map(([k, w]) => <option key={k} value={k}>{w}</option>)}
        </select>
        <select aria-label="Source" value={f.source} onChange={set('source')} className={SELECT} data-testid="claims-filter-source">
          <option value="">Source: all</option>{SOURCES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <select aria-label="Sharing" value={f.sharing} onChange={set('sharing')} className={SELECT} data-testid="claims-filter-sharing">
          <option value="">Sharing: all</option>{Object.entries(SHARING).map(([k, w]) => <option key={k} value={k}>{w}</option>)}
        </select>
        <input type="search" aria-label="Search claims" placeholder="Search claims" value={f.q} onChange={set('q')} className={`${SELECT} min-w-[160px] flex-1`} data-testid="claims-search" />
      </div>
      {read?.claim_check?.outcome === 'unreadable' ? <BlockUnreadable id="claim-check" reason={read.claim_check.reason} onRetry={onRetry} /> : null}
      {read?.claim_check?.outcome === 'partial' ? <p className="m-0 text-[12px] text-amber-800 dark:text-amber-300" data-testid="claims-partial">Some of what you state could not be read just now; those claims keep their last check.</p> : null}
      {read?.claims?.state === 'unreadable' ? <BlockUnreadable id="claims" reason={read.claims.reason} onRetry={onRetry} /> : null}
      {model.claims && !model.claims.length ? <p className={MUTED} data-testid="claims-none">No claim is checked yet. The figures in your narrative, deck, use of funds, cap table and capital model become claims here as you state them.</p> : null}
      {model.claims?.length && !rows.length ? <p className={MUTED}>No claim matches these filters.</p> : null}
      {areas.map(({ area, claims }) => (
        <div key={area} className="flex flex-col" data-testid="evidence-area" data-area={area}>
          <div className="flex items-center justify-between border-b border-axal-hairline pb-1 dark:border-gray-800">
            <h3 className="m-0 text-[13px] font-bold text-axal-ink dark:text-gray-100">{area}</h3>
            <span className="text-[11.5px] text-axal-muted dark:text-gray-400">{claims.length} {claims.length === 1 ? 'claim' : 'claims'} · {claims.filter((c) => c.state === 'backed').length} backed</span>
          </div>
          <ul className="m-0 flex list-none flex-col divide-y divide-axal-hairline p-0 dark:divide-gray-800">{claims.map((c) => <ClaimRow key={c.uid} c={c} model={model} search={search} />)}</ul>
        </div>
      ))}
    </section>
  );
}

/** The pinned evidence by area: each opens its drawer; a founder selects some to share them together (VR5). */
export function ItemsCard({ model, read, search, projectId, onChanged, onRetry }) {
  const [picked, setPicked] = useState(() => new Set());
  const [share, setShare] = useState(false);
  const groups = itemsByArea(model.items);
  const chosen = (model.items || []).filter((i) => picked.has(i.uid));
  const toggle = (uid) => setPicked((s) => { const n = new Set(s); if (n.has(uid)) n.delete(uid); else n.add(uid); return n; });
  return (
    <section className={CARD} data-testid="evidence-items">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={H2}>Pinned evidence</h2>
        {model.canDecide ? <button type="button" className={BTN_L} disabled={!chosen.length} onClick={() => setShare(true)} data-testid="items-share">Share{chosen.length ? ` [${chosen.length}]` : ''}</button> : null}
      </div>
      {read?.items?.state === 'unreadable' ? <BlockUnreadable id="items" reason={read.items.reason} onRetry={onRetry} /> : null}
      {model.items && !groups.length ? <p className={MUTED}>Nothing is pinned yet. What you accept from Waiting for review is pinned here.</p> : null}
      {groups.map(({ area, items }) => (
        <div key={area} className="flex flex-col gap-1">
          <h3 className="m-0 text-[12px] font-bold text-axal-muted dark:text-gray-400">{area}</h3>
          <ul className="m-0 flex list-none flex-col divide-y divide-axal-hairline p-0 dark:divide-gray-800">
            {items.map((i) => (
              <li key={i.uid} className="flex items-start gap-2 py-2" data-testid="evidence-item" data-uid={i.uid}>
                {model.canDecide ? <input type="checkbox" className="mt-1 h-4 w-4" checked={picked.has(i.uid)} onChange={() => toggle(i.uid)} aria-label={`Select ${itemTitle(i)}`} /> : null}
                <div className="flex min-w-0 flex-col gap-1">
                  <Link to={itemHref(i.uid, search)} className="text-[13px] font-semibold text-axal-ink hover:text-axal-violet dark:text-gray-100 dark:hover:text-violet-300">{itemTitle(i)}{itemFigure(i) ? ` · ${itemFigure(i)}` : ''}</Link>
                  <div className="flex flex-wrap items-center gap-2"><SourcePill source={i.source_label} provider={i.provider} on={i.observed_on} /><StrengthMark strength={i.strength} /><SharingPill visibility={i.visibility} />{i.source_state === 'changed' ? <ChangedPill /> : null}{i.stale ? <StalePill /> : null}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {read?.items?.has_more ? <p className={MUTED}>The first 100 pinned items are listed.</p> : null}
      {share ? <ShareDialog items={chosen} projectId={projectId} onClose={() => setShare(false)} onDone={async () => { setPicked(new Set()); await onChanged?.(); }} /> : null}
    </section>
  );
}

/** VR1's Waiting for review card: the five newest, each Accept or Dismiss through its dialog. */
export function ReviewCard({ model, read, search, projectId, onChanged, onRetry }) {
  const [action, setAction] = useState(null);
  const list = (model.proposals || []).slice(0, 5);
  return (
    <section className={CARD} data-testid="evidence-review-card">
      <h2 className={H2}>Waiting for review {model.proposals ? <span className="text-[12px] font-semibold text-axal-muted dark:text-gray-400">[{countOf(model.proposals.length, read?.proposals?.has_more)}]</span> : null}</h2>
      <p className={MUTED}>Accepting pins evidence to your Raise. Nobody else sees it until you share it.</p>
      {read?.proposals?.state === 'unreadable' ? <BlockUnreadable id="proposals" reason={read.proposals.reason} onRetry={onRetry} /> : null}
      {model.proposals && !model.proposals.length ? <p className={MUTED}>Nothing is waiting for your review.</p> : null}
      <ul className="m-0 flex list-none flex-col divide-y divide-axal-hairline p-0 dark:divide-gray-800">
        {list.map((p) => <ProposalRow key={p.uid} p={p} canDecide={model.canDecide} onAccept={(x) => setAction({ verb: 'accept', rows: [x] })} onDismiss={(x) => setAction({ verb: 'dismiss', rows: [x] })} />)}
      </ul>
      {model.proposals?.length ? <Link to={reviewHref(search)} className={LINK} data-testid="review-all">Review all [{countOf(model.proposals.length, read?.proposals?.has_more)}] ›</Link> : null}
      {action ? <DecisionDialog action={action} projectId={projectId} onDone={() => onChanged?.()} onClose={() => setAction(null)} /> : null}
    </section>
  );
}

const SEG = { connector: 'bg-violet-600 dark:bg-violet-400', document: 'bg-sky-500', recorded: 'bg-amber-500', signed: 'bg-emerald-500', typed: 'bg-gray-500' };
/** VR1's Coverage by area: each bar one area's pinned items, by their source; a table for screen readers. */
export function CoverageCard({ model, read, onRetry, title = 'Coverage by area' }) {
  const rows = coverageByArea(model.groups);
  return (
    <section className={CARD} data-testid="evidence-coverage">
      <h2 className={H2}>{title}</h2>
      <p className={MUTED}>Each bar is one area’s pinned evidence, by its source. A Typed figure is the founder’s figure, never Backed.</p>
      {read?.coverage?.state === 'unreadable' ? <BlockUnreadable id="coverage" reason={read.coverage.reason} onRetry={onRetry} /> : null}
      {rows ? (
        <table className="w-full border-collapse text-[12px]">
          <caption className="sr-only">Pinned evidence by area and source</caption>
          <tbody>
            {rows.map((r) => (
              <tr key={r.area} data-testid="coverage-area" data-area={r.area}>
                <th scope="row" className="w-[45%] py-1 pr-2 text-left font-semibold">{r.area}</th>
                <td className="py-1">
                  {r.total ? (
                    <div className="flex h-3 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800" aria-label={SOURCES.filter((s) => r.by[s.key]).map((s) => `${s.label} ${r.by[s.key]}`).join(', ')}>
                      {SOURCES.filter((s) => r.by[s.key]).map((s) => <span key={s.key} className={SEG[s.key]} style={{ width: `${(100 * r.by[s.key]) / r.total}%` }} />)}
                    </div>
                  ) : <span className="text-axal-muted dark:text-gray-400">Nothing pinned</span>}
                </td>
                <td className="w-8 py-1 pl-2 text-right text-axal-muted dark:text-gray-400">{r.total || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <div className="flex flex-wrap gap-3 text-[11.5px] text-axal-muted dark:text-gray-400">{SOURCES.map((s) => <span key={s.key} className="inline-flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${SEG[s.key]}`} />{s.label}</span>)}</div>
    </section>
  );
}

/** VR1's What investors see, and the way into See as an investor (VR11). */
export function InvestorsSeeCard({ model, search }) {
  const see = investorsSee(model.groups);
  return (
    <section className={CARD} data-testid="evidence-investors-see">
      <h2 className={H2}>What investors see</h2>
      {see ? (
        <>
          <p className="m-0 text-[13px]"><strong>{see.shared}</strong> shared {see.shared === 1 ? 'item' : 'items'}: before the NDA as kind, count, source and date, with no values.</p>
          <p className={MUTED}>After the NDA: {see.withValues} with their values, {see.summary} still a summary.</p>
        </>
      ) : <BlockUnreadable id="investors-see" reason="What is shared could not be read." />}
      {model.canDecide ? <Link to={previewHref(search)} className={`${BTN_S} w-fit`} data-testid="see-as-investor">See as an investor</Link> : null}
    </section>
  );
}

/** VR1's Investor opens, the last 30 days (D1266's `open_evidence` read). */
export function OpensCard({ read, onRetry }) {
  const o = read?.opens;
  return (
    <section className={CARD} data-testid="evidence-opens">
      <h2 className={H2}>Investor opens</h2>
      <p className={MUTED}>Last 30 days</p>
      {!o || o.state === 'unreadable' ? <BlockUnreadable id="opens" reason={o?.reason || 'Investor opens could not be read.'} onRetry={onRetry} /> : null}
      {o?.state === 'recorded' && !o.count ? <p className="m-0 text-[13px]" data-testid="opens-none">No investor has opened your evidence yet.</p> : null}
      {o?.state === 'recorded' && o.count ? (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {o.rows.map((r, n) => <li key={`${r.at}-${n}`} className="flex justify-between gap-2 text-[12.5px]"><span><strong>{r.investor}</strong> opened the evidence</span><span className="text-axal-muted dark:text-gray-400">{day(r.at)}</span></li>)}
        </ul>
      ) : null}
      {o?.state === 'recorded' && o.count > (o.rows?.length || 0) ? <p className={MUTED}>{o.capped ? 'The newest 200 are counted; ' : ''}{o.rows.length} of {o.count} are listed.</p> : null}
    </section>
  );
}

/** VR15's amber note: a source that could not be read; its items show their last known date. */
export function SourcesNote({ names, onRetry }) {
  if (!names?.length) return null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" data-testid="evidence-sources-unreadable">
      <span>{names.join(', ')} could not be read. {names.length === 1 ? 'Its' : 'Their'} items show their last known date.</span>
      {onRetry ? <button type="button" className={BTN_S} onClick={onRetry}>Try again</button> : null}
    </div>
  );
}

/** VR13 Crop A. */
export function EvidenceEmpty({ search = '' }) {
  return (
    <section className={`${CARD} items-start`} data-testid="evidence-empty">
      <h2 className={H2}>Nothing backs your Raise yet.</h2>
      <p className={MUTED}>Record a customer session, or connect Stripe, Mercury or GitHub, and evidence appears here for you to review.</p>
      <div className="flex flex-wrap gap-2">
        <Link to={`/validate/record${search}`} className={BTN_L}>Record a session</Link>
        <Link to={`/build/connect${search}`} className={BTN_S}>Connectors</Link>
      </div>
    </section>
  );
}

/** VR14. */
export function EvidenceLoading() {
  const bar = (w) => <span className="block h-2.5 rounded bg-gray-100 dark:bg-gray-800" style={{ width: w }} />;
  return (
    <div className="flex flex-col gap-4" data-testid="evidence-loading" aria-busy="true">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{[0, 1, 2, 3, 4, 5].map((n) => <div key={n} className={`${CARD} gap-2`}>{bar('60%')}{bar('40%')}{bar('80%')}</div>)}</div>
      <div className={CARD}><h2 className={H2}>Claims</h2><p className={MUTED}>Reading…</p>{bar('55%')}{bar('35%')}{bar('70%')}</div>
    </div>
  );
}

/** VR15 Crop B: the read failed as a whole. */
export function EvidenceError({ message, onRetry }) {
  return (
    <section role="alert" className={`${CARD} items-start border-red-200 dark:border-red-900`} data-testid="evidence-error">
      <h2 className={H2}>Your evidence could not be read.</h2>
      <p className={MUTED}>That is not the same as having none.{message ? ` ${message}` : ''}</p>
      <button type="button" className={BTN_S} onClick={onRetry}>Try again</button>
    </section>
  );
}

/** VR16 Panel 2: a reader the venture's evidence is not for. */
export function EvidenceForbidden() {
  return (
    <section className={`${CARD} items-start`} data-testid="evidence-forbidden">
      <h2 className={H2}>Evidence is for the venture’s founders and the investors they invite.</h2>
      <p className={MUTED}>Nothing on this page is shared with your profile.</p>
      <Link to="/" className={BTN_P}>Go to your home</Link>
    </section>
  );
}

/** VR12: a studio admin reads; only the founders pin and share. */
export function AdminBanner() {
  return (
    <div role="note" className="flex flex-col gap-1 rounded-xl border border-axal-lavender-edge bg-axal-lavender px-3 py-2 dark:border-violet-800 dark:bg-violet-900/30" data-testid="evidence-admin">
      <span className="text-[13px] font-semibold text-axal-violet-deep dark:text-violet-200">You are viewing this venture’s evidence as a studio admin. Only the venture’s founders pin and share evidence.</span>
      <span className="text-[12px] text-axal-violet-deep dark:text-violet-200">Bank-derived evidence and quotes are visible to the founders only, and are not shown here.</span>
    </div>
  );
}

/** VR1 itself: the tiles, the claims and the right-hand column. */
export function EvidenceMain({ model, read, search, projectId, onChanged, onRetry }) {
  return (
    <div className="flex flex-col gap-4" data-testid="raise-evidence">
      {!model.canDecide ? <AdminBanner /> : null}
      <SourcesNote names={model.unreadableSources} onRetry={onRetry} />
      <Tiles model={model} admin={!model.canDecide} />
      {model.empty ? <EvidenceEmpty search={search} /> : null}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-w-0 flex-col gap-4">
          <ClaimsCard model={model} read={read} search={search} onRetry={onRetry} />
          <ItemsCard model={model} read={read} search={search} projectId={projectId} onChanged={onChanged} onRetry={onRetry} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          {model.canDecide ? <ReviewCard model={model} read={read} search={search} projectId={projectId} onChanged={onChanged} onRetry={onRetry} /> : null}
          <CoverageCard model={model} read={read} onRetry={onRetry} />
          <InvestorsSeeCard model={model} search={search} />
          <OpensCard read={read} onRetry={onRetry} />
        </div>
      </div>
    </div>
  );
}

