/**
 * D4598 (#4598) part 2 — the check Export and Share run on the artifact's own
 * EFFECTIVE content, before they send it: not the saved version alone (part 1's
 * gate, before either dialog opens), but that version together with whatever
 * narrows what actually goes out — a variant, hidden cards, what is included.
 * `deck` is that content, already built by the caller: `exportableCards`'s for
 * Export (`preflightUiModel.js`), the Worker's `POST .../preflight/link-cards`
 * for Share (`deckPreflightApi.linkCards`). It is null while that content is
 * still being read, so the check waits rather than running on the wrong one.
 *
 * Every change to that content is a new `usePreflight` result — its key is a
 * hash of the version and its slides (`preflightModel.js`'s `deckKey`) — so
 * picking another version, variant or "what is included" invalidates whatever
 * was found or confirmed before: `pf.current` goes false the moment `deck`'s
 * content differs, and the effect below runs the check again. A result
 * confirmed through "Export/Send anyway" loses that confirmation the moment
 * its content is no longer this one: `confirmed` is keyed to the result's own
 * key, never to the dialog, so a stale confirmation can never wave through a
 * combination it was never given for. Export and Share stay blocked (`blocked`)
 * until the check against the CURRENT combination is clean, or its warnings
 * have gone through this same confirmation.
 */
import { useEffect, useState } from 'react';
import usePreflight from './usePreflight';
import { gateOf } from './preflightUiModel';

export default function useSendCheck({ kind, deck, kit = null, refresh = null }) {
  const pf = usePreflight({ deck, kit, refresh });
  const [confirmedKey, setConfirmedKey] = useState(null);
  useEffect(() => {
    if (!deck || pf.running || pf.current) return;
    // A fresh run, even one landing back on content identical to something confirmed
    // before switching away, asks again: the confirmation is for the run that just
    // finished, never carried from an earlier visit to the same combination.
    setConfirmedKey(null);
    pf.run();
  }, [deck, pf.running, pf.current]); // eslint-disable-line react-hooks/exhaustive-deps
  const ready = Boolean(deck) && !pf.running && pf.current;
  const gate = ready ? gateOf(pf.groups, kind) : null;
  const resultKey = pf.result?.key ?? null;
  const confirmed = Boolean(resultKey) && confirmedKey === resultKey;
  return { pf, gate, ready, confirmed, confirm: () => setConfirmedKey(resultKey), blocked: !ready || (Boolean(gate?.open) && !confirmed) };
}
