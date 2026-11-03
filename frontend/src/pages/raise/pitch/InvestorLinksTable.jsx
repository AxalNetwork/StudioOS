import React, { useCallback, useEffect, useState } from 'react';
import { Lightbox } from '../../../ui';
import * as v2 from './deckV2Adapter.js';
import { deckUpdateReuseApi } from '../../../lib/api/deckUpdateReuse.js';
import { deckSlideAnalyticsApi } from '../../../lib/api/deckSlideAnalytics.js';
import ViewerAnalyticsSheet from './ViewerAnalyticsSheet.jsx';
import { OFF_KEEPS, SWITCH_FAILED, TIME_PER_SLIDE, analyticsCellWords } from './slideAnalyticsModel.js';

/**
 * D1565 (#3812, PD-8 · pd35) — "Share, one link per investor": this version's
 * links, one row per investor, from `deckV2Adapter.investorLinks` (the Worker's
 * `GET /api/decks/:id/investor-links`).
 *
 * Columns: Investor · Version (frozen, or the variant) · NDA · Expiry · View cap
 * · Time per slide · Analytics, with pd35's signal TAG ("Revisited after 48 h", D1568).
 * Walkthrough (#3837) is not read here, so it is not drawn. Withdraw asks first
 * ("Withdraw this link? Analytics so far are kept."), and a withdrawn row keeps its views.
 *
 * D1573 (#3820): the row's "Time per slide" switch (the link's consent,
 * `PUT …/investor-links/:shareId/time-per-slide`, written when it is pressed),
 * with "Off keeps visit counts only" while it is off; the Analytics cell reads
 * "Views 4 · Time 6 m 12 s · Last seen yesterday" or "Views 1 · visit counts
 * only", and opens pd37's sheet (`ViewerAnalyticsSheet.jsx`).
 *
 * Never a zero for what was not read: "No cap" is a link with no limit, and a
 * failed read is "Views on your links could not be read." with Try again (pd9c).
 *
 * D1584 (#3831): "Changes since vN" under each row's Version, when the deck
 * has a newer current version than the one these links froze: the figures
 * whose words changed and the cards added or removed, from the Worker's
 * `GET /api/decks/:id/changes-since`. Nothing is drawn on the current version.
 */

const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const EYE = 'font-mono text-[10px] font-semibold uppercase tracking-[.07em] text-axal-muted dark:text-gray-400';
const BTN = 'inline-flex min-h-[30px] items-center justify-center rounded-[8px] px-2.5 text-[12px] font-bold';
const GHOST = `${BTN} border border-axal-hairline bg-white text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800`;
const DANGER = `${BTN} bg-axal-destructive text-white hover:bg-red-800 dark:bg-red-600 dark:hover:bg-red-700`;

export const LINKS_UNREAD = 'Views on your links could not be read.';
export const WITHDRAW_TITLE = 'Withdraw this link?';
export const WITHDRAW_BODY = 'It stops opening at once. Analytics so far are kept.';

const day = (v) => (v ? String(v).slice(0, 10) : null);

/** A row's NDA cell: Accepted with its date, Not accepted yet, or a dash when none is required. */
export function ndaWords(nda) {
  if (nda?.state === 'accepted') return `Accepted ${day(nda.accepted_at)}`;
  if (nda?.state === 'not_accepted') return 'Not accepted yet';
  return 'Not required';
}
/** A row's view cap: "No cap", or used of the limit. */
export const capWords = (cap) => (cap?.limit == null ? 'No cap' : `${cap.used ?? 0} of ${cap.limit}`);
export const expiryWords = (row) => (row.expires_at ? `Until ${day(row.expires_at)}` : 'Never');
export const versionWords = (row, deck) => (row.version?.variant ? `v${deck?.version ?? '?'} · ${row.version.variant.name}` : `v${deck?.version ?? '?'}`);
export const statusWords = { live: 'Live', withdrawn: 'Withdrawn', expired: 'Expired', used_up: 'Used up' };
/** The figures shown before the rest are counted ("and 2 more"). */
export const CHANGES_SHOWN = 3;
/**
 * pd35's "Changes since vN" for the rows of a version: null on the current
 * version; "no figure changed" when only the words around them did.
 */
