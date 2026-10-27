/**
 * D1266 (#3289) — Waiting for review (VR4) at `/raise/evidence/review`, the
 * Share dialog (VR5) and See as an investor (VR11) at `/raise/evidence/preview`.
 *
 * PROPOSALS BY ACCEPT. A candidate built from Validate, Build or a connector is
 * pinned only when the founder accepts it; nobody else sees it until it is
 * shared. Accept all takes one source at most 50 at a time (AUTOFILL's cap),
 * and lists each outcome after. Every press opens a dialog that says what it
 * changes first.
 *
 * THE PREVIEW IS THE INVESTOR'S OWN PROJECTION (`GET …/evidence/preview`), read
 * as an invited investor with an unscoped grant, never logged as an open.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { raiseEvidenceApi } from '../../../lib/api/raiseEvidence';
import { AREAS, BASE, SHARING, SOURCES } from './evidenceModel';
import {
  ACCEPT_ALL_CAP, acceptAllOffer, acceptAllPlan, day, itemFigure, itemTitle, outcomeWord, sourceWord,
} from './evidenceView';
import {
  BTN_L, BTN_S, BlockUnreadable, CARD, ChangeDialog, H2, LINK, MUTED, SharingPill, SourcePill, StalePill, StatePill, StrengthMark,
} from './EvidenceParts';

const decide = async (projectId, p, verb) => {
  try {
    if (verb === 'accept') await raiseEvidenceApi.accept(projectId, p.uid, p.snapshot_hash);
    else await raiseEvidenceApi.dismiss(projectId, p.uid);
    return { uid: p.uid, ok: true };
  } catch (e) { return { uid: p.uid, ok: false, code: e?.code || null }; }
};
/** One proposal's row in words: the record, where it came from and what it would back. */
export function ProposalRow({ p, canDecide, onAccept, onDismiss, selected, onSelect }) {
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between" data-testid="evidence-proposal" data-uid={p.uid}>
      <div className="flex min-w-0 items-start gap-3">
        {onSelect ? <input type="checkbox" className="mt-1 h-4 w-4" checked={!!selected} onChange={() => onSelect(p.uid)} aria-label={`Select ${itemTitle(p)}`} /> : null}
        <div className="flex min-w-0 flex-col gap-1">
          <SourcePill source={p.source_label} provider={p.provider} on={p.observed_on} />
          <span className="text-[13.5px] font-semibold text-axal-ink dark:text-gray-100">{itemTitle(p)}{itemFigure(p) ? ` · ${itemFigure(p)}` : ''}</span>
          <span className={MUTED}>{p.summary} Would back: {p.area}.</span>
          {p.source_state === 'changed' ? <span className="text-[12px] text-amber-800 dark:text-amber-300">The source changed since this was proposed. Look again to accept the current record.</span> : null}
          {p.source_state === 'unreadable' ? <span className="text-[12px] text-amber-800 dark:text-amber-300">Its source could not be read just now.</span> : null}
          {p.stale ? <StalePill /> : null}
        </div>
      </div>
      {canDecide ? (
        <div className="flex gap-2">
          <button type="button" className={BTN_L} onClick={() => onAccept(p)} disabled={!p.can_accept} data-testid="proposal-accept">Accept</button>
          <button type="button" className={BTN_S} onClick={() => onDismiss(p)} data-testid="proposal-dismiss">Dismiss</button>
        </div>
      ) : null}
    </li>
  );
}

