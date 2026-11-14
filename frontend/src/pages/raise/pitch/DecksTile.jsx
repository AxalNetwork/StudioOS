import React, { useEffect, useState } from 'react';
import { deckInvestorLinksApi } from '../../../lib/api/deckInvestorLinks';
import { reportError } from '../../../lib/log';
import VersionCompare from './VersionCompare';
import ShareDialog from './ShareDialog';
import { deckCards, timeline, variantsUnread } from './decksTileModel';

/**
 * D4254 P5 (#4273, ps3) — the Decks tile's part below the deck card: the deck
 * and each variant of its current version as cards ("Main · v7 · 12 cards ·
 * Edited … by … · 2 links", "Variant · v7 · No links"), and the Versions
 * timeline: each version with who saved it, when, and the links pointing to it,
 * with Compare (PD15's `VersionCompare`, which carries Restore and the
 * "v6 → v7 · Added … · Changed …" line) and Share this version (`ShareDialog`
 * on that version). Reads `deckVariants` and `investorLinks` of the current
 * version; writes nothing itself.
 */

const BTN = 'inline-flex min-h-[32px] items-center justify-center whitespace-nowrap rounded-[9px] border border-axal-hairline bg-white px-3 text-[12px] font-bold text-axal-ink hover:bg-axal-ground dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800';
const CARD = 'rounded-[12px] border border-axal-hairline bg-white dark:border-gray-700 dark:bg-gray-900';
const INK = 'text-axal-ink dark:text-gray-100';
const MUTED = 'text-[12.5px] leading-[1.45] text-axal-muted dark:text-gray-400';
const CHIP = 'inline-flex items-center rounded-full border border-axal-lavender-edge bg-axal-lavender px-2 py-0.5 text-[10.5px] font-bold text-axal-violet dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300';

function useRead(fn, id) {
  const [state, setState] = useState({ status: 'idle', data: null });
  useEffect(() => {
    if (id == null) return undefined;
    let alive = true;
    setState({ status: 'loading', data: null });
    fn(id).then((data) => { if (alive) setState({ status: 'ok', data }); },
      (e) => { if (alive) setState({ status: 'error', data: null }); reportError('decks-tile:read', e); });
    return () => { alive = false; };
  }, [fn, id]);
  return state;
}

export default function DecksTile({ projectId, versions, current, cardCount = null, readOnly, onChanged }) {
  const variants = useRead(deckInvestorLinksApi.deckVariants, current?.id ?? null);
  const links = useRead(deckInvestorLinksApi.investorLinks, current?.id ?? null);
  const [compareId, setCompareId] = useState(null);
  const [sharing, setSharing] = useState(null);
  if (!current) return null;
  const cards = deckCards({ current, cards: cardCount, variants, links });
  const rows = timeline(versions);
  const older = compareId == null ? null : versions.find((v) => String(v.id) === String(compareId)) || null;

  return (
    <section className="flex flex-col gap-3.5" data-testid="decks-tile">
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3" data-testid="decks-tile-cards">
        {cards.map((c) => (
          <div key={c.key} className={`${CARD} flex flex-col gap-1.5 p-4`} data-testid={`decks-tile-card-${c.key}`}>
            <span className={`text-[14px] font-extrabold ${INK}`}>{c.name}</span>
            <span className="flex flex-wrap items-center gap-1.5 text-[12px] text-axal-muted dark:text-gray-400">
              <span className={CHIP}>{c.kind}</span>
              <span className="font-mono">{c.version}</span>
              {c.cards ? <span>· {c.cards}</span> : null}
            </span>
            {c.edited ? <span className={MUTED}>{c.edited}</span> : null}
            <span className={MUTED} data-testid={`decks-tile-links-${c.key}`}>{c.links}</span>
          </div>
        ))}
      </div>
      {variantsUnread(variants) ? <p className={`m-0 ${MUTED}`} data-testid="decks-tile-variants-unread">Your variants could not be read.</p> : null}

      <section className={`${CARD} overflow-hidden`} data-testid="decks-tile-versions">
        <div className="px-4 py-3"><span className={`text-[14px] font-extrabold ${INK}`}>Versions</span></div>
        <ol className="m-0 list-none p-0">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-axal-hairline px-4 py-2.5 dark:border-gray-700" data-testid={`decks-tile-version-${r.id}`}>
              <span className="flex flex-wrap items-center gap-2 text-[12.5px]">
                <span className={`font-mono font-bold ${INK}`}>{r.label}</span>
                {r.current ? <span className={CHIP}>Current</span> : null}
                <span className="text-axal-muted dark:text-gray-400">{r.by} · {r.saved}</span>
                <span className="text-axal-muted dark:text-gray-400" data-testid={`decks-tile-version-links-${r.id}`}>· {r.links}</span>
              </span>
              <span className="flex gap-2">
                {!r.current ? <button type="button" className={BTN} onClick={() => setCompareId(r.id)} data-testid={`decks-tile-compare-${r.id}`}>Compare</button> : null}
                {!readOnly && projectId != null ? <button type="button" className={BTN} onClick={() => setSharing(versions.find((v) => String(v.id) === String(r.id)))} data-testid={`decks-tile-share-${r.id}`}>Share this version</button> : null}
              </span>
            </li>
          ))}
        </ol>
      </section>

      {older ? (
        <VersionCompare key={`${older.id}-${current.id}`} older={older} newer={current} versions={versions} readOnly={readOnly}
          onClose={() => setCompareId(null)} onRestored={() => { setCompareId(null); onChanged?.(); }} />
      ) : null}
      {sharing ? <ShareDialog projectId={projectId} deck={sharing} onClose={() => setSharing(null)} onCreated={() => onChanged?.()} /> : null}
    </section>
  );
}