export function changesWords(answer) {
  if (!answer || answer.latest || !answer.current) return null;
  const head = `Changes since v${answer.since?.version ?? '?'} (now v${answer.current.version})`;
  const figs = Array.isArray(answer.changes?.figures) ? answer.changes.figures : [];
  const parts = figs.slice(0, CHANGES_SHOWN).map((f) => (f.was == null ? `${f.label} added` : f.now == null ? `${f.label} removed` : `${f.label} ${f.was} → ${f.now}`));
  if (figs.length > CHANGES_SHOWN) parts.push(`and ${figs.length - CHANGES_SHOWN} more`);
  const cards = answer.changes?.cards;
  const delta = cards ? Number(cards.after) - Number(cards.before) : 0;
  if (delta > 0) parts.push(`${delta} ${delta === 1 ? 'card' : 'cards'} added`);
  if (delta < 0) parts.push(`${-delta} ${delta === -1 ? 'card' : 'cards'} removed`);
  return `${head}: ${parts.length ? parts.join(' · ') : 'no figure changed'}`;
}
export const CHANGES_UNREAD = (deck) => `Changes since v${deck?.version ?? '?'} could not be read.`;
/** D1568 (#3815): pd35's signal TAG on the row: "Revisited after 48 h" once a revisit is recorded, never a number. */
export const signalTag = (signals) => (Array.isArray(signals) && signals.some((x) => x?.kind === 'revisit') ? 'Revisited after 48 h' : null);
export const viewsWords = (a) => `${a?.views ?? 0} ${a?.views === 1 ? 'view' : 'views'}${a?.last_viewed_at ? ` · last ${day(a.last_viewed_at)}` : ''}`;