/** The dialogs one Accept, one Dismiss or a batch opens. */
export function DecisionDialog({ action, projectId, onDone, onClose }) {
  const { verb, rows } = action;
  const one = rows.length === 1;
  const says = verb === 'accept'
    ? `${one ? `${itemTitle(rows[0])} is` : `${rows.length} items are`} pinned to your Raise. Nobody else sees ${one ? 'it' : 'them'} until you share ${one ? 'it' : 'them'}.`
    : `${one ? `${itemTitle(rows[0])} is` : `${rows.length} items are`} dismissed and not proposed again.`;
  return (
    <ChangeDialog title={verb === 'accept' ? (one ? 'Accept this evidence?' : `Accept ${rows.length} items?`) : (one ? 'Dismiss this evidence?' : `Dismiss ${rows.length} items?`)}
      confirm={verb === 'accept' ? 'Accept' : 'Dismiss'} says={says} onClose={onClose} testId="evidence-decision"
      onConfirm={async () => {
        const out = [];
        for (const p of rows) out.push({ ...(await decide(projectId, p, verb)), title: itemTitle(p) });
        if (one && !out[0].ok) { await onDone?.(out); const e = new Error(outcomeWord(out[0])); throw e; }
        await onDone?.(out);
      }} />
  );
}

/** VR4: the whole queue, with Source and Area filters, a selection bar and Accept all from one source. */
export function ReviewQueue({ model, read, search = '', projectId, onChanged }) {
  const [source, setSource] = useState('');
  const [area, setArea] = useState('');
  const [picked, setPicked] = useState(() => new Set());
  const [action, setAction] = useState(null);
  const [outcomes, setOutcomes] = useState(null);
  const rows = useMemo(() => (model.proposals || []).filter((p) => (!source || p.source_label === source) && (!area || p.area === area)), [model.proposals, source, area]);
  const offer = acceptAllOffer(model.proposals);
  const chosen = rows.filter((p) => picked.has(p.uid));
  const toggle = (uid) => setPicked((s) => { const n = new Set(s); if (n.has(uid)) n.delete(uid); else n.add(uid); return n; });
  const done = async (out) => { setOutcomes(out); setPicked(new Set()); await onChanged?.(); };
  const select = 'rounded-lg border border-axal-hairline bg-white px-2 py-1.5 text-[12.5px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';
  return (
    <section className="flex flex-col gap-4" data-testid="evidence-review">
      <div className="flex flex-col gap-1">
        <Link to={`${BASE}${search}`} className={LINK}>‹ Evidence</Link>
        <h2 className="m-0 text-[19px] font-bold text-axal-ink dark:text-gray-100">Waiting for review{model.proposals ? <span className="ml-2 text-[13px] font-semibold text-axal-muted dark:text-gray-400">[{model.proposals.length}{read?.proposals?.has_more ? '+' : ''}]</span> : null}</h2>
        <p className={MUTED}>Accepting pins evidence to your Raise. Nobody else sees it until you share it.</p>
      </div>
      {read?.proposals?.state === 'unreadable' ? <BlockUnreadable id="proposals" reason={read.proposals.reason} onRetry={onChanged} /> : null}
      {model.canDecide && offer ? (
        <div className="flex flex-col gap-1">
          <button type="button" className={`${BTN_S} w-fit`} data-testid="evidence-accept-all"
            onClick={() => setAction({ verb: 'accept', rows: acceptAllPlan(model.proposals, offer).take })}>{offer.label} [{Math.min(offer.count, ACCEPT_ALL_CAP)}]</button>
          <p className={MUTED}>At most {ACCEPT_ALL_CAP} per press. Each outcome is listed after.</p>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="review-source">Source</label>
        <select id="review-source" value={source} onChange={(e) => setSource(e.target.value)} className={select} data-testid="review-filter-source">
          <option value="">Source: all</option>{SOURCES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <label className="sr-only" htmlFor="review-area">Area</label>
        <select id="review-area" value={area} onChange={(e) => setArea(e.target.value)} className={select} data-testid="review-filter-area">
          <option value="">Area: all</option>{AREAS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>
      <div className={CARD}>
        {model.proposals && !rows.length ? <p className={MUTED} data-testid="review-none">{model.proposals.length ? 'Nothing waiting matches these filters.' : 'Nothing is waiting for your review.'}</p> : null}
        <ul className="m-0 flex list-none flex-col divide-y divide-axal-hairline p-0 dark:divide-gray-800">
          {rows.map((p) => <ProposalRow key={p.uid} p={p} canDecide={model.canDecide} selected={picked.has(p.uid)} onSelect={model.canDecide ? toggle : null}
            onAccept={(x) => setAction({ verb: 'accept', rows: [x] })} onDismiss={(x) => setAction({ verb: 'dismiss', rows: [x] })} />)}
        </ul>
      </div>
      {chosen.length ? (
        <div className="sticky bottom-3 flex flex-wrap items-center gap-2 rounded-xl border border-axal-hairline bg-white p-3 shadow-md dark:border-gray-700 dark:bg-gray-900" data-testid="review-bulk">
          <span className="text-[13px] font-semibold text-axal-ink dark:text-gray-100">[{chosen.length}] selected</span>
          <button type="button" className={BTN_L} onClick={() => setAction({ verb: 'accept', rows: chosen.filter((p) => p.can_accept).slice(0, ACCEPT_ALL_CAP) })} disabled={!chosen.some((p) => p.can_accept)}>Accept [{Math.min(chosen.filter((p) => p.can_accept).length, ACCEPT_ALL_CAP)}]</button>
          <button type="button" className={BTN_S} onClick={() => setAction({ verb: 'dismiss', rows: chosen.slice(0, ACCEPT_ALL_CAP) })}>Dismiss [{Math.min(chosen.length, ACCEPT_ALL_CAP)}]</button>
          <button type="button" className={BTN_S} onClick={() => setPicked(new Set())}>Clear</button>
        </div>
      ) : null}
      {outcomes ? (
        <div className={`${CARD} max-w-[600px]`} data-testid="review-outcomes">
          <h3 className="m-0 text-[11px] font-bold uppercase tracking-[.08em] text-axal-muted dark:text-gray-400">After that press</h3>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {outcomes.map((o) => <li key={o.uid} className="flex justify-between gap-3 text-[13px]"><span>{o.title}</span><span className={o.ok ? 'font-semibold text-emerald-700 dark:text-emerald-300' : 'text-axal-muted dark:text-gray-400'}>{outcomeWord(o)}</span></li>)}
          </ul>
        </div>
      ) : null}
      {action ? <DecisionDialog action={action} projectId={projectId} onDone={done} onClose={() => setAction(null)} /> : null}
    </section>
  );
}

/**
 * VR5: share several pinned items at one level. The dialog names what
 * investors see before and after the NDA, and who can see it now (counts from
 * the preview read, never names).
 */
export function ShareDialog({ items, projectId, onClose, onDone }) {
  const [to, setTo] = useState('after_nda');
  const [who, setWho] = useState({ state: 'loading' });
  useEffect(() => {
    let alive = true;
    raiseEvidenceApi.preview(projectId, true).then((r) => { if (alive) setWho(r?.audience || { state: 'unreadable' }); }).catch(() => { if (alive) setWho({ state: 'unreadable' }); });
    return () => { alive = false; };
  }, [projectId]);
  const bank = items.some((i) => i.private_reason === 'bank');
  return (
    <ChangeDialog title={`Share ${items.length === 1 ? itemTitle(items[0]) : `${items.length} items`}`} confirm="Share" onClose={onClose} testId="evidence-share"
      says={`${items.length === 1 ? 'This item becomes' : `All ${items.length} become`} ${SHARING[to]}.`}
      onConfirm={async () => {
        const failed = [];
        for (const i of items) { if (i.visibility === to) continue; try { await raiseEvidenceApi.update(projectId, i.uid, i.version, { visibility: to }); } catch { failed.push(itemTitle(i)); } }
        await onDone?.();
        if (failed.length) throw new Error(`Not shared: ${failed.join(', ')}. The source may have changed; look again and confirm it first.`);
      }}>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {items.map((i) => <li key={i.uid} className="flex flex-wrap items-center justify-between gap-2 text-[13px]"><span className="font-semibold">{itemTitle(i)}</span><SourcePill source={i.source_label} provider={i.provider} on={i.observed_on} /></li>)}
      </ul>
      <div role="radiogroup" aria-label="Sharing" className="inline-flex w-fit rounded-lg border border-axal-hairline p-0.5 dark:border-gray-700">
        {Object.entries(SHARING).map(([k, w]) => <button key={k} type="button" role="radio" aria-checked={to === k} onClick={() => setTo(k)} data-testid={`share-to-${k}`}
          className={`rounded-md px-3 py-1.5 text-[12.5px] font-semibold ${to === k ? 'bg-axal-lavender text-axal-violet-deep dark:bg-violet-900/40 dark:text-violet-300' : 'text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`}>{w}</button>)}
      </div>
      <div className="flex flex-col gap-1" data-testid="share-before">
        <span className="text-[11px] font-bold uppercase tracking-[.08em] text-axal-muted dark:text-gray-400">Before the NDA, investors see</span>
        {to === 'private' ? <p className={MUTED}>Nothing: Private items are the founders’ only.</p>
          : items.map((i) => <p key={i.uid} className="m-0 text-[12.5px]">{sourceWord(i.source_label)} · {itemTitle(i)}{day(i.observed_on) ? ` · ${day(i.observed_on)}` : ''}</p>)}
      </div>
      <div className="flex flex-col gap-1" data-testid="share-after">
        <span className="text-[11px] font-bold uppercase tracking-[.08em] text-axal-muted dark:text-gray-400">After the NDA, they see</span>
        {to === 'private' ? <p className={MUTED}>Nothing.</p>
          : items.map((i) => <p key={i.uid} className="m-0 text-[12.5px]">{itemTitle(i)}{to === 'after_nda' && itemFigure(i) ? ` · ${itemFigure(i)}` : to === 'summary' ? ' · summary only, no figure' : ''}</p>)}
      </div>
      <div className="flex flex-col gap-1" data-testid="share-who">
        <span className="text-[11px] font-bold uppercase tracking-[.08em] text-axal-muted dark:text-gray-400">Who can see this now</span>
        <p className="m-0 text-[12.5px]">{who.state === 'recorded'
          ? `${who.data_room} ${who.data_room === 1 ? 'investor holds' : 'investors hold'} a data-room grant; ${who.nda_signed} ${who.nda_signed === 1 ? 'has' : 'have'} a signed NDA. Round-call recipients and invited investors see it too.`
          : who.state === 'loading' ? 'Reading who can see it…' : 'Unreadable: who can see this could not be read.'}</p>
      </div>
      {bank && to !== 'private' ? <p className={MUTED}>Bank-derived items are shared as a figure only. Balances, accounts and bank lines are never shown.</p> : null}
    </ChangeDialog>
  );
}

/** VR11: what an investor sees on the deal page, before or after the NDA. */
export function InvestorPreview({ projectId, search = '' }) {
  const [nda, setNda] = useState(true);
  const [view, setView] = useState({ status: 'loading' });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true; setView({ status: 'loading' });
    raiseEvidenceApi.preview(projectId, nda).then((r) => { if (alive) setView({ status: 'ready', r }); }).catch((e) => { if (alive) setView({ status: 'error', message: e?.message }); });
    return () => { alive = false; };
  }, [projectId, nda, tick]);
  const r = view.r;
  return (
    <section className="flex flex-col gap-4" data-testid="evidence-preview">
      <div className="flex flex-col gap-2 rounded-xl border border-axal-lavender-edge bg-axal-lavender p-3 dark:border-violet-800 dark:bg-violet-900/30">
        <div className="flex flex-wrap items-center gap-3">
          <strong className="text-[13.5px] text-axal-violet-deep dark:text-violet-200">Previewing as an investor</strong>
          <div role="radiogroup" aria-label="NDA" className="inline-flex rounded-lg border border-axal-hairline bg-white p-0.5 dark:border-gray-700 dark:bg-gray-900">
            {[[false, 'Before NDA'], [true, 'After NDA']].map(([v, w]) => <button key={w} type="button" role="radio" aria-checked={nda === v} onClick={() => setNda(v)}
              className={`rounded-md px-3 py-1 text-[12.5px] font-semibold ${nda === v ? 'bg-axal-lavender text-axal-violet-deep dark:bg-violet-900/40 dark:text-violet-300' : 'text-axal-muted hover:text-axal-ink dark:text-gray-400 dark:hover:text-gray-100'}`}>{w}</button>)}
          </div>
          <Link to={`${BASE}${search}`} className={BTN_S} data-testid="preview-exit">Exit preview</Link>
        </div>
        <p className="m-0 text-[12.5px] text-axal-violet-deep dark:text-violet-200" data-testid="preview-as">{r?.preview_as || 'An invited investor with a data-room grant.'} A preview is not logged as an open.</p>
      </div>
      {view.status === 'loading' ? <p className={MUTED}>Reading…</p> : null}
      {view.status === 'error' ? <BlockUnreadable id="preview" reason={view.message || 'The preview could not be read.'} onRetry={() => setTick((n) => n + 1)} /> : null}
      {view.status === 'ready' ? <SharedView r={r} /> : null}
    </section>
  );
}

/** The investor's projection, drawn: coverage before the NDA; claims and items after it. */
export function SharedView({ r }) {
  const groups = r?.coverage?.state === 'recorded' ? r.coverage.groups : null;
  return (
    <div className="flex flex-col gap-4">
      <div className={CARD} data-testid="shared-coverage">
        <h2 className={H2}>{r?.nda_signed ? 'Coverage of what is shared' : 'Evidence'}</h2>
        {!r?.nda_signed ? <p className={MUTED}>{r?.before_nda}</p> : null}
        {r?.coverage?.state === 'unreadable' ? <BlockUnreadable id="shared-coverage" reason={r.coverage.reason} /> : null}
        {groups && !groups.length ? <p className={MUTED}>Nothing is shared with investors yet.</p> : null}
        {groups?.length ? (
          <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((g) => (
              <li key={`${g.area}-${g.kind}-${g.source_label}`} className="flex flex-col gap-1 rounded-lg border border-axal-hairline p-3 dark:border-gray-800">
                <span className="text-[13px] font-semibold">{itemTitle(g)}</span>
                <span className="text-[17px] font-bold">{g.count}</span>
                <SourcePill source={g.source_label} rest={g.newest ? `newest ${day(g.newest)}` : 'date not recorded'} />
              </li>
            ))}
          </ul>
        ) : null}
        {r?.partial ? <p className="m-0 text-[12px] text-amber-800 dark:text-amber-300">Some shared items could not be read just now and are not shown.</p> : null}
      </div>
      {r?.nda_signed ? (
        <div className={CARD} data-testid="shared-items">
          <h2 className={H2}>Items you can see</h2>
          {r.items?.state === 'unreadable' ? <BlockUnreadable id="shared-items" reason={r.items.reason} /> : null}
          <ul className="m-0 flex list-none flex-col divide-y divide-axal-hairline p-0 dark:divide-gray-800">
            {(r.items?.rows || []).map((i) => {
              const claims = (r.claims?.rows || []).filter((c) => c.items.includes(i.uid));
              return (
                <li key={i.uid} className="flex flex-col gap-1 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[13.5px] font-semibold">{itemTitle(i)}</span>
                    <span className="text-[13px] font-semibold" data-testid="shared-value">{itemFigure(i) ?? i.value_reason}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2"><SourcePill source={i.source_label} provider={i.provider} on={i.observed_on} /><StrengthMark strength={i.strength} />{i.stale ? <StalePill /> : null}<SharingPill visibility={i.sharing} /></div>
                  {claims.map((c) => <span key={c.uid} className="flex items-center gap-2 text-[12px] text-axal-muted dark:text-gray-400">Backs a claim: <StatePill state={c.state} /></span>)}
                </li>
              );
            })}
          </ul>
          {r.items?.state === 'recorded' && !r.items.rows.length ? <p className={MUTED}>Nothing shared after the NDA yet.</p> : null}
          <p className={MUTED}>You see what the founders chose to share. Each item names where it came from and when.</p>
        </div>
      ) : null}
    </div>
  );
}

