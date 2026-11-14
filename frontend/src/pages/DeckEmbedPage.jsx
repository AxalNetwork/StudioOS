import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { reportError } from '../lib/log';
import DeckCardView from './raise/pitch/DeckCardView';
import { ClosedLink, EmailGate, NdaGate } from './raise/pitch/ShareViewerParts';

/**
 * D1564 (#3811, deck builder v2 D3) — `/embed/:token`: a published deck in a
 * frame on a site its founder listed. The Worker answers this path only to a
 * frame from one of those origins (`routes/deck_publish.ts` `serveDeckEmbed`,
 * `frame-ancestors`); the page itself reads the same share link as the
 * reader at `/deck/share/:token`, so the email gate, the NDA, a closed link
 * and what the link includes all hold here too. It draws only the card view:
 * no header, no download, no call to action.
 */
export default function DeckEmbedPage() {
  const { token } = useParams();
  const [deck, setDeck] = useState(null);
  const [closed, setClosed] = useState(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    api.deckShareRead(token)
      .then((d) => { if (alive) setDeck(d); })
      .catch((e) => {
        if (!alive) return;
        if (e?.status === 410) { setClosed(e); return; }
        reportError('DeckEmbedPage:read', e);
        setFailed(true);
      });
    return () => { alive = false; };
  }, [token, tick]);

  const again = () => { setDeck(null); setTick((t) => t + 1); };
  if (closed) return <ClosedLink error={closed} />;
  if (failed) {
    return (
      <div className="flex flex-col items-start gap-2 p-4" data-testid="deck-embed-unread">
        <p className="m-0 text-[13px] text-gray-600 dark:text-slate-400">This deck could not be read.</p>
        <button type="button" className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-4 text-sm font-semibold dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" onClick={again}>Try again</button>
      </div>
    );
  }
  if (!deck) return <p className="m-0 p-4 text-[13px] text-gray-500 dark:text-slate-400">Loading…</p>;
  if (deck.gate === 'email') return <EmailGate token={token} gate={deck} onPassed={again} />;
  if (deck.gate === 'nda') return <NdaGate token={token} gate={deck} onAccepted={again} />;
  return (
    <main className="min-h-screen bg-gray-50 dark:bg-slate-950" data-testid="deck-embed">
      <DeckCardView deck={deck} watermark={deck.watermark || null} />
    </main>
  );
}