export default function InvestorLinksTable({ deck, refreshKey = 0 }) {
  const [block, setBlock] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [refusal, setRefusal] = useState('');
  const [since, setSince] = useState({ status: 'idle', data: null });
  // D1573: the pd37 sheet's row, the switch being written, and a switch that failed.
  const [sheet, setSheet] = useState(null);
  const [switching, setSwitching] = useState(null);
  const [switchFailed, setSwitchFailed] = useState(null);
  useEffect(() => {
    if (!deck?.id) return undefined;
    let live = true;
    setSince({ status: 'loading', data: null });
    deckUpdateReuseApi.changesSince(deck.id).then(
      (data) => { if (live) setSince({ status: 'ready', data }); },
      () => { if (live) setSince({ status: 'error', data: null }); },
    );
    return () => { live = false; };
  }, [deck?.id]);
  const sinceLine = since.status === 'ready' ? changesWords(since.data) : since.status === 'error' ? CHANGES_UNREAD(deck) : null;
  const load = useCallback(() => {
    if (!deck?.id) return;
    setBlock(null);
    v2.investorLinks(deck.id).then(setBlock);
  }, [deck?.id]);
  useEffect(() => { load(); }, [load, refreshKey]);

  const withdraw = async () => {
    setRefusal('');
    const out = await v2.withdrawInvestorLink(deck.id, confirm.id);
    if (!out.available) { setRefusal(out.reason || 'It could not be withdrawn. Try again.'); return; }
    setConfirm(null); load();
  };

  const setTimePerSlide = async (r, on) => {
    setSwitching(r.id); setSwitchFailed(null);
    try {
      await deckSlideAnalyticsApi.setTimePerSlide(deck.id, r.id, on);
      load();
    } catch { setSwitchFailed(r.id); } finally { setSwitching(null); }
  };

  if (!deck?.id) return null;
  if (!block) return <p className={`m-0 ${MUTED}`} data-testid="investor-links-reading">Reading the links…</p>;
  if (!block.available) {
    return (
      <div className="flex flex-col gap-1.5" data-testid="investor-links-unread">
        <p className={`m-0 ${MUTED}`}>{block.unreadable ? LINKS_UNREAD : block.reason}</p>
        {block.unreadable ? <button type="button" className={`w-fit ${GHOST}`} onClick={load} data-testid="investor-links-retry">Try again</button> : null}
      </div>
    );
  }
  const rows = Array.isArray(block.value?.links) ? block.value.links : [];
  return (
    <div className="flex flex-col gap-1.5" data-testid="investor-links">
      <span className={EYE}>One link per investor</span>
      {!rows.length ? <p className={`m-0 ${MUTED}`}>No investor has a link to this version yet.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[12px]">
            <thead>
              <tr className={EYE}>{['Investor', 'Version (frozen)', 'NDA', 'Expiry', 'View cap', TIME_PER_SLIDE, 'Analytics', ''].map((h) => <th key={h || 'actions'} scope="col" className="py-1 pr-2 font-semibold">{h || <span className="sr-only">Actions</span>}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-axal-hairline align-top dark:border-gray-800" data-testid={`investor-link-${r.id}`}>
                  <td className="py-1.5 pr-2 text-axal-ink dark:text-gray-100">
                    <b className="block">{r.investor?.label || 'Not recorded'}</b>
                    {r.investor?.fund ? <span className={MUTED}>{r.investor.fund}</span> : null}
                    {r.watermark ? <span className={`block ${MUTED}`} data-testid={`investor-link-watermark-${r.id}`}>{r.watermark}</span> : null}
                  </td>
                  <td className="py-1.5 pr-2">
                    <span className="block font-mono">{versionWords(r, deck)}</span>
                    {sinceLine ? <span className={`block ${MUTED}`} data-testid={`investor-link-changes-${r.id}`}>{sinceLine}</span> : null}
                  </td>
                  <td className="py-1.5 pr-2">{ndaWords(r.nda)}</td>
                  <td className="py-1.5 pr-2">{expiryWords(r)}</td>
                  <td className="py-1.5 pr-2 font-mono">{capWords(r.view_cap)}</td>
                  <td className="py-1.5 pr-2">
                    <input type="checkbox" role="switch" aria-label={`${TIME_PER_SLIDE}, ${r.investor?.label || 'this investor'}`} checked={r.time_per_slide !== false}
                      disabled={r.status !== 'live' || switching === r.id} onChange={(e) => setTimePerSlide(r, e.target.checked)} data-testid={`investor-link-time-${r.id}`} />
                    {r.time_per_slide === false ? <span className={`block ${MUTED}`}>{OFF_KEEPS}</span> : null}
                    {switchFailed === r.id ? <span role="alert" className="block text-[11.5px] text-axal-destructive dark:text-red-300">{SWITCH_FAILED}</span> : null}
                  </td>
                  <td className="py-1.5 pr-2">
                    <button type="button" className="text-left text-axal-ink underline decoration-dotted underline-offset-2 hover:text-axal-violet dark:text-gray-100"
                      onClick={() => setSheet(r)} data-testid={`investor-link-analytics-${r.id}`}>{analyticsCellWords(r)}</button>
                    {signalTag(r.signals) ? <span className="ml-1 rounded border border-axal-hairline px-1 text-[11px] text-axal-ink dark:border-gray-700 dark:text-gray-100" data-testid={`investor-link-signal-${r.id}`}>{signalTag(r.signals)}</span> : null}
                  </td>
                  <td className="py-1.5">
                    {r.status === 'live' ? <button type="button" className={GHOST} onClick={() => { setRefusal(''); setConfirm(r); }} data-testid={`investor-link-withdraw-${r.id}`}>Withdraw</button>
                      : <span className={MUTED}>{statusWords[r.status] || r.status}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {sheet ? <ViewerAnalyticsSheet deck={deck} row={sheet} onClose={() => setSheet(null)} /> : null}
      {confirm ? (
        <Lightbox label={WITHDRAW_TITLE} title={WITHDRAW_TITLE} width={480} onClose={() => setConfirm(null)} testId="investor-link-withdraw-confirm"
          footer={(
            <div className="flex justify-end gap-2">
              <button type="button" className={GHOST} onClick={() => setConfirm(null)}>Cancel</button>
              <button type="button" className={DANGER} onClick={withdraw} data-testid="investor-link-withdraw-yes">Withdraw</button>
            </div>
          )}>
          <p className="m-0 text-[13px] text-axal-ink dark:text-gray-100">{`${confirm.investor?.label || 'This investor'}'s link. ${WITHDRAW_BODY}`}</p>
          {refusal ? <p role="alert" className="m-0 mt-2 text-[12.5px] text-axal-destructive dark:text-red-300">{refusal}</p> : null}
        </Lightbox>
      ) : null}
    </div>
  );
}
