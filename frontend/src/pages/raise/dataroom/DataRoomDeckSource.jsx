import React, { useEffect, useState } from 'react';
import { dataRoomApi } from '../../../lib/api/dataRoom.js';
import DataRoomDialog from './DataRoomDialog.jsx';

export const extractionLabel = (state, reason) => reason === 'owner_confirmation_required' ? 'Owner confirmation needed' : ({ queued: 'Queued for extraction', done: 'Document · Sourced', no_values: 'No supported values found', unreadable: 'Extraction unreadable — try again' }[state] || 'Not used in decks');

/** D1602: the owner opts in here; other files are never opened for extraction. */
export default function DataRoomDeckSource({ file, room, projectUid, onChanged }) {
  const [ask, setAsk] = useState(null);
  useEffect(() => {
    if (!room?.deck_sources_available || !file?.deck_source || file.extraction?.state !== 'queued') return undefined;
    const timer = setInterval(onChanged, 5000);
    return () => clearInterval(timer);
  }, [room?.deck_sources_available, file?.deck_source, file?.extraction?.state, onChanged]);
  if (!room?.deck_sources_available) return null;
  const enabled = !!file.deck_source;
  const owner = room.role === 'owner';
  const change = async () => {
    try {
      await dataRoomApi.setDeckSource(projectUid, file.uid, { enabled: ask.enabled, ...(ask.quote ? { confirm_quote: ask.quote.confirm_quote } : {}) });
      setAsk(null); onChanged();
    } catch (e) {
      if (e?.status === 402 && e?.data?.quote?.confirm_quote) { setAsk({ enabled: true, quote: e.data.quote }); return; }
      throw e;
    }
  };
  return (
    <section className="flex flex-col gap-2 border-t border-axal-hairline pt-3.5 dark:border-gray-700" data-testid="dataroom-deck-source">
      <h3 className="m-0 text-[10.5px] font-extrabold uppercase tracking-[.07em] text-axal-muted">Pitch deck source</h3>
      <label className="flex items-center gap-2 text-[13px] font-semibold">
        <input data-testid="dataroom-deck-source-toggle" type="checkbox" checked={enabled} disabled={!owner} onChange={() => setAsk({ enabled: !enabled })} />
        Use this file as a deck source
      </label>
      <p className="m-0 text-[12px] text-axal-muted" role="status">{enabled ? extractionLabel(file.extraction?.state, file.extraction?.reason) : 'Not used in decks'}</p>
      {!owner ? <p className="m-0 text-[12px] text-axal-muted">Only the venture’s owner can change this.</p> : null}
      {enabled && file.extraction?.state === 'unreadable' && owner ? <button data-testid="dataroom-deck-source-retry" type="button" className="self-start text-[12px] font-semibold text-axal-violet underline" onClick={() => setAsk({ enabled: true })}>{file.extraction?.reason === 'owner_confirmation_required' ? 'Confirm extraction' : 'Try extraction again'}</button> : null}
      {ask ? <DataRoomDialog key={ask.quote?.confirm_quote || String(ask.enabled)} testId="dataroom-deck-source-dialog" onClose={() => setAsk(null)} onConfirm={change}
        copy={{ title: ask.enabled ? 'Use this file in pitch decks?' : 'Withdraw this deck source?', action: ask.quote ? 'Confirm extraction' : ask.enabled ? 'Use as source' : 'Withdraw',
          body: ask.enabled ? 'Extract labelled revenue, headcount and contract figures from this file’s current version. New versions withdraw old values. CSV and XLSX updates are automatic. PDF and DOCX updates by cofounders need the owner’s confirmation. Values stay Document / Sourced.' : 'Remove its extracted values from available deck sources. Existing decks keep their saved figures until refreshed.' }}>
        {ask.quote ? <p className="m-0 font-semibold">Holds up to ${(ask.quote.hold_microusd / 1_000_000).toFixed(6)} · you pay what is used. This limit also applies to versions you update. A higher price or a cofounder’s update requires your confirmation again.</p> : null}
      </DataRoomDialog> : null}
    </section>
  );
}
